# frozen_string_literal: true

# In every column layout the column is exactly as high as the work: the first line's cap top (the day number, or the title in label-only)
# is level with the image's top edge (label only: the label is one compact block at the bottom, empty above) and the last line's baseline with the image's bottom edge (within 2 px; owner 2026-11-18, the OG Great
# Wave column started 16 px above the image and ended 15 px below it).
require 'json'

RSpec.describe 'Masterworks column bounds' do
  BASES_CB = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def ics
    day = Time.now.utc.strftime('%Y%m%d')
    ev = ->(uid, start, name) { ['BEGIN:VEVENT', "UID:#{uid}", "DTSTART:#{day}T#{start}00Z", "DTEND:#{day}T#{start.to_i + 1}0000Z", 'RRULE:FREQ=DAILY', "SUMMARY:#{name}", 'LOCATION:Kitchen', 'END:VEVENT'] }
    (['BEGIN:VCALENDAR'] + ev.call(1, '2301', 'First') + ev.call(2, '2302', 'Second') + ['END:VCALENDAR']).join("\r\n")
  end

  def render_cb(device, orientation, w, h, title, fields)
    doc = fixture('one-landscape')
    doc['w'][0].merge!('w' => w, 'h' => h, 't' => title)
    if title == 'Alba Madonna'
      doc['col'][doc['w'][0]['c']] = 'Hermitage Museum'
      doc['med'][doc['w'][0]['e']] = 'Oil on canvas'
    end
    shards = BASES_CB.each_with_object({}) { |b, m| (0..15).each { |k| m["#{b}/landscape-#{k}.json"] = { json: doc }; m["#{b}/portrait-#{k}.json"] = { json: doc } } }
    services = { 'https://geocoding-api.open-meteo.com/*' => { json: fixture('geocode') }, 'https://api.open-meteo.com/*' => { json: fixture('weather-rain') }, 'https://calendar.example.org/*' => { body: ics } }
    page = trmnl.render(view: 'full', device:, orientation:, mocks: shards.merge(services), custom_fields: fields)
    page.has_css?('img.image')
    page
  end

  # [top difference, bottom difference] in px of the column's first cap top and last baseline to the image's edges, or nil (no column)
  def bounds(page)
    page.evaluate(<<~JS)
      (() => {
        const lay = document.querySelector('[data-block="primary"]');
        const col = lay.querySelector('[data-info-block="column"][data-fit="column"], [data-label-col-text]');
        if (!col || !col.offsetParent) return null;
        const img = lay.querySelector('img.image').getBoundingClientRect();
        const sp = [...col.querySelectorAll('span')].filter(e => e.offsetParent && !e.classList.contains('hidden') && e.innerText.trim());
        if (!sp.length) return null;
        const S = lay.getBoundingClientRect().width / (lay.offsetWidth || 1); // the X draws 1040 CSS px on 1872
        const cv = document.createElement('canvas').getContext('2d');
        const met = (e) => { const st = getComputedStyle(e); cv.font = st.fontStyle + ' ' + st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily;
          const t = cv.measureText(e.innerText.trim().charAt(0)), lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.2, A = t.fontBoundingBoxAscent, D = t.fontBoundingBoxDescent, hl = (lh - A - D) / 2;
          return { cap: (hl + A - t.actualBoundingBoxAscent) * S, base: (hl + A) * S, lh: lh * S }; };
        const f = sp[0], l = sp[sp.length - 1], rf = f.getBoundingClientRect(), rl = l.getBoundingClientRect(), ml = met(l);
        const lab = sp.filter(e => e.hasAttribute('data-label') || e.hasAttribute('data-title') || e.hasAttribute('data-who') || e.hasAttribute('data-museum') || e.closest('[data-label-col-text]'));
        const gaps = lab.slice(1).map((e, i) => (e.getBoundingClientRect().top - lab[i].getBoundingClientRect().bottom) / met(e).lh);
        return [rf.top + met(f).cap - img.top, rl.bottom - ml.lh + ml.base - img.bottom, Math.max(0, ...gaps), lab.length];
      })()
    JS
  end

  AG = { 'weather_location' => 'Paris', 'ics_url' => 'https://calendar.example.org/private/abc/basic.ics', 'show_date' => 'true', 'show_weather' => 'true', 'show_agenda' => 'true', 'label' => 'true' }.freeze
  LO = { 'label' => 'true' }.freeze

  CASES_CB = [
    ['og_png', 'landscape', 8561, 6037, 'The Great Wave off Kanagawa', AG], ['og_png', 'landscape', 1000, 1000, 'Modena Triptych', AG],
    ['v2', 'landscape', 1000, 1000, 'Modena Triptych', AG], ['v2', 'landscape', 750, 1000, 'Modena Triptych', AG], ['v2', 'landscape', 8561, 6037, 'The Great Wave off Kanagawa', AG],
    ['frame', 'landscape', 750, 1000, 'Modena Triptych', AG], ['frame', 'landscape', 400, 1000, 'The Bookworm', AG], ['frame', 'landscape', 1500, 1000, 'Modena Triptych', AG],
    ['frame', 'landscape', 1000, 1000, 'Modena Triptych', AG],
    ['og_png', 'landscape', 1000, 1000, 'Modena Triptych', LO], ['v2', 'landscape', 1000, 1000, 'Modena Triptych', LO], ['v2', 'landscape', 750, 1000, 'Modena Triptych', LO],
    ['frame', 'landscape', 750, 1000, 'Modena Triptych', LO], ['frame', 'landscape', 1000, 1000, 'Modena Triptych', LO], ['og_png', 'landscape', 8561, 6037, 'The Great Wave off Kanagawa', LO]
  ].freeze

  CASES_CB.each do |device, orientation, w, h, title, fields|
    it "#{device} #{orientation} #{(w.to_f / h).round(2)} #{title}, #{fields.key?('show_date') ? 'info' : 'label only'}: the column is the work's height" do
      page = render_cb(device, orientation, w, h, title, fields)
      b = bounds(page)
      skip 'no column layout' unless b
      expect(b[0].abs).to be <= 2, "the first cap top is #{b[0].round(1)} px from the image's top edge" if fields.key?('show_date')
      expect(b[2]).to be <= 1.5, "the label lines are #{b[2].round(1)} line heights apart (one compact block)"
      expect(b[1].abs).to be <= 2, "the last baseline is #{b[1].round(1)} px from the image's bottom edge"
    end
  end

  # label only with room: the OG shows the title, the artist line and the museum line (it once kept only the title)
  it 'og_png label only, square work: all three label lines are shown' do
    page = render_cb('og_png', 'landscape', 1000, 1000, 'Alba Madonna', LO)
    b = bounds(page)
    skip 'no column layout' unless b
    expect(b[3]).to eq(3), "#{b[3]} label lines shown"
  end
end
