# frozen_string_literal: true

# The Frame (landscape) with info on: a band for works 16:9 and wider, else the whole work with an info column on its right.
# Geometry in the browser; Open-Meteo and the calendar are mocked (tests/fixtures).
require 'json'

RSpec.describe 'Masterworks Frame layouts' do
  BASES_FRAME = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze
  LINK_FRAME = 'https://calendar.example.org/private/abc/basic.ics'

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def shape_shards(aspect, fixture_name = 'one-landscape')
    doc = fixture(fixture_name)
    doc['w'][0]['w'] = (aspect * 1000).round
    doc['w'][0]['h'] = 1000
    BASES_FRAME.each_with_object({}) do |base, m|
      (0..7).each do |k|
        m["#{base}/landscape-#{k}.json"] = { json: doc }
        m["#{base}/portrait-#{k}.json"] = { json: doc }
      end
    end
  end

  # three events today: only the next two may be shown
  def ics
    day = Time.now.utc.strftime('%Y%m%d')
    ev = ->(uid, start, name) { ['BEGIN:VEVENT', "UID:#{uid}", "DTSTART:#{day}T#{start}00Z", "DTEND:#{day}T#{start.to_i + 1}0000Z", 'RRULE:FREQ=DAILY', "SUMMARY:#{name}", 'LOCATION:Kitchen', 'END:VEVENT'] }
    (['BEGIN:VCALENDAR'] + ev.call(1, '2301', 'First') + ev.call(2, '2302', 'Second') + ev.call(3, '2303', 'Third') + ['END:VCALENDAR']).join("\r\n")
  end

  let(:services) do
    { 'https://geocoding-api.open-meteo.com/*' => { json: fixture('geocode') }, 'https://api.open-meteo.com/*' => { json: fixture('weather-rain') }, 'https://calendar.example.org/*' => { body: ics } }
  end

  def frame(fields, aspect, fixture_name = 'one-landscape', device: 'frame', orientation: 'landscape')
    base = { 'weather_location' => 'Paris', 'ics_url' => LINK_FRAME }
    page = trmnl.render(view: 'full', device:, orientation:, mocks: shape_shards(aspect, fixture_name).merge(services), custom_fields: base.merge(fields))
    page.has_css?('img.image')
    page
  end

  def box(page, selector)
    page.evaluate("(() => { const e = document.querySelector('#{selector}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
  end

  def all_on = { 'show_date' => 'true', 'show_weather' => 'true', 'show_agenda' => 'true', 'label' => 'true' }
  P = '[data-block="primary"]'

  BAND_SHAPES = { 'panorama 2.5:1' => 2.5, '2:1' => 2.0, '16:9' => 16.0 / 9 }.freeze
  COLUMN_SHAPES = { '3:2' => 1.5, '4:3' => 4.0 / 3, 'square' => 1.0, '3:4' => 0.75, 'scroll 1:2.5' => 0.4 }.freeze

  BAND_SHAPES.each do |name, aspect|
    it "#{name}: the band layout, the picture covers a band inside equal margins, the strip is as wide as the band" do
      page = frame(all_on, aspect)
      expect(page).to have_css("#{P}[data-layout=\"band\"]")
      lay = box(page, P)
      pic = box(page, "#{P} [data-picture]")
      strip = box(page, "#{P} [data-info-block]")
      expect(pic[0] - lay[0]).to be_within(2).of(lay[2] - pic[2]), 'equal left and right margins'
      expect(pic[1] - lay[1]).to be_within(2).of(strip[1] - pic[3]), 'the margin above the band equals the one between band and strip'
      expect(pic[0] - lay[0]).to be_within(3).of(pic[1] - lay[1]), 'the same margin on every side'
      expect(strip[0]).to be_within(2).of(pic[0])
      expect(strip[2]).to be_within(2).of(pic[2])
      expect(page.evaluate("getComputedStyle(document.querySelector('#{P} [data-picture] img')).objectFit")).to eq('cover')
      cols = page.evaluate("[...document.querySelectorAll('#{P} [data-col]')].map(e => e.getBoundingClientRect().width)")
      expect(cols.size).to eq(4), 'weather, two events, the label'
      expect(cols.max - cols.min).to be <= 2, 'equal widths'
      expect(page.evaluate("document.querySelectorAll('#{P} [data-rule]').length")).to eq(cols.size), 'one rule on top of every column'
    end
  end

  COLUMN_SHAPES.each do |name, aspect|
    it "#{name}: the column layout, the whole work and its column are one centred group, the label's last line on the picture's bottom" do
      page = frame(all_on, aspect)
      expect(page).to have_css("#{P}[data-layout=\"column\"]")
      lay = box(page, P)
      pic = box(page, "#{P} [data-picture]")
      col = box(page, "#{P} [data-info-block]")
      expect(pic[0] - lay[0]).to be_within(4).of(lay[2] - col[2]), "equal outer margins of the group: #{lay} #{pic} #{col}"
      expect(col[0]).to be > pic[2], 'the column is on the right of the picture'
      expect(col[0] - pic[2]).to be_within(3).of(lay[2] * 0.03), 'a fixed gutter'
      expect(col[1]).to be_within(2).of(pic[1]), 'the column top is the picture top'
      label = box(page, "#{P} [data-slot=\"label\"]")
      expect(label[3]).to be_within(2).of(pic[3]), "the label's bottom is the picture's bottom: #{label} #{pic}"
      last = page.evaluate("(() => { const r = document.querySelector('#{P} [data-museum]').getBoundingClientRect(); return r.bottom; })()")
      expect(last).to be_within(4).of(pic[3]), "the label's last line is on the picture's bottom edge"
      events = box(page, "#{P} [data-event]:last-of-type") || box(page, "#{P} [data-event]")
      expect(events[3]).to be < label[1], 'the top block never meets the label'
      expect(page.evaluate("document.querySelectorAll('#{P} [data-rule]').length")).to eq(0), 'no rules in the column'
      ratio = ((pic[2] - pic[0]) / (pic[3] - pic[1])) / aspect
      expect(ratio).to be_within(0.03).of(1), 'the picture has the work\'s shape (the whole work)'
    end
  end

  it 'the painting label is regular weight, the event titles are bold; at most two events' do
    [2.0, 1.5].each do |aspect|
      page = frame(all_on, aspect)
      expect(page.evaluate("document.querySelectorAll('#{P} [data-event]').length")).to eq(2), 'the next two events, the third is dropped'
      expect(page).to have_no_text('Third')
      label_w = page.evaluate("[...document.querySelectorAll('#{P} [data-label], #{P} [data-who], #{P} [data-museum]')].map(e => Number(getComputedStyle(e).fontWeight))")
      event_w = page.evaluate("[...document.querySelectorAll('#{P} [data-event-title]')].map(e => Number(getComputedStyle(e).fontWeight))")
      expect(label_w.max).to be <= 500, "#{aspect}: no bold in the label"
      expect(event_w.min).to be >= 600, "#{aspect}: bold event titles"
    end
  end

  it 'text is black on a white mat and white on a black mat, nothing cut' do
    { 'one-landscape' => 'rgb(0, 0, 0)', 'one-dark-landscape' => 'rgb(255, 255, 255)' }.each do |fx, ink|
      [2.0, 1.0].each do |aspect|
        page = frame(all_on, aspect, fx)
        expect(page.evaluate("getComputedStyle(document.querySelector('#{P} [data-day]')).color")).to eq(ink)
        cut = page.evaluate("[...document.querySelectorAll('#{P} [data-info-block] [data-clamp]')].filter(e => e.scrollHeight > e.clientHeight + 4 || e.scrollWidth > e.clientWidth + 2).map(e => e.innerText)")
        expect(cut).to eq([])
      end
    end
  end

  # every combination of the four switches, for a band case and a column case
  KEYS_FRAME = %w[show_date show_weather show_agenda label].freeze
  (0..15).each do |mask|
    on = KEYS_FRAME.each_with_index.select { |_, i| mask[i] == 1 }.map(&:first)
    fields = KEYS_FRAME.to_h { |k| [k, on.include?(k) ? 'true' : 'false'] }
    strip = (on & %w[show_date show_weather show_agenda]).any?
    { 'band' => 2.0, 'column' => 1.5 }.each do |layout, aspect|
      it "#{layout}, on: #{on.empty? ? 'nothing' : on.join(' ')}: only the parts that are on, no empty column, no stray rule" do
        page = frame(fields, aspect)
        unless strip
          expect(page).to have_no_css("#{P} [data-info-block]")
          expect(page).to have_no_css("#{P} [data-layout]")
          label = on.include?('label')
          expect(page.has_css?("#{P} [data-placard], #{P} [data-label]")).to eq(label), 'the label alone is the plain work label; nothing on is the plain work'
          next
        end
        expect(page).to have_css("#{P}[data-layout=\"#{layout}\"]")
        { 'date' => 'show_date', 'weather' => 'show_weather', 'agenda' => 'show_agenda' }.each do |part, key|
          expect(page.has_css?("#{P} [data-info=\"#{part}\"]")).to eq(on.include?(key)), part
        end
        expect(page.has_css?("#{P} [data-slot=\"label\"]")).to eq(on.include?('label')), 'the label'
        texts = page.evaluate("[...document.querySelectorAll('#{P} [data-col]')].map(e => e.innerText.trim())")
        expect(texts).to all(satisfy { |t| !t.empty? }), 'no empty column'
        cols = page.evaluate("[...document.querySelectorAll('#{P} [data-col]')].map(e => e.getBoundingClientRect().width)")
        rules = page.evaluate("document.querySelectorAll('#{P} [data-rule]').length")
        if layout == 'band'
          expect(rules).to eq(cols.size), 'a rule on every column, none elsewhere'
          expect(cols.max - cols.min).to be <= 2, 'equal widths' unless cols.empty?
          lefts = page.evaluate("[...document.querySelectorAll('#{P} [data-col]')].map(e => e.getBoundingClientRect().left)")
          expect(lefts).to eq(lefts.sort)
          expect(page.evaluate("document.querySelector('#{P} [data-slot=\"label\"]') === document.querySelector('#{P} [data-col]:last-of-type')")).to be(true) if on.include?('label')
        else
          expect(rules).to eq(0)
          if on.include?('label')
            pic = box(page, "#{P} [data-picture]")
            expect(box(page, "#{P} [data-slot=\"label\"]")[3]).to be_within(2).of(pic[3]), 'the label stays at the bottom'
          end
        end
        cut = page.evaluate("[...document.querySelectorAll('#{P} [data-info-block] [data-clamp]')].filter(e => e.scrollHeight > e.clientHeight + 4 || e.scrollWidth > e.clientWidth + 2).map(e => e.innerText)")
        expect(cut).to eq([])
      end
    end
  end

  # the X (v2) and the OG: the same two layouts at their own sizes; what does not fit is dropped (events, then the forecast line, never the date or the label)
  { 'v2' => 'x', 'og_png' => 'o' }.each do |device, profile|
    [1.0, 0.75].each do |aspect|
      it "#{device}, #{aspect}: the column layout in the device's profile, group centred, the label on the picture's bottom, date and label always there" do
        page = frame(all_on, aspect, device:)
        expect(page).to have_css("#{P}[data-layout=\"column\"][data-profile=\"#{profile}\"]")
        lay = box(page, P)
        pic = box(page, "#{P} [data-picture]")
        col = box(page, "#{P} [data-info-block]")
        expect(pic[0] - lay[0]).to be_within(6).of(lay[2] - col[2]), 'one centred group'
        expect(col[0]).to be > pic[2]
        expect(col[1]).to be_within(2).of(pic[1])
        expect(box(page, "#{P} [data-slot=\"label\"]")[3]).to be_within(3).of(pic[3])
        expect(page).to have_css("#{P} [data-day]")
        expect(page).to have_css("#{P} [data-label]")
        events = page.evaluate("document.querySelectorAll('#{P} [data-event]').length")
        forecast = page.has_css?("#{P} [data-weather]")
        expect(events).to be <= 2
        expect(events).to eq(0) unless forecast # the forecast line goes only after every event
        cut = page.evaluate("[...document.querySelectorAll('#{P} [data-info-block] [data-clamp]')].filter(e => e.scrollHeight > e.clientHeight + 4 || e.scrollWidth > e.clientWidth + 2).map(e => e.innerText)")
        expect(cut).to eq([])
        expect(page).to have_no_overflow
      end
    end

    it "#{device}: a work 16:9 and wider gets the band when its fill crops little, whole otherwise; nothing overlaps" do
      page = frame(all_on, 2.4, device:)
      expect(page).to have_css("#{P}[data-layout=\"band\"]")
      pic = box(page, "#{P} [data-picture]")
      strip = box(page, "#{P} [data-info-block]")
      expect(strip[1]).to be >= pic[3] - 1
      expect(page.evaluate("document.querySelectorAll('#{P} [data-rule]').length")).to eq(page.evaluate("document.querySelectorAll('#{P} [data-col]').length"))
    end
  end

  it 'the X and the OG band: at most one event (date, weather, next event, label), and the painting label is never cut with an ellipsis, on every device' do
    { 'v2' => 2.2, 'og_png' => 2.2, 'frame' => 2.2 }.each do |device, aspect|
      page = frame(all_on, aspect, device:)
      expect(page).to have_css("#{P}[data-layout=\"band\"]")
      events = page.evaluate("document.querySelectorAll('#{P} [data-event]').length")
      expect(events).to eq(device == 'frame' ? 2 : 1), device
      expect(page.evaluate("document.querySelectorAll('#{P} [data-slot=\"label\"] [data-clamp]').length")).to eq(0), "#{device}: no clamp (ellipsis) in the label"
      cut = page.evaluate("[...document.querySelectorAll('#{P} [data-slot=\"label\"] span')].filter(e => e.scrollHeight > e.clientHeight + 2).map(e => e.innerText)")
      expect(cut).to eq([]), "#{device}: the label is whole"
    end
    [['v2', 'x'], ['og_png', 'o']].each do |device, _|
      page = frame(all_on, 2.2, device:)
      expect(page.evaluate("document.querySelectorAll('#{P} [data-col]').length")).to eq(3), 'weather, the next event, the label beside the date'
    end
  end

  it 'the X: a work 16:9 gets the band at about two thirds of the height, the date and the columns in ONE row' do
    page = frame(all_on, 16.0 / 9, device: 'v2')
    expect(page).to have_css("#{P}[data-layout=\"band\"][data-profile=\"x\"]")
    lay = box(page, P)
    pic = box(page, "#{P} [data-picture]")
    expect((pic[3] - pic[1]) / (lay[3] - lay[1])).to be >= 0.55
    expect(page.evaluate("document.querySelectorAll('#{P} [data-row]').length")).to eq(1), 'one row of date and columns'
    day = box(page, "#{P} [data-day]")
    col = box(page, "#{P} [data-col]")
    expect(col[0]).to be > day[2], 'the columns stand beside the date'
  end

  # portrait screens: the work on top, the strip below (a work a fill would crop too much hangs whole in the band area)
  [['frame', 'fp'], ['v2', 'x'], ['og_png', 'o']].each do |device, profile|
    { '3:4' => 0.75, '16:9' => 16.0 / 9 }.each do |name, aspect|
      it "#{device} portrait, #{name}: the band layout, the picture on top, the strip under it in the same width, nothing cut" do
        page = frame(all_on, aspect, device:, orientation: 'portrait')
        expect(page).to have_css("#{P}[data-layout=\"band\"][data-profile=\"#{profile}\"]")
        lay = box(page, P)
        pic = box(page, "#{P} [data-picture]")
        strip = box(page, "#{P} [data-info-block]")
        expect(strip[1]).to be >= pic[3] - 1, 'the strip is under the picture'
        expect(pic[0] - lay[0]).to be_within(4).of(lay[2] - pic[2]), 'centred'
        expect(strip[3]).to be <= lay[3] + 2, 'inside the screen'
        expect(page).to have_css("#{P} [data-label]")
        expect(page).to have_css("#{P} [data-day]")
        gap = strip[1] - pic[3]
        expect(gap).to be <= lay[2] * 0.06, "no gap between the work and the strip: #{gap}"
        expect((pic[1] - lay[1]) - (lay[3] - strip[3])).to be_within(0.06 * (lay[3] - lay[1])).of(0), 'the group is centred vertically'
        ratio = ((pic[2] - pic[0]) / (pic[3] - pic[1])) / aspect
        expect((ratio - 1).abs < 0.03 || (pic[2] - pic[0]) >= 0.9 * (lay[2] - lay[0])).to be(true), "the whole work (its shape) or a cover across the band: #{ratio}"
        cut = page.evaluate("[...document.querySelectorAll('#{P} [data-info-block] [data-clamp]')].filter(e => e.scrollHeight > e.clientHeight + 4 || e.scrollWidth > e.clientWidth + 2).map(e => e.innerText)")
        expect(cut).to eq([])
      end
    end
  end

  # one generic rule, measured in the browser: at the device's normal sizes, what does not fit is dropped in a fixed order, never shrunk or cut
  # with an ellipsis; the info block is one row or one column; the day number and the label title stay (else the art stands alone)
  DROP_ORDER = { 1 => 'second event', 2 => 'first event', 3 => 'forecast line', 4 => 'museum line', 5 => 'weather', 6 => 'artist line' }.freeze
  LONG_TITLE = 'The Extraordinarily Long and Winding Title of a Masterwork That Nobody Can Say in One Breath'
  LONG_MUSEUM = 'Museum of Fine Arts and Applied Sciences of the Free and Hanseatic City'

  def long_shards(aspect)
    doc = fixture('one-landscape')
    doc['w'][0]['w'] = (aspect * 1000).round
    doc['w'][0]['h'] = 1000
    doc['w'][0]['t'] = LONG_TITLE
    doc['col'][doc['w'][0]['c']] = LONG_MUSEUM
    BASES_FRAME.each_with_object({}) do |base, m|
      (0..7).each do |k|
        m["#{base}/landscape-#{k}.json"] = { json: doc }
        m["#{base}/portrait-#{k}.json"] = { json: doc }
      end
    end
  end

  def long_ics
    day = Time.now.utc.strftime('%Y%m%d')
    ev = ->(uid, start, name) { ['BEGIN:VEVENT', "UID:#{uid}", "DTSTART:#{day}T#{start}00Z", "DTEND:#{day}T#{start.to_i + 1}0000Z", 'RRULE:FREQ=DAILY', "SUMMARY:#{name}", 'LOCATION:The Grand Conference Hall of the Old Town', 'END:VEVENT'] }
    (['BEGIN:VCALENDAR'] + ev.call(1, '2301', 'Quarterly review of the extraordinarily long budget') + ev.call(2, '2302', 'Dinner with the whole family and friends') + ['END:VCALENDAR']).join("\r\n")
  end

  [['frame', 'landscape'], ['frame', 'portrait'], ['v2', 'landscape'], ['v2', 'portrait'], ['og_png', 'landscape'], ['og_png', 'portrait']].each do |device, orientation|
    { 'a wide work' => 2.4, 'a square work' => 1.0, 'a 3:4 work' => 0.75 }.each do |what, aspect|
      { 'normal text' => false, 'long titles and museum names' => true }.each do |content, long|
        it "#{device} #{orientation}, #{what}, #{content}: one row or one column, nothing overflows, no ellipsis, drops follow the order" do
          mocks = (long ? long_shards(aspect) : shape_shards(aspect)).merge(services)
          mocks = mocks.merge('https://calendar.example.org/*' => { body: long_ics }) if long
          page = trmnl.render(view: 'full', device:, orientation:, mocks:, custom_fields: { 'weather_location' => 'Paris', 'ics_url' => LINK_FRAME }.merge(all_on))
          page.has_css?('img.image')
          expect(page).to have_css("#{P} [data-picture]"), 'the art is always there'
          block = "#{P} [data-info-block]"
          visible = page.has_css?(block)
          if visible
            expect(page).to have_css("#{P} [data-day]")
            expect(page).to have_css("#{P} [data-label]")
            col = page.evaluate("document.querySelector('#{block}').getAttribute('data-fit') === 'column'")
            lay = box(page, P)
            blk = box(page, block)
            limit = col ? blk[3] : lay[3]
            bad = page.evaluate(<<~JS)
              [...document.querySelectorAll('#{block} span')].filter(e => e.offsetParent).filter((e) => {
                const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
                return r.bottom > #{limit} + 1 || r.right > #{col ? blk[2] : lay[2]} + 1 || cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') ||
                  (!e.hasAttribute('data-day') && e.clientWidth && e.scrollWidth > e.clientWidth + 1);
              }).map(e => e.innerText)
            JS
            expect(bad).to eq([]), 'nothing overflows or is cut'
            # one row (the tops of the parts agree) or one column (their left edges agree)
            parts = page.evaluate("[...document.querySelectorAll('#{block} [data-info]')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top]; })")
            if parts.size > 1
              axis = col ? 0 : 1
              spread = parts.map { |q| q[axis] }.minmax.then { |lo, hi| hi - lo }
              expect(spread).to be <= 3, "#{col ? 'one column' : 'one row'}: #{parts}"
            end
          end
          flags = page.evaluate("[1, 2, 3, 4, 5, 6].map(d => [...document.querySelectorAll('#{P} [data-drop=\"' + d + '\"]')].some(e => e.offsetParent !== null))")
          seen = false
          flags.each_with_index do |on, i|
            expect(!seen || on).to be(true), "dropped out of order: #{DROP_ORDER[i + 1]} is gone but an earlier drop is still shown #{flags}" if seen && !on
            seen ||= on
          end
        end
      end
    end
  end
end
