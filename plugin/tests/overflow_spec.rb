# frozen_string_literal: true

# With fill on (the default) more works fill the screen, and a placard over them overflowed the playdate's tiny slots (base check 2026-11-17).
# A label that wraps on a small lg screen (TRMNL reviews 2026-11-17 let the artist and detail lines take 2 lines there) must
# not push the work out of its slot: the base check found the portrait half_horizontal and quadrant views of joan_6,
# joan_6_pro, joan_13 and onyx_boox_go_10_3_lumi overflowing (and tcl_nxtpaper_14 in half_horizontal). The label is long
# on purpose: the one-landscape fixture's own is "Tempera on panel . Galleria Estense".
require 'json'

RSpec.describe 'Masterworks label and info never overflow a small screen' do
  BASES = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def shards(landscape, portrait)
    BASES.each_with_object({}) do |base, m|
      (0..15).each do |k|
        m["#{base}/landscape-#{k}.json"] = { json: fixture(landscape) }
        m["#{base}/portrait-#{k}.json"] = { json: fixture(portrait) }
      end
    end
  end

  let(:services) do
    { 'https://geocoding-api.open-meteo.com/*' => { json: fixture('geocode') }, 'https://api.open-meteo.com/*' => { json: fixture('weather-rain') } }
  end
  let(:all_on) { { 'show_date' => 'true', 'show_weather' => 'true', 'weather_location' => 'Paris' } }

  %w[joan_6 joan_6_pro joan_13 onyx_boox_go_10_3_lumi tcl_nxtpaper_14 playdate].each do |device|
    %w[half_horizontal quadrant full].each do |view|
      [['the label only', {}], ['the label only, fill off', { 'fill' => 'false' }], ['the info on', :info], ['the info on, fill off', :info_off]].each do |what, fields|
        it "#{view} on #{device} portrait, #{what}: nothing overflows" do
          custom = fields == :info ? all_on : fields == :info_off ? all_on.merge('fill' => 'false') : fields
          page = trmnl.render(view:, device:, orientation: 'portrait', mocks: shards('one-landscape', 'one-portrait').merge(services), custom_fields: custom)
          expect(page).to have_no_overflow
        end
      end
    end
  end
end
