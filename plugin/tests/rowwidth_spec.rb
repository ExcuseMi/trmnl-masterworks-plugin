# frozen_string_literal: true

# A row under or over a work spans exactly the work's width: the date's left edge is the work's left edge, the label's right edge its
# right edge, and nothing sticks out on either side (the Great Wave on a Wednesday, the longest weekday, was wider than the work).
# The weekday is the real one; on a Wednesday this is the longest case.
require 'json'

RSpec.describe 'Masterworks row width' do
  BASES_RW = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze
  P = '[data-block="primary"]'

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def ics
    day = Time.now.utc.strftime('%Y%m%d')
    ev = ->(uid, start, name) { ['BEGIN:VEVENT', "UID:#{uid}", "DTSTART:#{day}T#{start}00Z", "DTEND:#{day}T#{start.to_i + 1}0000Z", 'RRULE:FREQ=DAILY', "SUMMARY:#{name}", 'LOCATION:Kitchen', 'END:VEVENT'] }
    (['BEGIN:VCALENDAR'] + ev.call(1, '2301', 'First') + ev.call(2, '2302', 'Second') + ['END:VCALENDAR']).join("\r\n")
  end

  def render_row(device, orientation, w, h, title)
    doc = fixture('one-landscape')
    doc['w'][0].merge!('w' => w, 'h' => h, 't' => title)
    shards = BASES_RW.each_with_object({}) { |b, m| (0..7).each { |k| m["#{b}/landscape-#{k}.json"] = { json: doc }; m["#{b}/portrait-#{k}.json"] = { json: doc } } }
    services = { 'https://geocoding-api.open-meteo.com/*' => { json: fixture('geocode') }, 'https://api.open-meteo.com/*' => { json: fixture('weather-rain') }, 'https://calendar.example.org/*' => { body: ics } }
    fields = { 'weather_location' => 'Paris', 'ics_url' => 'https://calendar.example.org/private/abc/basic.ics', 'show_date' => 'true', 'show_weather' => 'true', 'show_agenda' => 'true', 'label' => 'true' }
    page = trmnl.render(view: 'full', device:, orientation:, mocks: shards.merge(services), custom_fields: fields)
    page.has_css?('img.image')
    page
  end

  def box(page, sel)
    page.evaluate("(() => { const e = document.querySelector('#{sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
  end

  # [device, orientation, work width, work height, title]
  GREAT_WAVE = 'The Great Wave off Kanagawa'
  CASES = [
    ['frame', 'landscape', 8561, 6037, GREAT_WAVE], ['v2', 'landscape', 8561, 6037, GREAT_WAVE], ['og_png', 'landscape', 8561, 6037, GREAT_WAVE],
    ['v2', 'landscape', 1500, 1000, 'Modena Triptych'], ['v2', 'landscape', 1000, 1000, 'Modena Triptych'], ['og_png', 'landscape', 1690, 1000, 'Modena Triptych'],
    ['og_png', 'landscape', 1500, 1000, 'Modena Triptych'], ['frame', 'landscape', 1778, 1000, 'Modena Triptych'], ['frame', 'landscape', 1500, 1000, 'Modena Triptych'],
    ['frame', 'landscape', 1333, 1000, 'Modena Triptych'], ['v2', 'landscape', 2500, 1000, GREAT_WAVE], ['v2', 'landscape', 2000, 1000, GREAT_WAVE],
    ['frame', 'landscape', 2500, 1000, GREAT_WAVE], ['og_png', 'landscape', 2000, 1000, GREAT_WAVE], ['v2', 'portrait', 1000, 1000, GREAT_WAVE], ['og_png', 'portrait', 1500, 1000, GREAT_WAVE]
  ].freeze

  CASES.each do |device, orientation, w, h, title|
    it "#{device} #{orientation} #{(w.to_f / h).round(2)} #{title}: a row spans the work's width, never wider" do
      page = render_row(device, orientation, w, h, title)
      layout = page.evaluate("document.querySelector('#{P}').getAttribute('data-layout')")
      skip "#{layout} layout, not a row" unless %w[band below stack].include?(layout) && page.has_css?("#{P} [data-row]")
      pic = box(page, "#{P} [data-picture]")
      row = box(page, "#{P} [data-row]")
      cells = page.evaluate("[...document.querySelectorAll('#{P} [data-row] [data-cell]')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.getAttribute('data-cell'), r.left, r.right]; })")
      spans = page.evaluate("[...document.querySelectorAll('#{P} [data-row] span')].filter(e => e.offsetParent && e.innerText.trim()).map(e => { const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return [b.left, b.right]; })")
      info = "row #{row} work #{pic} cells #{cells}"
      expect(row[0]).to be >= pic[0] - 2, "the row starts left of the work: #{info}"
      expect(row[2]).to be <= pic[2] + 2, "the row ends right of the work: #{info}"
      expect(spans.map(&:first).min).to be >= pic[0] - 2, "text left of the work: #{info}"
      expect(spans.map(&:last).max).to be <= pic[2] + 2, "text right of the work: #{info}"
      expect(cells.first[1]).to be_within(2).of(pic[0]), "the date's left edge is the work's left edge: #{info}"
      lab = cells.find { |c| c[0] == 'l' }
      expect(lab[2]).to be_within(2).of(pic[2]), "the label's right edge is the work's right edge: #{info}" if lab
    end
  end
end
