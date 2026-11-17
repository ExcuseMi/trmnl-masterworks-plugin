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

  def frame(fields, aspect, fixture_name = 'one-landscape')
    base = { 'weather_location' => 'Paris', 'ics_url' => LINK_FRAME }
    page = trmnl.render(view: 'full', device: 'frame', orientation: 'landscape', mocks: shape_shards(aspect, fixture_name).merge(services), custom_fields: base.merge(fields))
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
end
