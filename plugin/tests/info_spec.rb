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
      (0..7).each do |k|
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

  def screen(device, fields, view: 'full', orientation: 'landscape', mocks: shards.merge(services))
    base = { 'weather_location' => 'Paris', 'ics_url' => LINK }
    trmnl.render(view:, device:, orientation:, mocks:, custom_fields: base.merge(fields))
  end

  def fields_for(keys) = keys.to_h { |k| [k, 'true'] }
  def wait(page) = page.has_css?('img.image')

  def rect(page, selector)
    page.evaluate("(() => { const r = document.querySelector('#{selector}').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
  end

  # the boxes of the parts of the strip, left to right
  # the boxes of the picture (bevel) and of the info block, and of every text part inside the block
  def box(page, selector)
    page.evaluate("(() => { const e = document.querySelector('#{selector}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
  end

  def overlap?(a, b) = a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1

  # nothing is cut: a text part whose lines are clamped must have all of its text visible (these texts are short)
  def cut_parts(page)
    page.evaluate("[...document.querySelectorAll('[data-info-block] [data-clamp]')].filter(e => e.scrollHeight > e.clientHeight + 4 || e.scrollWidth > e.clientWidth + 2).map(e => e.innerText)")
  end

  def expect_composed(page, where)
    lay = box(page, '.layout')
    pic = box(page, '[data-bevel]')
    blk = box(page, '[data-info-block]')
    expect(blk).not_to be_nil, "#{where}: an info block"
    expect(overlap?(pic, blk)).to be(false), "#{where}: the info block overlaps the picture #{pic} #{blk}"
    [pic, blk].each do |b|
      expect(b[0]).to be >= lay[0] - 1
      expect(b[1]).to be >= lay[1] - 1
      expect(b[2]).to be <= lay[2] + 1
      expect(b[3]).to be <= lay[3] + 1
    end
    kind = page.evaluate("document.querySelector('[data-info-block]').dataset.infoBlock")
    if kind == 'below'
      expect(blk[0]).to be_within(3).of(pic[0]), "#{where}: the block's left edge is the picture's"
      expect(blk[2]).to be_within(3).of(pic[2]), "#{where}: the block's right edge is the picture's"
      expect(blk[1]).to be >= pic[3] - 1
    else
      expect(blk[3]).to be_within(3).of(pic[3]), "#{where}: the block ends on the picture's bottom edge"
      expect(blk[0]).to be >= pic[2] - 1
    end
    cut = cut_parts(page)
    expect(cut).to eq([]), "#{where}: text is cut: #{cut}"
    kind
  end

  %w[frame og_png].each do |device|
    COMBOS.each do |name, keys|
      it "#{name} on #{device}: only the parts that are on, composed with the picture, nothing overlapping or cut off" do
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
        # fixed order: date, weather, agenda
        order = page.evaluate("[...document.querySelectorAll('[data-info-block] [data-info]')].map(e => e.dataset.info)")
        expect(order).to eq(%w[date weather agenda] & order)
      end
    end

    it "nothing on: no info block, the museum label under the picture, as before (#{device})" do
      page = screen(device, {})
      wait(page)
      expect(page).to have_no_css('[data-info-block]')
      expect(page).to have_css('[data-label], [data-placard]')
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

  it 'shows the weather sentence and the agenda events on the Frame, in black' do
    page = screen('frame', fields_for(%w[show_date show_weather show_agenda]))
    wait(page)
    expect(page.evaluate("document.querySelector('[data-temp]').innerText")).to match(/\A-?\d+°\z/)
    expect(page.evaluate("document.querySelector('[data-weather]').innerText")).to match(/\A(Rain|Drizzle|Snow|Storm|Dry|Sunny|Clear|Fog)/)
    expect(page.evaluate("[...document.querySelectorAll('[data-event-title]')].map(e => e.innerText).join('|')")).to include('Birthday').or include('Call the plumber')
    expect(page.evaluate("document.querySelector('[data-day]').innerText")).to match(/\A\d{1,2}\z/)
    inks = page.evaluate("[...new Set([...document.querySelectorAll('[data-info-block] *')].map(e => getComputedStyle(e).color))]")
    expect(inks - ['rgb(0, 0, 0)', 'rgb(255, 255, 255)']).to eq([]), 'the info text is black (or the mat ink), never a colour'
  end

  # the shape table in the browser: every shape of work on every screen, the info beside or below, the work whole
  SHAPES = { 'very wide panorama' => 2.5, 'wide' => 1.8, "the screen's own shape" => 16.0 / 9, '4:3' => 4.0 / 3, 'square' => 1.0, '3:4' => 0.75, 'tall' => 0.6, 'very tall scroll' => 0.35 }.freeze

  def shape_shards(aspect)
    doc = fixture('one-landscape')
    doc['w'][0]['w'] = (aspect * 1000).round
    doc['w'][0]['h'] = 1000
    MIRRORS_INFO.each_with_object({}) do |base, m|
      (0..7).each do |k|
        m["#{base}/landscape-#{k}.json"] = { json: doc }
        m["#{base}/portrait-#{k}.json"] = { json: doc }
      end
    end
  end

  [['frame', 'landscape'], ['frame', 'portrait'], ['v2', 'landscape'], ['og_png', 'landscape']].each do |device, orientation|
    SHAPES.each do |name, aspect|
      it "#{name} on #{device} #{orientation}: the info block and the picture do not overlap, the work is whole, nothing is cut" do
        page = screen(device, fields_for(COMBOS['date, weather and agenda']), orientation:, mocks: shape_shards(aspect).merge(services))
        wait(page)
        expect(page).to have_css('[data-gallery]'), 'on the mat, never a placard over the art'
        expect(page).to have_no_css('[data-placard]')
        expect_composed(page, "#{name} on #{device} #{orientation}")
        pic = box(page, '[data-bevel]')
        expect(((pic[2] - pic[0]).to_f / (pic[3] - pic[1]) / aspect) - 1).to be_within(0.05).of(0), "the picture has the work's shape (no crop): #{pic}"
      end
    end
  end

  it 'puts the info in the room the work leaves: a wide work leaves room below, a tall one beside, on the Frame' do
    wide = screen('frame', fields_for(%w[show_date]), mocks: shape_shards(2.5).merge(services))
    wait(wide)
    expect(wide).to have_css('[data-info-block="below"]')
    tall = screen('frame', fields_for(%w[show_date]), mocks: shape_shards(0.6).merge(services))
    wait(tall)
    expect(tall).to have_css('[data-info-block="side"]')
  end

  it 'draws the info in white text on a black mat when the work hangs on black' do
    page = screen('frame', fields_for(%w[show_date]), mocks: shards('one-dark-landscape', 'one-portrait'))
    wait(page)
    expect(page.evaluate("getComputedStyle(document.querySelector('[data-gallery]')).backgroundColor")).to eq('rgb(0, 0, 0)')
    expect(page.evaluate("getComputedStyle(document.querySelector('[data-day]')).color")).to eq('rgb(255, 255, 255)')
  end
end
