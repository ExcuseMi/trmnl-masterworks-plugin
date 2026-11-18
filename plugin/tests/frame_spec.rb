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

  # visible text in the info block that is cut (taller or wider than its box): nothing may be
  def cut_text(page)
    page.evaluate("[...document.querySelectorAll('#{P} [data-info-block] span')].filter(e => e.offsetParent && !e.hasAttribute('data-day') && (e.scrollHeight > e.clientHeight + 4 || e.scrollWidth > e.clientWidth + 2)).map(e => e.innerText)")
  end

  # the label's last line (museum, else artist) hangs on the picture's bottom edge: its box ends at most half a font size below it (the line's descent)
  def tail_ok(page, pic)
    bottom, fs = page.evaluate("(() => { const e = [...document.querySelectorAll('#{P} [data-museum], #{P} [data-who]')].filter(x => x.offsetParent).pop(); return [e.getBoundingClientRect().bottom, parseFloat(getComputedStyle(e).fontSize) * (e.getBoundingClientRect().width / e.offsetWidth)]; })()")
    (bottom - pic[3]).between?(-4, 0.55 * fs)
  end

  def all_on = { 'show_date' => 'true', 'show_weather' => 'true', 'show_agenda' => 'true', 'label' => 'true' }
  P = '[data-block="primary"]'

  BAND_SHAPES = { 'panorama 2.5:1' => 2.5, '2:1' => 2.0, '16:9' => 16.0 / 9 }.freeze
  COLUMN_SHAPES = { '3:2' => 1.5, '4:3' => 4.0 / 3, 'square' => 1.0 }.freeze
  # tall works on the Frame: the split costs no image size, so it is used (info left, work centred, label right)
  SPLIT_SHAPES = { '3:4' => 0.75, 'scroll 1:2.5' => 0.4 }.freeze

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
      cells = page.evaluate("[...document.querySelectorAll('#{P} [data-info-block] [data-cell]')].map(e => e.getAttribute('data-cell'))")
      expect(cells).to eq(%w[date w e e l]), 'date, weather, two events, the label: one row, in this order'
      expect(page.evaluate("document.querySelectorAll('#{P} [data-rule]').length")).to eq(0), 'no rules'
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
      gutter = page.evaluate("(() => { const g = document.querySelector('#{P} [data-group]').children[1]; return g.getBoundingClientRect().width; })()")
      expect(col[0] - pic[2]).to be_within(3).of(gutter), 'the planned gutter'
      expect(col[1]).to be <= pic[1] + 2, "the picture stands inside the column's height: #{pic} #{col}"
      label = box(page, "#{P} [data-slot=\"label\"]")
      expect(tail_ok(page, pic)).to be(true), "the label's last line is on the picture's bottom edge: #{label} #{pic}"
      events = box(page, "#{P} [data-event]:last-of-type") || box(page, "#{P} [data-event]")
      expect(events[3]).to be < label[1], 'the top block never meets the label'
      expect(page.evaluate("document.querySelectorAll('#{P} [data-rule]').length")).to eq(0), 'no rules in the column'
      ratio = ((pic[2] - pic[0]) / (pic[3] - pic[1])) / aspect
      expect(ratio).to be_within(0.03).of(1), 'the picture has the work\'s shape (the whole work)'
    end
  end

  SPLIT_SHAPES.merge('dark 3:4' => 0.75).each do |name, aspect|
    it "#{name}: the split layout on the Frame, the info left of the work, the work centred on the screen, the label right of it" do
      page = frame(all_on, aspect, name.start_with?('dark') ? 'one-dark-landscape' : 'one-landscape')
      expect(page).to have_css("#{P}[data-layout=\"split\"]")
      lay = box(page, P)
      pic = box(page, "#{P} [data-picture]")
      left, right = page.evaluate("[...document.querySelectorAll('#{P} [data-info-block]')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })")
      expect(left[2]).to be <= pic[0] + 1, 'the date, weather and events are left of the work'
      expect(right[0]).to be >= pic[2] - 1, 'the label column is right of the work'
      expect(pic[0] - lay[0]).to be_within(3).of(lay[2] - pic[2]), 'the work is horizontally centred on the screen'
      expect(box(page, "#{P} [data-slot=\"label\"]")[0]).to be >= pic[2]
      expect(page.evaluate("document.querySelectorAll('#{P} [data-rule]').length")).to eq(0)
      expect(cut_text(page)).to eq([])
    end
  end

  it 'the split is only for tall works on the Frame: square, 3:2, the X and the OG never use it' do
    [1.0, 1.5].each { |a| expect(frame(all_on, a)).to have_no_css("#{P}[data-layout=\"split\"]") }
    %w[v2 og_png].each { |d| [1.0, 0.75, 1.5].each { |a| expect(frame(all_on, a, device: d)).to have_no_css("#{P}[data-layout=\"split\"]") } }
  end

  # the label is the last element and ends at the work's right edge in every row (under a band or under a whole work)
  { 'frame' => 'f', 'v2' => 'x', 'og_png' => 'o' }.each do |device, _profile|
    [2.5, 2.0, 16.0 / 9, 1.5].each do |aspect|
      it "#{device}, #{aspect.round(2)}: in a row the label's right edge is the work's right edge" do
        page = frame(all_on, aspect, device:)
        layout = page.evaluate("document.querySelector('#{P}').getAttribute('data-layout')")
        skip "#{layout} layout, not a row" unless %w[band below].include?(layout)
        pic = box(page, "#{P} [data-picture]")
        lab = box(page, "#{P} [data-slot=\"label\"]")
        expect(lab[2]).to be_within(2).of(pic[2]), "label #{lab} work #{pic}"
        txt = page.evaluate("(() => { const b = document.querySelector('#{P} [data-lbody]').getBoundingClientRect(); return [b.left, b.right]; })()")
        expect(txt[1]).to be_within(2).of(pic[2]), 'the label text block ends on the right edge'
      end
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
        cut = cut_text(page)
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
        cells = page.evaluate("[...document.querySelectorAll('#{P} [data-info-block] [data-cell]')].filter(e => e.offsetParent).map(e => [e.getAttribute('data-cell'), e.innerText.trim(), e.getBoundingClientRect().left, e.getBoundingClientRect().top])")
        expect(cells.map { |c| c[1] }).to all(satisfy { |t| !t.empty? }), 'no empty cell'
        expect(page.evaluate("document.querySelectorAll('#{P} [data-rule]').length")).to eq(0), 'no rules'
        if layout == 'band'
          lefts = cells.map { |c| c[2] }
          expect(lefts).to eq(lefts.sort), 'one row, left to right'
          expect(cells.last[0]).to eq('l') if on.include?('label')
        else
          tops = cells.map { |c| c[3] }
          expect(tops).to eq(tops.sort), 'one column, top to bottom'
          if on.include?('label')
            pic = box(page, "#{P} [data-picture]")
            expect(tail_ok(page, pic)).to be(true), 'the label stays at the bottom'
          end
        end
        cut = cut_text(page)
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
        expect(pic[0] - lay[0]).to be_within(6).of(lay[2] - col[2]), "one centred group: #{lay} #{pic} #{col}"
        expect(col[0]).to be > pic[2]
        expect(col[1]).to be <= pic[1] + 2, "the picture stands inside the column's height: #{pic} #{col}"
        expect(tail_ok(page, pic)).to be(true), "the label's last line is on the picture's bottom: #{pic}"
        expect(page).to have_css("#{P} [data-day]")
        expect(page).to have_css("#{P} [data-label]")
        events = page.evaluate("[...document.querySelectorAll('#{P} [data-event]')].filter(e => e.offsetParent).length")
        forecast = page.evaluate("[...document.querySelectorAll('#{P} [data-weather]')].some(e => e.offsetParent)")
        expect(events).to be <= 2
        expect(events).to eq(0) unless forecast # the forecast line goes only after every event
        cut = cut_text(page)
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
      expect(page.evaluate("document.querySelectorAll('#{P} [data-rule]').length")).to eq(0), 'no rules'
    end
  end

  it 'the X and the OG band: at most one event (date, weather, next event, label), and the painting label is never cut with an ellipsis, on every device' do
    { 'v2' => 2.2, 'og_png' => 2.2, 'frame' => 2.2 }.each do |device, aspect|
      page = frame(all_on, aspect, device:)
      expect(page).to have_css("#{P}[data-layout=\"band\"]")
      events = page.evaluate("document.querySelectorAll('#{P} [data-event]').length")
      expect(events).to eq(device == 'frame' ? 2 : 1), device
      expect(page.evaluate("document.querySelectorAll('#{P} [data-clamp]').length")).to eq(0), "#{device}: no clamp (ellipsis) in the info"
      cut = page.evaluate("[...document.querySelectorAll('#{P} [data-slot=\"label\"] span')].filter(e => e.scrollHeight > e.clientHeight + 2).map(e => e.innerText)")
      expect(cut).to eq([]), "#{device}: the label is whole"
    end
    [['v2', 'x'], ['og_png', 'o']].each do |device, _|
      page = frame(all_on, 2.2, device:)
      expect(page.evaluate("[...document.querySelectorAll('#{P} [data-info-block] [data-cell]')].map(e => e.getAttribute('data-cell'))")).to eq(%w[date w e l]), 'date, weather, the next event, the label'
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
    col = page.evaluate("(() => { const e = [...document.querySelectorAll('#{P} [data-info-block] [data-cell]')].filter(x => x.offsetParent && x.getAttribute('data-cell') !== 'date')[0]; return e.getBoundingClientRect().left; })()")
    expect(col).to be > day[2], 'the cells stand beside the date'
  end

  # portrait screens: the work on top, the strip below (a work a fill would crop too much hangs whole in the band area)
  [['frame', 'fp'], ['v2', 'x'], ['og_png', 'o']].each do |device, profile|
    { '3:4' => 0.75, '16:9' => 16.0 / 9 }.each do |name, aspect|
      it "#{device} portrait, #{name}: the work on top, the info under it (a row under a narrow work, the column under a wide one), nothing cut" do
        page = frame(all_on, aspect, device:, orientation: 'portrait')
        expect(page).to have_css("#{P}[data-layout=\"#{aspect > 1.4 ? 'stack' : 'below'}\"][data-profile=\"#{profile}\"]")
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
        # a row under a narrow work is centred with it; the column under a wide work hangs from the top margin
        expect((pic[1] - lay[1]) - (lay[3] - strip[3])).to be_within(0.06 * (lay[3] - lay[1])).of(0), 'the group is centred vertically' if aspect < 1.4
        ratio = ((pic[2] - pic[0]) / (pic[3] - pic[1])) / aspect
        expect((ratio - 1).abs < 0.03 || (pic[2] - pic[0]) >= 0.9 * (lay[2] - lay[0])).to be(true), "the whole work (its shape) or a cover across the band: #{ratio}"
        cut = cut_text(page)
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
            fit = page.evaluate("document.querySelector('#{block}').getAttribute('data-fit')")
            col = fit != 'below' && fit != 'band'
            lay = box(page, P)
            # the split has two blocks (left: date, weather, events; right: the label): each is checked against its own box
            page.evaluate("[...document.querySelectorAll('#{P} [data-info-block]')].map((_, i) => i)").each do |i|
              sel = "#{P} [data-info-block]"
              blk = page.evaluate("(() => { const r = document.querySelectorAll('#{sel}')[#{i}].getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
              limit = col ? blk[3] : lay[3]
              bad = page.evaluate(<<~JS)
                [...document.querySelectorAll('#{sel}')[#{i}].querySelectorAll('span')].filter(e => e.offsetParent).filter((e) => {
                  const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
                  return r.bottom > #{limit} + 1 || r.right > #{col ? blk[2] : lay[2]} + 1 || cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') ||
                    (!e.hasAttribute('data-day') && e.clientWidth && e.scrollWidth > e.clientWidth + 1);
                }).map(e => e.innerText)
              JS
              expect(bad).to eq([]), 'nothing overflows or is cut'
            end
            expect(single_axis(page, block, col)).to eq([]), "#{col ? 'one column' : 'one row'}"
          end
          expect(drop_order_violations(page)).to eq([]), 'dropped out of order'
        end
      end
    end
  end

  # the owner's rules for the info block (2026-11-18), on every screen and orientation, wide and narrow, normal and long text
  # one row or one column: every cell is a child of one flex container with the axis the layout names, no wrap, never a grid
  def single_axis(page, block, col)
    page.evaluate(<<~JS)
      (() => {
        const b = document.querySelector('#{block}'), cells = [...b.querySelectorAll('[data-cell]')], out = [];
        const parents = new Set(cells.map(c => c.parentElement));
        if (parents.size > 1) out.push('cells in ' + parents.size + ' containers');
        parents.forEach((p) => { const cs = getComputedStyle(p);
          if (cs.display !== 'flex') out.push('display ' + cs.display);
          if (cs.flexDirection !== '#{col ? 'column' : 'row'}') out.push('direction ' + cs.flexDirection);
          if (cs.flexWrap !== 'nowrap') out.push('wrap ' + cs.flexWrap); });
        const vis = cells.filter(c => c.offsetParent).map(c => c.getBoundingClientRect());
        vis.forEach((r, i) => { if (i && #{col ? 'r.top < vis[i - 1].bottom - 1' : 'r.left < vis[i - 1].right - 1'}) out.push('cells overlap on the axis'); });
        return out;
      })()
    JS
  end

  # the drops that exist, in the owner's order (the lower number goes first, 0 is never dropped): a hidden element needs every lower one hidden
  def drop_order_violations(page)
    page.evaluate(<<~JS)
      (() => {
        const els = [...document.querySelectorAll('#{P} [data-drop]')].map(e => [Number(e.getAttribute('data-drop')), !e.offsetParent, e.closest('.hidden') !== null]).filter(x => x[0] > 0);
        const out = [];
        els.forEach(([d, gone]) => { if (gone) els.forEach(([d2, gone2]) => { if (d2 < d && !gone2 && !els.some(([d3, g3]) => d3 === d2 && g3)) out.push('drop ' + d + ' is gone but drop ' + d2 + ' is shown'); }); });
        return out;
      })()
    JS
  end

  SCREENS = [['frame', 'landscape'], ['frame', 'portrait'], ['v2', 'landscape'], ['v2', 'portrait'], ['og_png', 'landscape'], ['og_png', 'portrait']].freeze

  def long_frame(device, orientation, aspect)
    mocks = long_shards(aspect).merge(services).merge('https://calendar.example.org/*' => { body: long_ics })
    page = trmnl.render(view: 'full', device:, orientation:, mocks:, custom_fields: { 'weather_location' => 'Paris', 'ics_url' => LINK_FRAME }.merge(all_on))
    page.has_css?('img.image')
    page
  end

  SCREENS.each do |device, orientation|
    [2.4, 1.0, 0.75].each do |aspect|
      it "#{device} #{orientation} #{aspect}: no rules, no borders, no grid, no truncation classes, hidden parts are absent (display none)" do
        page = frame(all_on, aspect, device:, orientation:)
        bad = page.evaluate(<<~JS)
          (() => {
            const out = [];
            document.querySelectorAll('#{P} *').forEach((e) => {
              const cs = getComputedStyle(e), cl = String(e.getAttribute('class') || '');
              if (/(^| )border--h-/.test(cl) || /(^| )border(--|$)/.test(cl) || e.hasAttribute('data-rule')) out.push('border class on ' + e.tagName + ' ' + cl);
              if (['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some(k => parseFloat(cs[k]) > 0)) out.push('drawn border on ' + e.tagName + ' ' + cl);
              if (/grid/.test(cs.display)) out.push('grid on ' + cl);
              if (e.hasAttribute('data-clamp') || /(^| )(line-clamp|truncate|text--ellipsis)/.test(cl) || cs.textOverflow === 'ellipsis') out.push('truncation on ' + cl);
              if ((e.hasAttribute('data-fitted') || e.classList.contains('hidden')) && cs.display !== 'none') out.push('dropped but displayed: ' + cl);
            });
            return out;
          })()
        JS
        expect(bad).to eq([])
      end
    end
  end

  SCREENS.each do |device, orientation|
    [1.0, 0.75].each do |aspect|
      it "#{device} #{orientation} #{aspect}: the date number and the label title are never dropped; what is dropped is a prefix of the drop order" do
        page = frame(all_on, aspect, device:, orientation:)
        expect(page.evaluate("[...document.querySelectorAll('#{P} [data-day], #{P} [data-label]')].map(e => !!e.offsetParent)")).to eq([true, true]), 'day number and label title stay'
        expect(page.evaluate("document.querySelectorAll('#{P} [data-day][data-drop], #{P} [data-label][data-drop], #{P} [data-day] [data-drop], #{P} [data-label] [data-drop]').length")).to eq(0), 'they carry no drop number'
        expect(drop_order_violations(page)).to eq([])
      end
    end
  end

  it 'a narrow case drops in the owner order: the Frame in portrait with a 3:4 work loses the second event, then the first, then the forecast, and nothing else' do
    page = frame(all_on, 0.75, device: 'frame', orientation: 'portrait')
    dropped = page.evaluate("[...document.querySelectorAll('#{P} [data-drop]')].filter(e => !e.offsetParent).map(e => Number(e.getAttribute('data-drop'))).sort()")
    expect(dropped).to eq([1, 2, 3])
    expect(drop_order_violations(page)).to eq([])
  end

  it 'the OG with a 3:2 work shows no events (owner decision A): the weather and the label are what the row keeps' do
    page = frame(all_on, 1.5, device: 'og_png')
    shown = page.evaluate("[...document.querySelectorAll('#{P} [data-event]')].filter(e => e.offsetParent).length")
    expect(shown).to eq(0)
    expect(page).to have_css("#{P} [data-day]")
    expect(page).to have_css("#{P} [data-label]")
  end

  # label only (no date, weather or agenda): a near-square work gets the label in a column on its right, the group centred; a wide work keeps it below
  LABEL_ONLY = { 'show_date' => 'false', 'show_weather' => 'false', 'show_agenda' => 'false', 'label' => 'true' }.freeze

  [['frame', 1.27], ['frame', 1.0], ['og_png', 1.27]].each do |device, aspect|
    it "label only, #{device} #{aspect}: the label is a column on the work's right, the group is centred (equal outer margins), the last line on the work's bottom" do
      page = frame(LABEL_ONLY, aspect, device:)
      expect(page).to have_css("#{P} [data-label-column]")
      lay = box(page, P)
      pic = box(page, "#{P} [data-picture], #{P} [data-bevel]")
      col = box(page, "#{P} [data-label-column] [data-label]")
      expect(pic[0] - lay[0]).to be_within(4).of(lay[2] - col[2]), "equal outer margins of the group: #{lay} #{pic} #{col}"
      text_right = page.evaluate("Math.max(...[...document.querySelectorAll('#{P} [data-label-column] span')].map(e => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().right; }))")
      expect(col[2] - text_right).to be <= 0.02 * lay[2], "the column is as wide as its text: #{col} #{text_right}"
      expect(col[0]).to be > pic[2]
      expect(cut_text(page)).to eq([])
    end
  end

  it 'label only, a 16:9 work: the label stays below the work (right-aligned), no column' do
    page = frame(LABEL_ONLY, 16.0 / 9)
    expect(page).to have_no_css("#{P} [data-label-column]")
    expect(page).to have_css("#{P} [data-label]")
  end
end
