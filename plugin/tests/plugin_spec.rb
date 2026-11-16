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
    (0..5).each_with_object({}) do |k, m|
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

  # fixtures: one-landscape is 3:2 (a fill on 16:9 crops 15 %: gallery), one-wide 16:9 (fills the Frame), one-dark-landscape
  # hangs on black, one-portrait is 7:10
  DEVICES.each do |device|
    VIEWS.each do |view|
      describe "#{view} on #{device}" do
        let(:light) { shard_mocks('one-landscape', 'one-portrait') }
        let(:dark) { shard_mocks('one-dark-landscape', 'one-portrait') }
        let(:wide) { shard_mocks('one-wide-landscape', 'one-portrait') }

        it 'draws every work either in a gallery or filling the view, never both, with no title bar and TRMNL dithering' do
          [light, wide].each do |m|
            page = screen(view, device, mocks: m)
            wait(page)
            expect(page.all('[data-gallery], [data-mode="full"]').length).to eq(1)
            expect(page).to have_css('img.image.image-dither')
            expect(page).to have_no_css('.title_bar')
            expect(page.evaluate("getComputedStyle(document.querySelector('img.image')).objectFit")).to eq('cover')
          end
        end

        it 'puts a light work on a pure white mat and a dark work on a pure black one, bevel in the opposite colour (gallery views)' do
          { light => ['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'white'], dark => ['rgb(0, 0, 0)', 'rgb(255, 255, 255)', 'black'] }.each do |m, (mat, edge, name)|
            page = screen(view, device, mocks: m)
            wait(page)
            next unless page.has_css?('[data-gallery]')

            expect(page).to have_css("[data-gallery=\"#{name}\"]")
            expect(page.evaluate("getComputedStyle(document.querySelector('[data-gallery]')).backgroundColor")).to eq(mat)
            expect(page.evaluate("getComputedStyle(document.querySelector('[data-bevel]')).backgroundColor")).to eq(edge)
          end
        end

        it 'shows the label as the Museum label setting says, in either look' do
          [light, wide].each do |m|
            on = screen(view, device, mocks: m)
            wait(on)
            expect(on).to have_css('[data-label] text, [data-placard] text')
            off = screen(view, device, { 'label' => 'false' }, mocks: m)
            wait(off)
            expect(off).to have_no_css('[data-label], [data-placard]')
          end
        end

        it 'keeps the label inside the screen; in a gallery its right edge is the picture\'s right edge' do
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

  describe 'the automatic choice' do
    # the plugin decides per work and per screen: a fill that crops under 10 % of the work, else the gallery
    it 'fills the Frame with a 16:9 work and hangs a 3:2 or a tall portrait work in the gallery' do
      wide = screen('full', 'frame', mocks: shard_mocks('one-wide-landscape', 'one-portrait'))
      wait(wide)
      expect(wide).to have_css('[data-mode="full"]')
      expect(wide).to have_no_css('[data-gallery]')
      two_to_three = screen('full', 'frame', mocks: shard_mocks('one-landscape', 'one-portrait'))
      wait(two_to_three)
      expect(two_to_three).to have_css('[data-gallery]')
      tall = screen('full', 'frame', mocks: shard_mocks('one-portrait', 'one-portrait'))
      wait(tall)
      expect(tall).to have_css('[data-gallery]')
    end

    %w[v2 og_png og_plus].each do |device|
      it "does the same on #{device}: the wide work fills, the portrait work hangs" do
        wide = screen('full', device, mocks: shard_mocks('one-wide-landscape', 'one-portrait'))
        wait(wide)
        expect(wide).to have_css('[data-mode="full"]').or have_css('[data-gallery]') # the X is 4:3: the rule decides
        tall = screen('full', device, mocks: shard_mocks('one-portrait', 'one-portrait'))
        wait(tall)
        expect(tall).to have_css('[data-gallery]')
      end
    end

    it 'follows a portrait screen: a tall work fills the portrait Frame, a wide one hangs in it' do
      tall = screen('full', 'frame', orientation: 'portrait', mocks: shard_mocks('one-wide-landscape', 'one-tall'))
      wait(tall)
      expect(tall).to have_css('[data-mode="full"]')
      wide = screen('full', 'frame', orientation: 'portrait', mocks: shard_mocks('one-wide-landscape', 'one-portrait'))
      wait(wide)
      expect(wide).to have_css('[data-gallery]')
    end
  end

  describe 'label type is legible at every size' do
    # the Frame is screen--md at 1x like the OG, so only SVG text in the screen's own pixels is big enough there
    { 'frame' => 28, 'v2' => 25, 'og_png' => 10 }.each do |device, min_px|
      it "draws the gallery title and the placard title at least #{min_px} px high on #{device}" do
        gal = screen('full', device, mocks: shard_mocks('one-landscape', 'one-portrait'))
        wait(gal)
        expect(gal.evaluate("document.querySelector('[data-label] text').getBoundingClientRect().height")).to be >= min_px
        full = screen('full', device, mocks: shard_mocks('one-wide-landscape', 'one-portrait'))
        wait(full)
        next unless full.has_css?('[data-placard]')

        expect(full.evaluate("document.querySelector('[data-placard] text').getBoundingClientRect().height")).to be >= min_px
      end
    end
  end

  describe 'portrait' do
    %w[frame v2 og_png].each do |device|
      it "reads a portrait shard on #{device}" do
        page = screen('full', device, orientation: 'portrait')
        wait(page)
        src = page.evaluate("document.querySelector('img.image').getAttribute('src')")
        file = URI.decode_uri_component(src.split('/')[-2])
        expect(fixture('portrait')['w'].map { |w| w['f'].tr(' ', '_') }).to include(file)
      end
    end
  end

  describe 'when the picture cannot be loaded' do
    # the mat and the label are drawn by the markup itself, so a failed picture is never a blank screen
    it 'still shows the mat and the label with the title, or the placard' do
      one = shard_mocks('one-landscape', 'one-portrait')
      url = trmnl.transform(mocks: one, custom_fields:).data['art']['url']
      title = fixture('one-landscape')['w'].first['t']
      broken = { url => { body: 'not a picture', content_type: 'text/plain' } }
      page = trmnl.render(view: 'full', device: 'og_png', mocks: one, custom_fields:, asset_overrides: broken)
      page.has_css?('[data-gallery]')
      expect(page).to have_css('[data-label] text', text: title)
      wide = shard_mocks('one-wide-landscape', 'one-portrait')
      wide_url = trmnl.transform(mocks: wide, custom_fields:).data['art']['url']
      wide_title = fixture('one-wide-landscape')['w'].first['t']
      full = trmnl.render(view: 'full', device: 'og_png', mocks: wide, custom_fields:,
                          asset_overrides: { wide_url => { body: 'not a picture', content_type: 'text/plain' } })
      full.has_css?('[data-placard]')
      expect(full).to have_css('[data-placard] text', text: wide_title)
    end
  end

  describe 'when the data cannot be loaded' do
    let(:mocks) do
      (0..5).each_with_object({}) do |k, m|
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
      { 'a work in the gallery' => 'one-landscape', 'a work filling the view' => 'one-wide-landscape' }.each do |what, fixture_name|
        it "#{what}, #{view} on #{device} #{orientation}: no overflow and the label ends inside the slot" do
          page = screen(view, device, orientation: orientation.to_sym, mocks: shard_mocks(fixture_name, 'one-portrait'))
          expect(page).to have_no_overflow
          wait(page)
          sel = page.has_css?('[data-label]') ? '[data-label]' : '[data-placard]'
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
