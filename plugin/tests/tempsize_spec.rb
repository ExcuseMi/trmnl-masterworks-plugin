# frozen_string_literal: true

# The temperature beside the date: cap top level with the day number's, forecast baseline level with the month's, never taller than the number (owner 2026-11-19: "10°" stood taller than the "19" and pushed the forecast line too deep). Stacked layouts (weather under the date) are skipped. Measured in the render from the loaded font.
require 'json'

RSpec.describe 'Masterworks temperature against the day number' do
  BASES_TS = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze
  P = '[data-block="primary"]' unless defined?(P)

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def render_ts(device, aspect, view)
    doc = fixture('one-landscape')
    doc['w'][0].merge!('w' => (aspect * 1000).round, 'h' => 1000)
    shards = BASES_TS.each_with_object({}) { |b, m| (0..15).each { |k| m["#{b}/landscape-#{k}.json"] = { json: doc }; m["#{b}/portrait-#{k}.json"] = { json: doc } } }
    services = { 'https://geocoding-api.open-meteo.com/*' => { json: fixture('geocode') }, 'https://api.open-meteo.com/*' => { json: fixture('weather-rain') } }
    fields = { 'weather_location' => 'Paris', 'show_date' => 'true', 'show_weather' => 'true', 'label' => 'true' }
    page = trmnl.render(view:, device:, orientation: 'landscape', mocks: shards.merge(services), custom_fields: fields)
    page.has_css?('img.image')
    page
  end

  # [cap top, cap height] in screen px of the capital H in the span's font (digits differ by a pixel or two), from the loaded font's own metrics
  def caps(page, sel)
    page.evaluate(<<~JS)
      (() => {
        const e = document.querySelector('#{P} #{sel}');
        if (!e || !e.offsetParent) return null;
        const st = getComputedStyle(e), fs = parseFloat(st.fontSize), cv = document.createElement('canvas').getContext('2d');
        cv.font = st.fontStyle + ' ' + st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily;
        const m = cv.measureText('0'), A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent;
        const lh = parseFloat(st.lineHeight) || (A + D), r = e.getBoundingClientRect(), k = r.width / e.offsetWidth;
        return [r.top + ((lh - A - D) / 2 + A - m.actualBoundingBoxAscent) * k, m.actualBoundingBoxAscent * k];
      })()
    JS
  end

  # baseline y in screen px of the span's first line
  def base(page, sel)
    page.evaluate(<<~JS)
      (() => {
        const e = document.querySelector('#{P} #{sel}');
        if (!e || !e.offsetParent) return null;
        const st = getComputedStyle(e), fs = parseFloat(st.fontSize), cv = document.createElement('canvas').getContext('2d');
        cv.font = st.fontStyle + ' ' + st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily;
        const m = cv.measureText('0'), A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent;
        const lh = parseFloat(st.lineHeight) || (A + D), r = e.getBoundingClientRect(), k = r.width / e.offsetWidth;
        return r.top + ((lh - A - D) / 2 + A) * k;
      })()
    JS
  end

  { 'frame' => 'Frame', 'v2' => 'X', 'og_png' => 'OG' }.each do |device, name|
    [2.5, 1.5, 1.0].each do |aspect|
      %w[full half_vertical].each do |view|
        it "#{name}, #{aspect}, #{view}: the temperature's cap top is not above the number's and it is not taller" do
          page = render_ts(device, aspect, view)
          num = caps(page, '[data-day]')
          tmp = caps(page, '[data-temp]')
          skip 'date or weather not shown here' unless num && tmp
          side = page.evaluate("(() => { const d = document.querySelector('#{P} [data-cell=\"date\"]'), t = document.querySelector('#{P} [data-temp]'); return !!(d && t && t.getBoundingClientRect().left >= d.getBoundingClientRect().right - 1); })()")
          skip 'the weather is not beside the date here (stacked)' unless side
          expect((tmp[0] - num[0]).abs).to be <= 1, "temp cap top #{tmp[0].round(1)} not level with the number's #{num[0].round(1)}"
          expect(tmp[1]).to be <= num[1] + 0.5, "temp cap height #{tmp[1].round(1)} over the number's #{num[1].round(1)}"
          mo = base(page, '[data-month]')
          fc = base(page, '[data-weather]')
          skip 'month or forecast not shown here' unless mo && fc
          expect((fc - mo).abs).to be <= 1, "forecast baseline #{fc.round(1)} not level with the month's #{mo.round(1)}"
        end
      end
    end
  end
end
