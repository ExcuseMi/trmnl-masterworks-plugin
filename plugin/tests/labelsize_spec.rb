# frozen_string_literal: true

# Label only (date, weather and agenda off) draws the label at the same sizes as the label of the normal info layouts, on every device
# (owner 2026-11-18). The X and the OG once drew it much smaller.
require 'json'

RSpec.describe 'Masterworks label-only type sizes' do
  BASES_LS = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def render_ls(device, aspect, fields)
    doc = fixture('one-landscape')
    doc['w'][0]['w'] = (aspect * 1000).round
    doc['w'][0]['h'] = 1000
    shards = BASES_LS.each_with_object({}) { |b, m| (0..7).each { |k| m["#{b}/landscape-#{k}.json"] = { json: doc } } }
    services = { 'https://geocoding-api.open-meteo.com/*' => { json: fixture('geocode') }, 'https://api.open-meteo.com/*' => { json: fixture('weather-rain') } }
    page = trmnl.render(view: 'full', device:, orientation: 'landscape', mocks: shards.merge(services), custom_fields: { 'weather_location' => 'Paris', 'label' => 'true' }.merge(fields))
    page.has_css?('img.image')
    page
  end

  # the computed size and the Framework size classes of the title and of the artist line
  def sizes(page)
    page.evaluate("(() => { const out = {}; const pick = (k, sel) => { const e = [...document.querySelectorAll('[data-block=\"primary\"] ' + sel)].find(x => x.offsetParent); if (e) out[k] = [getComputedStyle(e).fontSize, e.className.split(' ').filter(c => /--(base|small|large|xlarge|xxlarge|xxxlarge|mega)$/.test(c)).sort().join(' ')]; };
      pick('title', 'span[data-label], div[data-label] > span:nth-of-type(1)');
      pick('who', '[data-who], div[data-label] > span:nth-of-type(2)'); return out; })()")
  end

  ON = { 'show_date' => 'true', 'show_weather' => 'false', 'show_agenda' => 'false' }.freeze
  OFF = { 'show_date' => 'false', 'show_weather' => 'false', 'show_agenda' => 'false' }.freeze

  %w[v2 og_png frame].each do |device|
    [16.0 / 9, 1.0].each do |aspect|
      it "#{device} #{aspect.round(2)}: label only uses the sizes of the label in the info layout" do
        normal = sizes(render_ls(device, aspect, ON))
        only = sizes(render_ls(device, aspect, OFF))
        expect(only['title']).to eq(normal['title']), "title: label only #{only['title']}, normal #{normal['title']}"
        expect(only['who']).to eq(normal['who']), "artist line: label only #{only['who']}, normal #{normal['who']}"
      end
    end
  end

  # the three sizes on the X and the OG are one Framework step smaller than before (owner decision 2026-11-18); the Frame is unchanged
  CLASSES = {
    'v2' => { 'day' => 'value--xlarge', 'title' => 'label--xxlarge', 'who' => 'label--xlarge' },
    'og_png' => { 'day' => 'value--large', 'title' => 'label--large', 'who' => 'value--xsmall' },
    'frame' => { 'day' => 'value--mega', 'title' => 'value--large', 'who' => 'title--xxlarge' }
  }.freeze

  CLASSES.each do |device, want|
    it "#{device}: day number, title and artist line use #{want.values.join(' / ')}" do
      page = render_ls(device, 16.0 / 9, ON)
      got = page.evaluate("(() => { const c = (s) => { const e = [...document.querySelectorAll('[data-block=\"primary\"] ' + s)].find(x => x.offsetParent); return e ? e.className : ''; }; return { day: c('[data-day]'), title: c('span[data-label]'), who: c('[data-who]') }; })()")
      want.each { |k, cls| expect(got[k].split).to include(cls), "#{k}: #{got[k]}" }
      expect(got['day'].split).not_to include('value--xxlarge') if device == 'v2'
    end
  end

  # the OG draws every info and label line in Inter, never in TRMNL's bitmap label font (owner 2026-11-18: bold, wide tracking, "10: 30")
  { 'date' => ON, 'label only' => OFF, 'date and weather' => { 'show_date' => 'true', 'show_weather' => 'true', 'weather_location' => 'Paris' } }.each do |name, fields|
    [16.0 / 9, 1.0].each do |aspect|
      it "og_png #{aspect.round(2)} #{name}: every line is set in Inter" do
        page = render_ls('og_png', aspect, fields)
        fams = page.evaluate("[...document.querySelectorAll('[data-block=\"primary\"] span')].filter(e => e.offsetParent && !e.classList.contains('hidden') && e.innerText.trim()).map(e => [e.innerText.trim(), getComputedStyle(e).fontFamily])")
        expect(fams).not_to be_empty
        bad = fams.reject { |_, f| f.include?('Inter') }
        expect(bad).to eq([]), "lines not in Inter: #{bad.first(4)}"
      end
    end
  end
end
