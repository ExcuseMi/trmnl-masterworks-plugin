# frozen_string_literal: true

# Pixel guard: what the Frame path must not change. The renders of the other screens (X, OG, small lg screens), with the
# museum label only and with the weather (a fixed fixture, so no clock in the picture), are compared with the committed
# renders in tests/golden/ (ImageMagick compare, a few pixels of dither noise allowed).
# The work image is a committed local file (tests/fixtures/img/<work>.jpg) served in place of every Commons URL, so no
# render hits the network and the tones never change between runs; a render that asks for any other outside image fails.
# Update on purpose: GOLDEN=update trmnlp test tests/golden_spec.rb
require 'json'
require 'fileutils'

# trmnlp 0.34 compares the DECODED request path with the still-encoded file name of an overridden URL, so a name with a
# percent escape (Kandinsky, El Greco) never matched and the picture was fetched live from Commons. Answer such a request
# from the override, and never from the network.
module TRMNLP::Testing
  module OverrideNeverFetches
    private

    def override_asset(path, user_agent)
      id, rest = path.match(AssetCache::OVERRIDE_PATH)&.captures
      key, target = @lock.synchronize { @overrides[id] }
      return unless key

      rest = URI.decode_uri_component(rest)
      return unless folder?(key) || rest == URI.decode_uri_component(File.basename(URI(key).path))

      overridden(key, target, rest, user_agent)
    end
  end
  AssetCache.prepend(OverrideNeverFetches)
end

RSpec.describe 'Masterworks pixel guard for the screens that are not the Frame' do
  BASES_G = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze
  GOLDEN_DIR = File.join(__dir__, 'golden')

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def shards(landscape, portrait)
    BASES_G.each_with_object({}) do |base, m|
      (0..15).each do |k|
        m["#{base}/landscape-#{k}.json"] = { json: fixture(landscape) }
        m["#{base}/portrait-#{k}.json"] = { json: fixture(portrait) }
      end
    end
  end

  IMAGE_HOST = %r{https?://(?!127\.0\.0\.1)[^\s"'<>),;]+\.(?:jpe?g|png|gif|webp|tiff?|svg)\b[^\s"'<>),;]*}i
  FIXTURE_IMAGES = File.join(__dir__, 'fixtures', 'img')

  # Every Commons image URL the page names (read from the unloaded page, so a width the data does not list is covered),
  # each answered by the work's local picture.
  def image_overrides(work, render_args)
    html = trmnl.render(view: render_args.delete(:view), **render_args).html
    html.scan(%r{https://upload\.wikimedia\.org/[^\s"'<>),;]+}).uniq.to_h do |url|
      [url, { body: File.binread(File.join(FIXTURE_IMAGES, "#{work}.jpg")), content_type: 'image/jpeg' }]
    end
  end

  # Every img.image decoded: a blank box (naturalWidth 0) is a golden that guards nothing.
  def unloaded_images(page)
    page.has_css?('img.image')
    js = "return Array.from(document.querySelectorAll('img.image')).map(i => (i.complete && i.naturalWidth > 0) ? null : i.src).filter(Boolean)"
    bad = []
    40.times do
      bad = page.evaluate("(() => { #{js.sub('return ', 'return ')} })()")
      break if bad.empty?

      sleep 0.25
    end
    bad
  end

  # The guard: the page names no image URL that is not answered from disk (an unanswered one is fetched live by Firefox).
  def outside_images(page, overrides)
    page.html.scan(IMAGE_HOST).uniq - overrides.keys
  end

  let(:services) do
    { 'https://geocoding-api.open-meteo.com/*' => { json: fixture('geocode') }, 'https://api.open-meteo.com/*' => { json: fixture('weather-rain') } }
  end

  CASES = [
    ['og_png', 'landscape', 'full', 'one-landscape', {}], ['og_png', 'landscape', 'full', 'one-landscape', { 'show_weather' => 'true', 'weather_location' => 'Paris' }],
    ['og_png', 'landscape', 'full', 'one-tall', { 'show_weather' => 'true', 'weather_location' => 'Paris' }],
    ['v2', 'landscape', 'full', 'one-landscape', {}], ['v2', 'landscape', 'full', 'one-landscape', { 'show_weather' => 'true', 'weather_location' => 'Paris' }],
    ['v2', 'landscape', 'full', 'one-tall', { 'show_weather' => 'true', 'weather_location' => 'Paris' }],
    ['v2', 'portrait', 'full', 'one-wide-landscape', { 'show_weather' => 'true', 'weather_location' => 'Paris' }],
    ['joan_6_pro', 'portrait', 'full', 'one-portrait', {}], ['joan_6_pro', 'portrait', 'half_horizontal', 'one-landscape', { 'show_weather' => 'true', 'weather_location' => 'Paris' }],
    ['tcl_nxtpaper_14', 'portrait', 'full', 'one-landscape', { 'show_weather' => 'true', 'weather_location' => 'Paris' }]
  ].freeze

  CASES.each do |device, orientation, view, work, fields|
    name = [device, orientation, view, work, fields.empty? ? 'label' : 'weather'].join('-')
    it "#{name}: the render is the committed one" do
      args = { view:, device:, orientation:, mocks: shards(work, work).merge(services), custom_fields: fields.merge('fill' => 'false') }
      overrides = image_overrides(work, args.dup)
      expect(overrides).not_to be_empty, "#{name}: no work image URL in the data, the guard would see nothing"
      page = trmnl.render(**args, asset_overrides: overrides)
      expect(unloaded_images(page)).to eq([]), "#{name}: an img.image did not load (blank box in the render)"
      expect(outside_images(page, overrides)).to eq([]), "#{name}: the render asks for images that are not served from disk"
      golden = File.join(GOLDEN_DIR, "#{name}.png")
      if ENV['GOLDEN'] == 'update'
        FileUtils.mkdir_p(GOLDEN_DIR)
        FileUtils.cp(page.png_path, golden)
      else
        expect(File).to exist(golden), "no golden render #{golden} (GOLDEN=update trmnlp test tests/golden_spec.rb)"
        diff = `compare -metric AE -fuzz 2% #{page.png_path} #{golden} null: 2>&1`.to_f
        expect(diff).to be <= 40, "#{name}: #{diff} pixels differ from the committed render"
      end
    end
  end
end
