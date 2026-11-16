# frozen_string_literal: true

# Masterworks, run with `trmnlp test` from plugin/. No network for data: every part of both shards is mocked from
# tests/fixtures (a slice of the real data set). Pictures are fetched by the browser from Wikimedia.
require 'json'
require 'uri'

RSpec.describe 'Masterworks' do
  let(:base) { 'https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data' }
  let(:custom_fields) { {} }

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  # the same document for every part of an orientation (the transform fetches one part at random)
  def shard_mocks(landscape, portrait)
    (0..2).each_with_object({}) do |k, m|
      m["#{base}/landscape-#{k}.json"] = { json: fixture(landscape) }
      m["#{base}/portrait-#{k}.json"] = { json: fixture(portrait) }
    end
  end

  let(:mocks) { shard_mocks('landscape', 'portrait') }

  # one work per shard: the recipe compares a light and a dark render of the same screen, which a random pick would break
  it_behaves_like 'a publishable recipe' do
    let(:mocks) { shard_mocks('one-landscape', 'one-portrait') }
  end

  VIEWS = %w[full half_horizontal half_vertical quadrant].freeze
  DEVICES = %w[frame v2 og_png og_plus].freeze

  def screen(view, device, fields = {}, orientation: 'landscape', mocks: self.mocks)
    trmnl.render(view:, device:, orientation:, mocks:, custom_fields: custom_fields.merge(fields))
  end

  def wait(page) = page.has_css?('img.image') # the page is drawn

  def rect(page, selector)
    wait(page)
    page.evaluate("(() => { const r = document.querySelector('#{selector}').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
  end

  def layout_rect(page) = rect(page, '.layout')

  DEVICES.each do |device|
    VIEWS.each do |view|
      describe "Gallery (the default), #{view} on #{device}" do
        let(:light) { shard_mocks('one-landscape', 'one-portrait') }
        let(:dark) { shard_mocks('one-dark-landscape', 'one-portrait') }

        it 'hangs the work on a mat with a bevel line, a label under it, no title bar, asking TRMNL for dithering' do
          page = screen(view, device, mocks: light)
          wait(page)
          expect(page).to have_css('[data-gallery] [data-bevel] img.image.image-dither')
          expect(page).to have_css('[data-label] text')
          expect(page).to have_no_css('.title_bar')
          expect(page.evaluate("getComputedStyle(document.querySelector('img.image')).objectFit")).to eq('cover')
        end

        it 'puts a light work on a pure white mat and a dark work on a pure black one, bevel in the opposite colour' do
          { light => ['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'white'], dark => ['rgb(0, 0, 0)', 'rgb(255, 255, 255)', 'black'] }.each do |m, (mat, edge, name)|
            page = screen(view, device, mocks: m)
            wait(page)
            expect(page).to have_css("[data-gallery=\"#{name}\"]")
            expect(page.evaluate("getComputedStyle(document.querySelector('[data-gallery]')).backgroundColor")).to eq(mat)
            expect(page.evaluate("getComputedStyle(document.querySelector('[data-bevel]')).backgroundColor")).to eq(edge)
          end
        end

        it 'shows the label as the Label setting says' do
          off = screen(view, device, { 'label' => 'off' }, mocks: light)
          wait(off)
          expect(off).to have_no_css('[data-label]')
          expect(off).to have_css('[data-bevel]')
        end

        it 'keeps the label inside the screen and its right edge on the picture\'s right edge' do
          page = screen(view, device, mocks: light)
          wait(page)
          next unless page.has_css?('[data-label]')

          edge = rect(page, '[data-bevel]')
          lab = rect(page, '[data-label]')
          lay = layout_rect(page)
          expect(lab[2]).to be_within(3).of(edge[2])
          # the text itself, not only its box, ends on the picture's right edge (right-aligned)
          text_right = page.evaluate("document.querySelector('[data-label] text').getBoundingClientRect().right")
          expect(text_right).to be_within(0.4 * page.evaluate("parseFloat(document.querySelector('[data-label] text').getAttribute('font-size'))") + 4).of(edge[2])
          expect(lab[3]).to be <= lay[3] + 1
          expect(edge[2] - edge[0]).to be <= (lay[2] - lay[0]) * 0.78
        end
      end
    end
  end

  describe 'Gallery label type is legible at every size' do
    # the Frame is screen--md at 1x like the OG, so only SVG text in the screen's own pixels is big enough there
    { 'frame' => 28, 'v2' => 25, 'og_png' => 10 }.each do |device, min_px|
      it "draws the title at least #{min_px} px high on #{device}" do
        page = screen('full', device, mocks: shard_mocks('one-landscape', 'one-portrait'))
        wait(page)
        title = page.evaluate("document.querySelector('[data-label] text').getBoundingClientRect().height")
        expect(title).to be >= min_px
      end
    end
  end

  DEVICES.each do |device|
    VIEWS.each do |view|
      describe "Full screen, #{view} on #{device}" do
        let(:fields) { { 'presentation' => 'full' } }

        it 'fills the view with the artwork, cropped by default' do
          page = screen(view, device, fields)
          wait(page)
          expect(page.evaluate("getComputedStyle(document.querySelector('img.image')).objectFit")).to eq('cover')
          expect(page).to have_css('img.image.image-dither')
          expect(page).to have_no_css('.title_bar')
        end

        it 'shows the whole work on a mat for "Whole work"' do
          page = screen(view, device, fields.merge('fit' => 'whole'))
          wait(page)
          expect(page.evaluate("getComputedStyle(document.querySelector('img.image')).objectFit")).to eq('contain')
        end

        it 'the corner placard names the work; "Off" shows only the artwork' do
          on = screen(view, device, fields)
          wait(on)
          expect(on).to have_css('[data-placard] text')
          expect(screen(view, device, fields.merge('label' => 'off')).then { |p| wait(p) && p }).to have_no_css('[data-placard]')
        end
      end
    end
  end

  describe 'Full screen placard is legible at every size' do
    { 'frame' => 28, 'v2' => 25, 'og_png' => 10 }.each do |device, min_px|
      it "draws the title at least #{min_px} px high on #{device}" do
        page = screen('full', device, { 'presentation' => 'full' })
        wait(page)
        expect(page.evaluate("document.querySelector('[data-placard] text').getBoundingClientRect().height")).to be >= min_px
      end
    end
  end

  describe 'portrait' do
    %w[frame v2 og_png].each do |device|
      %w[gallery full].each do |presentation|
        it "reads a portrait shard on #{device} (#{presentation})" do
          page = screen('full', device, { 'presentation' => presentation }, orientation: 'portrait')
          wait(page)
          src = page.evaluate("document.querySelector('img.image').getAttribute('src')")
          file = URI.decode_uri_component(src.split('/')[-2])
          expect(fixture('portrait')['w'].map { |w| w['f'].tr(' ', '_') }).to include(file)
        end
      end
    end
  end

  describe 'when the picture cannot be loaded' do
    # the mat and the label are drawn by the markup itself, so a failed picture is never a blank screen
    it 'still shows the mat, the label with the title, and the Full screen placard' do
      one = shard_mocks('one-landscape', 'one-portrait')
      url = trmnl.transform(mocks: one, custom_fields:).data['art']['url']
      title = fixture('one-landscape')['w'].first['t']
      broken = { url => { body: 'not a picture', content_type: 'text/plain' } }
      page = trmnl.render(view: 'full', device: 'og_png', mocks: one, custom_fields:, asset_overrides: broken)
      page.has_css?('[data-gallery]')
      expect(page).to have_css('[data-label] text', text: title)
      full = trmnl.render(view: 'full', device: 'og_png', mocks: one, custom_fields: { 'presentation' => 'full' },
                          asset_overrides: broken)
      full.has_css?('[data-placard]')
      expect(full).to have_css('[data-placard] text', text: title)
    end
  end

  describe 'when the data cannot be loaded' do
    let(:mocks) do
      (0..2).each_with_object({}) do |k, m|
        m["#{base}/landscape-#{k}.json"] = { status: 500 }
        m["#{base}/portrait-#{k}.json"] = { status: 500 }
      end
    end

    %w[frame og_png].each do |device|
      VIEWS.each do |view|
        it "#{view} on #{device} says so in words, not a blank screen" do
          page = screen(view, device)
          expect(page).to have_text('The next refresh tries again')
          expect(page).to have_no_css('img.image')
        end
      end
    end
  end

  describe 'narrow slots' do
    # the label once stuck out by 1 px in the 105 px wide half_vertical slot of a playdate (found by the shared base checks)
    [%w[half_vertical playdate portrait], %w[quadrant playdate landscape], %w[half_vertical og_png landscape]].each do |view, device, orientation|
      %w[gallery full].each do |presentation|
        it "#{presentation} #{view} on #{device} #{orientation} has no overflow and the label ends inside the slot" do
          page = screen(view, device, { 'presentation' => presentation }, orientation: orientation.to_sym)
          expect(page).to have_no_overflow
          wait(page)
          sel = presentation == 'gallery' ? '[data-label]' : '[data-placard]'
          next unless page.has_css?(sel)

          expect(rect(page, sel)[2]).to be <= layout_rect(page)[2] - 3
          # every line of text stays inside its svg (the face is whatever "serif" is: wider in the Docker image)
          # (an italic line is slanted by a face without a real italic: its box may reach 0.6 em past the right edge)
          out = page.evaluate(<<~JS)
            (() => { const svg = document.querySelector('#{sel} text').ownerSVGElement.getBoundingClientRect();
              return [...document.querySelectorAll('#{sel} text')].filter((t) => { const r = t.getBoundingClientRect(), slack = t.getAttribute('font-style') === 'italic' ? 0.6 * parseFloat(t.getAttribute('font-size')) : 0.5; return r.left < svg.left - 0.5 || r.right > svg.right + slack; }).map((t) => [t.textContent, t.getBoundingClientRect().left.toFixed(1), t.getBoundingClientRect().right.toFixed(1), svg.left.toFixed(1), svg.right.toFixed(1), t.getAttribute('font-size')]); })()
          JS
          expect(out).to eq([])
        end
      end
    end
  end

  describe 'the transform' do
    it 'stays inside the serverless limits and gives a Commons thumbnail at a standard width' do
      run = trmnl.transform(mocks:, custom_fields:)
      expect(run).to stay_within_serverless_limits
      expect(run.error).to be_nil
      expect(run.data['art']['url']).to match(%r{\Ahttps://upload\.wikimedia\.org/wikipedia/commons/thumb/\h/\h\h/.+/(120|250|500|960|1280|1920)px-})
    end

    it 'never repeats a work of the last fifty' do
      state = nil
      shown = []
      30.times do
        run = trmnl.transform(mocks:, custom_fields:, state: state)
        shown << run.data['art']['id']
        state = run.state
      end
      expect(shown.uniq.length).to eq(shown.length)
    end
  end
end
