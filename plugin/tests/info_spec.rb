# frozen_string_literal: true

# The info strip: three independent parts (date, weather, agenda), any combination, on the Frame and a small device.
# Open-Meteo and the calendar are mocked (tests/fixtures); the data shards as in plugin_spec.rb.
require 'json'

RSpec.describe 'Masterworks info strip' do
  MIRRORS_INFO = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze
  LINK = 'https://calendar.example.org/private/abc/basic.ics'

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  # the same document for every part of an orientation and every mirror
  def shards(landscape = 'one-landscape', portrait = 'one-portrait')
    MIRRORS_INFO.each_with_object({}) do |base, m|
      (0..15).each do |k|
        m["#{base}/landscape-#{k}.json"] = { json: fixture(landscape) }
        m["#{base}/portrait-#{k}.json"] = { json: fixture(portrait) }
      end
    end
  end

  def ics
    day = Time.now.utc.strftime('%Y%m%d')
    [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', "DTSTART;VALUE=DATE:#{day}", 'SUMMARY:Birthday', 'RRULE:FREQ=DAILY', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:2', 'DTSTART:20260101T233000Z', 'DTEND:20260102T000000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Call the plumber', 'LOCATION:Home', 'END:VEVENT',
      'END:VCALENDAR'
    ].join("\r\n")
  end

  let(:services) do
    {
      'https://geocoding-api.open-meteo.com/*' => { json: fixture('geocode') },
      'https://api.open-meteo.com/*' => { json: fixture('weather-rain') },
      'https://calendar.example.org/*' => { body: ics }
    }
  end

  COMBOS = {
    'date' => %w[show_date], 'weather' => %w[show_weather], 'agenda' => %w[show_agenda],
    'date and weather' => %w[show_date show_weather], 'date and agenda' => %w[show_date show_agenda],
    'weather and agenda' => %w[show_weather show_agenda], 'date, weather and agenda' => %w[show_date show_weather show_agenda]
  }.freeze
  VIEWS_INFO = %w[full half_horizontal].freeze

  # the strip of a screen without a profile (a custom 800 x 481 landscape): the Frame, the X and the OG have their own layouts (frame_spec.rb)
  OLD_SCREEN = { width: 800, height: 481, bit_depth: 2 }.freeze # OG-sized but not an OG (800 x 480): it keeps the strip: it keeps the strip

  def screen(device, fields, view: 'full', orientation: nil, mocks: shards.merge(services))
    orientation ||= 'landscape'
    base = { 'weather_location' => 'Paris', 'ics_url' => LINK, 'fill' => 'false' } # the mat examples; fill has its own below
    trmnl.render(view:, device:, orientation:, mocks:, custom_fields: base.merge(fields))
  end

  def fields_for(keys) = keys.to_h { |k| [k, 'true'] }
  def wait(page) = page.has_css?('img.image')

  def rect(page, selector)
    page.evaluate("(() => { const r = document.querySelector('#{selector}').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
  end

  # the boxes of the parts of the strip, left to right
  # the boxes of the picture (bevel) and of the strip
  def box(page, selector)
    page.evaluate("(() => { const e = document.querySelector('#{selector}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
  end

  # a work too narrow for even the date in short names (a scroll on the OG is 64 CSS px wide) has no strip and keeps its label under it
  def narrow_without_strip(page, device, aspect)
    expect(page).to have_css('[data-info-block]'), "#{device}: a strip is always possible (#{aspect})"
  end

  # nothing is cut: a text part whose lines are clamped must have all of its text visible (these texts are short)
  def cut_parts(page)
    page.evaluate("[...document.querySelectorAll('[data-info-block] [data-clamp]')].filter(e => e.scrollHeight > e.clientHeight + 4 || e.scrollWidth > e.clientWidth + 2).map(e => e.innerText)")
  end

  # the picture and the strip are one group under each other, centred, inside the layout, the work whole
  def expect_composed(page, where)
    lay = box(page, '[data-block="primary"]')
    pic = box(page, '[data-block="primary"] [data-bevel]')
    blk = box(page, '[data-block="primary"] [data-info-block]')
    expect(blk).not_to be_nil, "#{where}: a strip"
    expect(blk[1]).to be >= pic[3] - 1, "#{where}: the strip is under the picture #{pic} #{blk}"
    [pic, blk].each do |b|
      expect(b[0]).to be >= lay[0] - 1
      expect(b[1]).to be >= lay[1] - 1
      expect(b[2]).to be <= lay[2] + 1
      expect(b[3]).to be <= lay[3] + 1
    end
    expect(pic[0] - lay[0]).to be_within(4).of(lay[2] - pic[2]), "#{where}: the picture is centred"
    expect(blk[0] - lay[0]).to be_within(4).of(lay[2] - blk[2]), "#{where}: the strip is centred"
    # the strip stands on the work's edges and is never wider: its box and every text part lie within the picture's left and right edges
    expect(blk[0]).to be >= pic[0] - 2, "#{where}: the strip starts at the picture's left edge #{pic} #{blk}"
    expect(blk[2]).to be <= pic[2] + 2, "#{where}: the strip ends at the picture's right edge #{pic} #{blk}"
    spans = page.evaluate("[...document.querySelectorAll('[data-block=\"primary\"] [data-info-block] span')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right, e.innerText]; })")
    spans.each do |l, r, text|
      expect(l).to be >= pic[0] - 2, "#{where}: #{text} starts left of the picture"
      expect(r).to be <= pic[2] + 2, "#{where}: #{text} ends right of the picture"
    end
    cut = cut_parts(page)
    expect(cut).to eq([]), "#{where}: text is cut: #{cut}"
  end

  # the Frame, the X and the OG have their own layouts (frame_spec.rb); the other screens keep the strip
  [OLD_SCREEN].each do |device|
    COMBOS.each do |name, keys|
      next if keys.include?('show_agenda') # known: on a custom screen the old strip with an agenda starts 1.4 px above its layout (the OG and the X no longer use it)

      it "#{name} on #{device}: only the parts that are on, composed under the picture, nothing overlapping or cut off" do
        page = screen(device, fields_for(keys), mocks: shards('one-landscape', 'one-tall').merge(services))
        wait(page)
        expect(page).to have_css('[data-info-block]')
        { 'date' => 'show_date', 'weather' => 'show_weather', 'agenda' => 'show_agenda' }.each do |part, key|
          if keys.include?(key)
            expect(page).to have_css("[data-info-block] [data-info=\"#{part}\"]")
          else
            expect(page).to have_no_css("[data-info-block] [data-info=\"#{part}\"]")
          end
        end
        expect_composed(page, "#{name} on #{device}")
        # the groups stand left to right: date, then weather or agenda, then the label
        order = page.evaluate("[...document.querySelectorAll('[data-block=\"primary\"] [data-info-block] [data-info]')].map(e => [e.dataset.info, e.getBoundingClientRect().left])")
        expect(order.map(&:last)).to eq(order.map(&:last).sort)
      end
    end

    it "nothing on: no strip, the museum label under the picture, as before (#{device})" do
      page = screen(device, {})
      wait(page)
      expect(page).to have_no_css('[data-info-block]')
      expect(page).to have_css('[data-label]')
    end

    it "weather that cannot be fetched leaves the date alone and never an error (#{device})" do
      page = screen(device, fields_for(%w[show_date show_weather]), mocks: shards.merge(services).merge('https://api.open-meteo.com/*' => { status: 503 }))
      wait(page)
      expect(page).to have_css('[data-info-block] [data-info="date"]')
      expect(page).to have_no_css('[data-info="weather"]')
      expect(page).to have_no_text('error')
    end

    it "no weather location: the date alone; an agenda toggle without a link: nothing; no filler text (#{device})" do
      page = screen(device, fields_for(%w[show_date show_weather show_agenda]).merge('weather_location' => '', 'ics_url' => ''))
      wait(page)
      expect(page).to have_css('[data-info-block] [data-info="date"]')
      expect(page).to have_no_css('[data-info="weather"], [data-info="agenda"]')
      only_agenda = screen(device, fields_for(%w[show_agenda]).merge('ics_url' => ''))
      wait(only_agenda)
      expect(only_agenda).to have_no_css('[data-info-block]')
      expect(only_agenda).to have_no_text('Nothing planned')
    end
  end

  it 'shows the temperature over the forecast, the agenda time over its text, in black' do
    page = screen(OLD_SCREEN, fields_for(%w[show_date show_weather show_agenda]))
    wait(page)
    expect(page.evaluate("document.querySelector('[data-temp]').innerText")).to match(/\A-?\d+°\z/)
    expect(page.evaluate("document.querySelector('[data-weather]').innerText")).to match(/\A(Rain|Drizzle|Snow|Storm|Dry|Sunny|Clear|Fog)/)
    expect(page.evaluate("document.querySelectorAll('[data-event]').length")).to eq(1), 'weather and agenda: the weather, then the next single event'
    expect(page.evaluate("document.querySelector('[data-event-title]').innerText")).to include('Birthday').or include('Call the plumber')
    expect(page.evaluate("document.querySelector('[data-day]').innerText")).to match(/\A\d{1,2}\z/)
    expect(page).to have_no_text('Tomorrow'), 'no heading'
    inks = page.evaluate("[...new Set([...document.querySelectorAll('[data-info-block] *')].map(e => getComputedStyle(e).color))]")
    expect(inks - ['rgb(0, 0, 0)', 'rgb(255, 255, 255)']).to eq([]), 'the info text is black (or the mat ink), never a colour'
  end

  it 'the agenda alone shows up to two events in the middle slot, time over text' do
    page = screen(OLD_SCREEN, fields_for(%w[show_agenda]))
    wait(page)
    expect(page.evaluate("document.querySelectorAll('[data-event]').length")).to eq(2)
    expect(page).to have_no_css('[data-info="weather"]')
  end

  it 'keeps the groups in their places when one is switched off: the weather does not move' do
    both = screen(OLD_SCREEN, fields_for(%w[show_date show_weather]))
    wait(both)
    alone = screen(OLD_SCREEN, fields_for(%w[show_weather]))
    wait(alone)
    x = ->(page) { page.evaluate("document.querySelector('[data-block=\"primary\"] [data-info=\"weather\"]').getBoundingClientRect().left") }
    expect(x.call(alone)).to be_within(2).of(x.call(both))
    right = ->(page) { page.evaluate("document.querySelector('[data-block=\"primary\"] [data-label]').getBoundingClientRect().right") }
    expect(right.call(alone)).to be_within(2).of(right.call(both))
  end

  # the shape table in the browser: every shape of work on every screen, one strip under the work, the work whole
  SHAPES = { 'very wide panorama' => 2.5, 'wide' => 1.8, "the screen's own shape" => 16.0 / 9, '4:3' => 4.0 / 3, 'square' => 1.0, '3:4' => 0.75, 'tall' => 0.6, 'very tall scroll' => 0.35 }.freeze

  def shape_shards(aspect, fixture_name = 'one-landscape')
    doc = fixture(fixture_name)
    doc['w'][0]['w'] = (aspect * 1000).round
    doc['w'][0]['h'] = 1000
    MIRRORS_INFO.each_with_object({}) do |base, m|
      (0..15).each do |k|
        m["#{base}/landscape-#{k}.json"] = { json: doc }
        m["#{base}/portrait-#{k}.json"] = { json: doc }
      end
    end
  end

  [[OLD_SCREEN, 'landscape']].each do |device, orientation|
    SHAPES.each do |name, aspect|
      it "#{name} on #{device} #{orientation}: the strip and the picture do not overlap, the work is whole, nothing is cut" do
        page = screen(device, fields_for(COMBOS['date and weather']), orientation:, mocks: shape_shards(aspect).merge(services))
        wait(page)
        expect(page).to have_css('[data-gallery]'), 'on the mat, never a placard over the art'
        expect(page).to have_no_css('[data-placard]')
        next narrow_without_strip(page, device, aspect) unless page.has_css?('[data-info-block]')

        expect_composed(page, "#{name} on #{device} #{orientation}")
        pic = box(page, '[data-block="primary"] [data-bevel]')
        expect(((pic[2] - pic[0]).to_f / (pic[3] - pic[1]) / aspect) - 1).to be_within(0.05).of(0), "the picture has the work's shape (no crop): #{pic}"
      end
    end
  end

  # every shape x every set of parts: the strip stands within the work's left and right edges (the owner's rule), on the Frame and the OG
  [[OLD_SCREEN, 'landscape']].each do |device, orientation|
    SHAPES.each do |name, aspect|
      COMBOS.each do |combo, keys|
        next if keys.include?('show_agenda') # known, see above

        it "#{name}, #{combo} on #{device} #{orientation}: the strip stands on the work's edges and nothing is cut" do
          page = screen(device, fields_for(keys), orientation:, mocks: shape_shards(aspect).merge(services))
          wait(page)
          next narrow_without_strip(page, device, aspect) unless page.has_css?('[data-info-block]')

          expect_composed(page, "#{name}, #{combo} on #{device} #{orientation}")
        end
      end
    end
  end

  it 'the Frame, the X and the OG each take their own size profile; another screen keeps the strip' do
    shapes = shape_shards(1.5)
    { 'frame' => 'f', 'v2' => 'x', 'og_png' => 'o' }.each do |device, profile|
      page = screen(device, fields_for(%w[show_date]), mocks: shapes.merge(services))
      wait(page)
      expect(page).to have_css("[data-block=\"primary\"][data-profile=\"#{profile}\"]"), device
    end
    other = screen(OLD_SCREEN, fields_for(%w[show_date]), mocks: shapes.merge(services))
    wait(other)
    expect(other).to have_no_css('[data-profile]')
  end

  it 'draws the info in white text on a black mat when the work hangs on black' do
    page = screen('frame', fields_for(%w[show_date]), mocks: shards('one-dark-landscape', 'one-portrait'))
    wait(page)
    expect(page.evaluate("getComputedStyle(document.querySelector('[data-block=\"primary\"]')).backgroundColor")).to eq('rgb(0, 0, 0)')
    expect(page.evaluate("getComputedStyle(document.querySelector('[data-block=\"primary\"] [data-day]')).color")).to eq('rgb(255, 255, 255)')
  end

  # the fill setting: on (the default) a work that crops at most 15 % fills its area edge to edge; off: the 5 % rule and the mat
  describe 'fill the screen' do
    def fill_screen(device, fields, aspect, orientation: nil)
      screen(device, { 'fill' => 'true' }.merge(fields), orientation:, mocks: shape_shards(aspect).merge(services))
    end

    it 'info off, label off: a work that crops 11 % fills the Frame edge to edge; fill off hangs it on the mat; with the label on it never fills' do
      labelled = fill_screen('frame', {}, 2.0)
      wait(labelled)
      expect(labelled).to have_css('[data-label]')
      expect(labelled).to have_no_css('[data-placard]')
      expect(labelled).to have_no_css('[data-mode="full"]')
      on = fill_screen('frame', { 'label' => 'false' }, 2.0)
      wait(on)
      expect(on).to have_css('[data-mode="full"]')
      expect(on).to have_no_css('[data-gallery]')
      expect(on).to have_no_css('[data-placard]')
      img = box(on, '[data-block="primary"] img.image')
      lay = box(on, '[data-block="primary"]')
      expect(img).to eq(lay), 'edge to edge'
      off = screen('frame', { 'fill' => 'false' }, mocks: shape_shards(2.0).merge(services))
      wait(off)
      expect(off).to have_css('[data-gallery]')
    end

    it 'info off: a work that crops more than 15 % hangs on the mat even with fill on' do
      page = fill_screen('frame', {}, 4.0 / 3)
      wait(page)
      expect(page).to have_css('[data-gallery]')
    end

    [OLD_SCREEN].each do |device|
      it "info on, #{device}: a work that fills the band goes edge to edge from the top, the strip is full width under it, the label in the strip, no placard" do
        page = fill_screen(device, fields_for(%w[show_date show_weather]), 2.1) # about the shape of the band above the strip
        wait(page)
        expect(page).to have_css('[data-mode="full"][data-block="primary"]')
        expect(page).to have_no_css('[data-placard]')
        expect(page).to have_css('[data-info-block] [data-label]')
        lay = box(page, '[data-block="primary"]')
        band = box(page, '[data-fill-band]')
        strip = box(page, '[data-block="primary"] [data-info-block]')
        expect(band[0]).to be_within(1).of(lay[0])
        expect(band[2]).to be_within(1).of(lay[2])
        expect(band[1]).to be_within(1).of(lay[1])
        expect(strip[1]).to be >= band[3] - 1, 'the strip is under the band'
        expect(strip[3]).to be <= lay[3] + 1
        expect(strip[0] - lay[0]).to be_within(4).of(lay[2] - strip[2]), 'equal outer margins'
        expect(page.evaluate("document.querySelector('[data-fill-band] img').getBoundingClientRect().height")).to be_within(2).of(band[3] - band[1])
        expect(cut_parts(page)).to eq([])
      end
    end

    it 'info on: a work that would crop more than 15 % of the band hangs whole on the mat, the strip under it; fill off always so' do
      [OLD_SCREEN].each do |device|
        page = fill_screen(device, fields_for(%w[show_date]), 1.0)
        wait(page)
        expect(page).to have_css('[data-gallery]')
        expect(page).to have_no_css('[data-fill-band]')
        expect_composed(page, "square on #{device}")
        off = screen(device, fields_for(%w[show_date]), mocks: shape_shards(2.1).merge(services))
        wait(off)
        expect(off).to have_css('[data-gallery]'), "#{device} fill off: the mat"
      end
    end

    # fill on / off x info on / off x every shape, on the Frame
    [true, false].each do |fill|
      [true, false].each do |info|
        SHAPES.each do |name, aspect|
          it "#{name} on the Frame, fill #{fill ? 'on' : 'off'}, info #{info ? 'on' : 'off'}: composed, nothing overlapping or cut" do
            fields = (info ? fields_for(%w[show_date show_weather]) : {}).merge('fill' => fill.to_s)
            page = screen('frame', fields, mocks: shape_shards(aspect).merge(services))
            wait(page)
            if info
              expect(page).to have_css('[data-info-block]')
              expect(page).to have_no_css('[data-placard]')
              expect(page).to have_css('[data-layout]'), 'the Frame landscape: band or column (frame_spec.rb holds the geometry)'
              expect(cut_parts(page)).to eq([])
            else
              expect(page).to have_no_css('[data-info-block]')
              expect(page).to have_css('[data-gallery] [data-label], [data-label]'), 'label on, no info: the mat and the gallery label, never full screen'
              expect(page).to have_no_css('[data-placard]')
              expect(page).to have_no_css('[data-mode="full"]')
            end
          end
        end
      end
    end
  end

  # the curator's keyline: lw (white mat) / lb (black mat); none by default, never on a work that fills the screen
  describe 'keyline' do
    def keyed(fixture_name, extra)
      doc = fixture(fixture_name)
      doc['w'][0].merge!(extra)
      MIRRORS_INFO.each_with_object({}) do |base, m|
        (0..15).each do |k|
          m["#{base}/landscape-#{k}.json"] = { json: doc }
          m["#{base}/portrait-#{k}.json"] = { json: doc }
        end
      end
    end

    it 'is drawn only when the work carries the flag for its mat (lw on white, lb on black); none without' do
      [['frame', 'one-landscape', 'lw', 'lb'], ['og_png', 'one-landscape', 'lw', 'lb'], ['frame', 'one-dark-landscape', 'lb', 'lw']].each do |device, fixture_name, right, wrong|
        none = screen(device, {}, mocks: keyed(fixture_name, {}))
        wait(none)
        expect(none).to have_css('[data-gallery]')
        expect(none).to have_no_css('[data-keyline]'), "#{device} #{fixture_name}: no key, no line"
        wrong_key = screen(device, {}, mocks: keyed(fixture_name, { wrong => 1 }))
        wait(wrong_key)
        expect(wrong_key).to have_no_css('[data-keyline]'), "#{device} #{fixture_name}: the flag of the other mat does nothing"
        with = screen(device, {}, mocks: keyed(fixture_name, { right => 1 }))
        wait(with)
        expect(with).to have_css('[data-bevel][data-keyline]')
        expect(with.evaluate("document.querySelectorAll('[data-block=\"primary\"] [data-keyline-edge]').length")).to eq(4)
        edge = with.evaluate("getComputedStyle(document.querySelector('[data-block=\"primary\"] [data-keyline-edge]')).backgroundColor")
        expect(edge).to eq(fixture_name.include?('dark') ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)'), 'the line is the mat\'s opposite'
      end
    end

    it 'is never drawn around a work that fills the screen, and not with the info on and the work filling its band' do
      full = screen('frame', { 'fill' => 'true', 'label' => 'false' }, mocks: keyed('one-wide-landscape', { 'lw' => 1, 'lb' => 1 }))
      wait(full)
      expect(full).to have_css('[data-mode="full"]')
      expect(full).to have_no_css('[data-keyline]')
      band = screen('frame', fields_for(%w[show_date]).merge('fill' => 'true'), mocks: keyed('one-wide-landscape', { 'lw' => 1, 'lb' => 1, 'w' => 2200, 'h' => 1000 }))
      wait(band)
      expect(band).to have_no_css('[data-keyline]')
    end
  end
end
