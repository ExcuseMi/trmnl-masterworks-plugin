# frozen_string_literal: true

# Masterworks, run with `trmnlp test` from plugin/. No network for data: every part of both shards is mocked from
# tests/fixtures (a slice of the real data set). Pictures are fetched by the browser from Wikimedia.
require 'json'
require 'uri'

RSpec.describe 'Masterworks' do
  let(:custom_fields) { {} }

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  # the data is served from four mirrors (the transform asks them all and takes the newest valid answer)
  MIRRORS = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze

  # the same document for every part of an orientation and every mirror (the transform fetches one part at random)
  def shard_mocks(landscape, portrait)
    MIRRORS.each_with_object({}) do |base, m|
      (0..5).each do |k|
        m["#{base}/landscape-#{k}.json"] = { json: fixture(landscape) }
        m["#{base}/portrait-#{k}.json"] = { json: fixture(portrait) }
      end
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
            expect(page.all('[data-block="primary"][data-gallery], [data-block="primary"][data-mode="full"]').length).to eq(1)
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
            expect(on).to have_css('[data-label] .title, [data-placard] .title')
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
          # the text itself is right-aligned, so it ends on the picture's right edge
          expect(page.evaluate("getComputedStyle(document.querySelector('[data-label] .title')).textAlign")).to eq('right')
          expect(lab[3]).to be <= lay[3] + 3
          # a wide work may take up to 0.92 of the width (GALLERY_WIDE_MAX), others up to 0.75
          expect(edge[2] - edge[0]).to be <= (lay[2] - lay[0]) * 0.935
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
    # the Frame is screen--frame screen--md (a TRMNL bug: no lg:), so its text sizes come from the one branch in shared.liquid
    { 'frame' => 28, 'v2' => 25, 'og_png' => 10 }.each do |device, min_px|
      it "draws the gallery title and the placard title at least #{min_px} px high on #{device}" do
        gal = screen('full', device, mocks: shard_mocks('one-landscape', 'one-portrait'))
        wait(gal)
        expect(gal.evaluate("document.querySelector('[data-label] .title').getBoundingClientRect().height")).to be >= min_px
        full = screen('full', device, mocks: shard_mocks('one-wide-landscape', 'one-portrait'))
        wait(full)
        next unless full.has_css?('[data-placard]')

        expect(full.evaluate("document.querySelector('[data-placard] .title').getBoundingClientRect().height")).to be >= min_px
      end
    end
  end

  describe 'the label can be read: ink with contrast against its mat, in every gallery render' do
    # a label drawn in the mat's own colour is invisible (a black label on a black mat was missing on the Frame): count the
    # pixels of the label's box that differ from the mat in the picture the device gets
    def label_ink_share(page, selector)
      wait(page)
      box = page.evaluate("(() => { const r = document.querySelector('#{selector}').getBoundingClientRect(); return [r.left, r.top, r.width, r.height, window.innerWidth]; })()")
      scale = `identify -format '%w' #{page.png_path}`.to_i / box[4].to_f
      x, y, w, h = [box[0] * scale, box[1] * scale, box[2] * scale, box[3] * scale].map(&:round)
      out = `convert #{page.png_path} -crop #{w}x#{h}+#{x}+#{y} +repage -colorspace Gray -format '%[fx:mean]' info:`
      out.to_f
    end

    %w[frame v2 og_png og_plus].each do |device|
      VIEWS.each do |view|
        { 'one-landscape' => :white, 'one-dark-landscape' => :black }.each do |fixture_name, mat|
          it "#{view} on #{device}, #{mat} mat: the label has ink that contrasts with the mat" do
            page = screen(view, device, mocks: shard_mocks(fixture_name, 'one-portrait'))
            wait(page)
            next unless page.has_css?('[data-label]') && page.has_css?("[data-gallery=\"#{mat}\"]")

            mean = label_ink_share(page, '[data-label]')
            # the share of the label's box that is not the mat colour: some, but a label is mostly mat
            ink = mat == :black ? mean : 1 - mean
            expect(ink).to be > 0.01
          end
        end
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

  describe 'when the picture of the chosen work fails' do
    # two works; the state says the dark one was shown lately, so the light one is the primary and the dark one the backup
    let(:two) { shard_mocks('two-landscape', 'one-portrait') }
    let(:works) { fixture('two-landscape')['w'] }
    let(:light) { works.find { |w| !w['n'] } }
    let(:dark) { works.find { |w| w['n'] } }
    let(:state) { { 'h' => [dark['i'][1..].to_i] } }
    let(:model) { trmnl.transform(mocks: two, custom_fields:, state:).data }
    # trmnlp's asset overrides do not reach the browser's picture requests, so the failure is the browser's own error event, fired on the image
    def fail_picture(page, block)
      page.evaluate("document.querySelector('[data-block=\"#{block}\"] img').dispatchEvent(new Event('error'))")
      Kernel.sleep(0.3)
    end

    def backup_text(page)
      page.evaluate("document.querySelector('[data-block=backup]').innerText").to_s.tr("\u00a0", ' ')
    end

    def visible_block(page, name) = page.evaluate("(() => { const b = document.querySelector('[data-block=\"#{name}\"]'); return !!b && !b.classList.contains('hidden') && b.getBoundingClientRect().height > 0; })()")

    it 'the model has the light work as primary and the dark one as its backup, each with its own look' do
      expect(model['art']['id']).to eq(light['i'])
      expect(model['backup']['art']['id']).to eq(dark['i'])
      expect(model['art']['mat']).to eq('white')
      expect(model['backup']['art']['mat']).to eq('black')
    end

    it 'shows the primary while its picture loads, the backup block stays hidden' do
      page = trmnl.render(view: 'full', device: 'og_png', mocks: two, custom_fields:, state:)
      wait(page)
      expect(visible_block(page, 'primary')).to be(true)
      expect(visible_block(page, 'backup')).to be(false)
    end

    it 'swaps to the backup, with its own label and its own mat, when the primary picture fails' do
      page = trmnl.render(view: 'full', device: 'og_png', mocks: two, custom_fields:, state:)
      wait(page)
      fail_picture(page, 'primary')
      expect(visible_block(page, 'primary')).to be(false)
      expect(visible_block(page, 'backup')).to be(true)
      expect(backup_text(page)).to include(dark['t'])
      expect(page.evaluate("getComputedStyle(document.querySelector('[data-block=\"backup\"]')).backgroundColor")).to eq('rgb(0, 0, 0)')
    end

    it 'swaps in every view and on the Frame' do
      %w[full half_horizontal half_vertical quadrant].each do |view|
        %w[og_png frame].each do |device|
          page = trmnl.render(view:, device:, mocks: two, custom_fields:, state:)
          wait(page)
          fail_picture(page, 'primary')
          expect(visible_block(page, 'backup')).to be(true), "#{view} on #{device}"
          expect(visible_block(page, 'primary')).to be(false), "#{view} on #{device}"
        end
      end
    end

    it 'both pictures failing leaves the backup\'s mat and label (the clean fallback), never a blank screen' do
      page = trmnl.render(view: 'full', device: 'og_png', mocks: two, custom_fields:, state:)
      wait(page)
      fail_picture(page, 'primary')
      page.evaluate("document.querySelector('[data-block=\"backup\"] img').dispatchEvent(new Event('error'))")
      expect(visible_block(page, 'backup')).to be(true)
      expect(backup_text(page)).to include(dark['t'])
    end

    it 'the backup picture is not fetched while the primary shows (lazy)' do
      page = trmnl.render(view: 'full', device: 'og_png', mocks: two, custom_fields:, state:)
      wait(page)
      expect(page.evaluate("document.querySelector('[data-block=\"backup\"] img').getAttribute('loading')")).to eq('lazy')
      expect(page.evaluate("document.querySelector('[data-block=\"primary\"] img').getAttribute('onerror')")).to include('hidden')
    end

    it 'the state records the primary (whether its picture loaded is only known in the browser)' do
      run = trmnl.transform(mocks: two, custom_fields:, state:)
      expect(run.state['h'].last).to eq(light['i'][1..].to_i)
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
      expect(page).to have_css('[data-label] .title', text: title)
      wide = shard_mocks('one-wide-landscape', 'one-portrait')
      wide_url = trmnl.transform(mocks: wide, custom_fields:).data['art']['url']
      wide_title = fixture('one-wide-landscape')['w'].first['t']
      full = trmnl.render(view: 'full', device: 'og_png', mocks: wide, custom_fields:,
                          asset_overrides: { wide_url => { body: 'not a picture', content_type: 'text/plain' } })
      full.has_css?('[data-placard]')
      expect(full).to have_css('[data-placard] .title', text: wide_title)
    end
  end

  describe 'when the data cannot be loaded' do
    let(:mocks) do
      MIRRORS.each_with_object({}) do |base, m|
        (0..5).each do |k|
          m["#{base}/landscape-#{k}.json"] = { status: 500 }
          m["#{base}/portrait-#{k}.json"] = { status: 500 }
        end
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
          # every line of text stays inside its block (the Framework clamps what is too long)
          out = page.evaluate(<<~JS)
            (() => { const box = document.querySelector('#{sel}').getBoundingClientRect();
              return [...document.querySelectorAll('#{sel} .title, #{sel} .label')].filter((t) => { const r = t.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5 || t.scrollWidth > t.clientWidth + 1; }).map((t) => [t.textContent, t.scrollWidth, t.clientWidth]); })()
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
