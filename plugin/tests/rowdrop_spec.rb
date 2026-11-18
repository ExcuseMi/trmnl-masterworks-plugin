# frozen_string_literal: true

# Nothing is dropped from a row while the row has room for it: the label cell's slack (its width less its widest text) is less than the
# dropped cell's natural width plus its gap. Bruegel's "The Blind Leading the Blind" on the X and the OG once lost its weather with a wide gap.
require 'json'

RSpec.describe 'Masterworks rows drop only what does not fit' do
  BASES_RD = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze
  P = '[data-block="primary"]' unless defined?(P)

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def ics
    day = Time.now.utc.strftime('%Y%m%d')
    ev = ->(uid, start, name) { ['BEGIN:VEVENT', "UID:#{uid}", "DTSTART:#{day}T#{start}00Z", "DTEND:#{day}T#{start.to_i + 1}0000Z", 'RRULE:FREQ=DAILY', "SUMMARY:#{name}", 'LOCATION:Kitchen', 'END:VEVENT'] }
    (['BEGIN:VCALENDAR'] + ev.call(1, '2301', 'First') + ev.call(2, '2302', 'Second') + ['END:VCALENDAR']).join("\r\n")
  end

  def render_rd(device, w, h, title)
    doc = fixture('one-landscape')
    doc['w'][0].merge!('w' => w, 'h' => h, 't' => title, 'a' => 'Pieter Bruegel the Elder')
    doc['col'][doc['w'][0]['c']] = 'Museo di Capodimonte'
    shards = BASES_RD.each_with_object({}) { |b, m| (0..7).each { |k| m["#{b}/landscape-#{k}.json"] = { json: doc }; m["#{b}/portrait-#{k}.json"] = { json: doc } } }
    services = { 'https://geocoding-api.open-meteo.com/*' => { json: fixture('geocode') }, 'https://api.open-meteo.com/*' => { json: fixture('weather-rain') }, 'https://calendar.example.org/*' => { body: ics } }
    fields = { 'weather_location' => 'Paris', 'ics_url' => 'https://calendar.example.org/private/abc/basic.ics', 'show_date' => 'true', 'show_weather' => 'true', 'show_agenda' => 'true', 'label' => 'true' }
    page = trmnl.render(view: 'full', device:, orientation: 'landscape', mocks: shards.merge(services), custom_fields: fields)
    page.has_css?('img.image')
    page
  end

  # [hidden cells' natural width + its gap, in px, the label's slack] of the first dropped cell of the row, or nil
  def dropped(page)
    page.evaluate(<<~JS)
      (() => {
        const row = document.querySelector('#{P} [data-row]');
        if (!row) return null;
        const lab = row.querySelector('[data-cell="l"]');
        if (!lab || !lab.offsetParent) return null;
        const spans = [...lab.querySelectorAll('span')].filter(e => e.offsetParent && !e.classList.contains('hidden'));
        const widest = Math.max(...spans.map(e => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().width; }));
        const slack = lab.getBoundingClientRect().width - widest;
        const out = [];
        [...row.children].filter(k => k.hasAttribute('data-cell') && k.getAttribute('data-cell') !== 'l' && k.getAttribute('data-cell') !== 'date').forEach((k) => {
          const hid = [...k.querySelectorAll('span')].some(e => e.classList.contains('hidden')) || k.classList.contains('hidden');
          if (!hid) return;
          const was = [...k.querySelectorAll('.hidden'), k].filter(e => e.classList.contains('hidden'));
          was.forEach(e => e.classList.remove('hidden'));
          const need = k.getBoundingClientRect().width + parseFloat(getComputedStyle(row).columnGap || 0) + 60;
          was.forEach(e => e.classList.add('hidden'));
          out.push([Math.round(need), Math.round(slack), k.getAttribute('data-cell')]);
        });
        return out;
      })()
    JS
  end

  [['v2', 'X'], ['og_png', 'OG']].each do |device, name|
    it "#{name}: Bruegel's row keeps the weather while the label has room beside it" do
      page = render_rd(device, 3663, 2058, 'The Blind Leading the Blind')
      expect(page).to have_css("#{P} [data-row]")
      # the OG on a long weekday (Wednesday) has no room for it beside the label: there only the general rule below applies
      expect(page.evaluate("[...document.querySelectorAll('#{P} [data-row] [data-weather]')].some(e => e.offsetParent && !e.classList.contains('hidden'))")).to be(true), 'the weather is shown' if device == 'v2'
      (dropped(page) || []).each { |need, slack, cell| expect(slack).to be < need, "#{cell} dropped with #{slack}px free and #{need}px needed" }
    end
  end
end
