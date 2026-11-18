# frozen_string_literal: true

# Pixel guard: what the Frame path must not change. The renders of the other screens (X, OG, small lg screens), with the
# museum label only and with the weather (a fixed fixture, so no clock in the picture), are compared with the committed
# renders in tests/golden/ (ImageMagick compare, a few pixels of dither noise allowed).
# Update on purpose: GOLDEN=update trmnlp test tests/golden_spec.rb
require 'json'
require 'fileutils'

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
      page = trmnl.render(view:, device:, orientation:, mocks: shards(work, work).merge(services), custom_fields: fields.merge('fill' => 'false'))
      page.has_css?('img.image')
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
