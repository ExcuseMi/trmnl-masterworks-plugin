# frozen_string_literal: true

# Masterworks, run with `trmnlp test` from plugin/. No network for data: both shards are mocked from tests/fixtures
# (a slice of the real data set); the pictures come from the asset override in .trmnlp.yml (a local file).
require 'json'
require 'uri'

RSpec.describe 'Masterworks' do
  let(:base) { 'https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data' }
  let(:landscape) { JSON.parse(File.read(File.join(__dir__, 'fixtures', 'landscape.json'))) }
  let(:portrait) { JSON.parse(File.read(File.join(__dir__, 'fixtures', 'portrait.json'))) }
  let(:mocks) { { "#{base}/landscape.json" => { json: landscape }, "#{base}/portrait.json" => { json: portrait } } }
  let(:custom_fields) { {} }

  # one work per shard: the recipe compares a light and a dark render of the same screen, which a random pick would break
  it_behaves_like 'a publishable recipe' do
    let(:mocks) do
      { "#{base}/landscape.json" => { json: JSON.parse(File.read(File.join(__dir__, 'fixtures', 'one-landscape.json'))) },
        "#{base}/portrait.json" => { json: JSON.parse(File.read(File.join(__dir__, 'fixtures', 'one-portrait.json'))) } }
    end
  end

  VIEWS = %w[full half_horizontal half_vertical quadrant].freeze
  DEVICES = %w[frame v2 og_png og_plus].freeze

  def screen(view, device, fields = {}, orientation: 'landscape')
    trmnl.render(view:, device:, orientation:, mocks:, custom_fields: custom_fields.merge(fields))
  end

  def fit_of(page)
    page.has_css?('img.image') # wait for the page
    page.evaluate("getComputedStyle(document.querySelector('img.image')).objectFit")
  end

  DEVICES.each do |device|
    VIEWS.each do |view|
      describe "#{view} on #{device}" do
        it 'fills the view with the artwork, cropped by default (Fill)' do
          expect(fit_of(screen(view, device))).to eq('cover')
        end

        it 'shows the whole work on a mat for "Whole work"' do
          expect(fit_of(screen(view, device, { 'fit' => 'whole' }))).to eq('contain')
        end

        it 'shows no title bar' do
          expect(screen(view, device)).to have_no_css('.title_bar')
        end

        it 'the corner placard names the work; "Off" shows only the artwork' do
          on = screen(view, device)
          on.has_css?('img.image')
          expect(on).to have_css('[data-placard]')
          expect(on).to have_text(/\S/)
          off = screen(view, device, { 'label' => 'off' })
          off.has_css?('img.image')
          expect(off).to have_no_css('[data-placard]')
        end

        it 'the image asks TRMNL for dithering' do
          page = screen(view, device)
          page.has_css?('img.image')
          expect(page).to have_css('img.image.image-dither')
        end
      end
    end
  end

  describe 'narrow slots' do
    # the placard once stuck out by 1 px in the 105 px wide half_vertical slot of a playdate (found by the shared base checks)
    [%w[half_vertical playdate portrait], %w[quadrant playdate landscape], %w[half_vertical og_png landscape]].each do |view, device, orientation|
      it "#{view} on #{device} #{orientation} has no overflow" do
        page = screen(view, device, {}, orientation: orientation.to_sym)
        expect(page).to have_no_overflow
        # geometry, not the matcher: the plate (left offset included) must end inside the slot, whatever the font does
        page.has_css?('[data-placard]')
        edge = page.evaluate(<<~JS)
          (() => { const p = document.querySelector('[data-placard]').getBoundingClientRect(), l = document.querySelector('.layout').getBoundingClientRect(); return [p.right, l.right]; })()
        JS
        expect(edge[0]).to be <= edge[1] - 4
      end
    end
  end

  describe 'portrait' do
    %w[frame v2 og_png].each do |device|
      it "reads the portrait shard on #{device}" do
        page = screen('full', device, orientation: 'portrait')
        page.has_css?('img.image')
        src = page.evaluate("document.querySelector('img.image').getAttribute('src')")
        file = URI.decode_uri_component(src.split('/')[-2])
        expect(portrait['w'].map { |w| w['f'].tr(' ', '_') }).to include(file)
      end
    end
  end

  describe 'when the data cannot be loaded' do
    let(:mocks) { { "#{base}/landscape.json" => { status: 500 }, "#{base}/portrait.json" => { status: 500 } } }

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

  describe 'the transform' do
    it 'stays inside the serverless limits and gives a Commons thumbnail at a standard width' do
      run = trmnl.transform(mocks:, custom_fields:)
      expect(run).to stay_within_serverless_limits
      expect(run.error).to be_nil
      expect(run.data['art']['url']).to match(%r{\Ahttps://upload\.wikimedia\.org/wikipedia/commons/thumb/\h/\h\h/.+/(120|250|500|960|1280|1920|3840)px-})
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
