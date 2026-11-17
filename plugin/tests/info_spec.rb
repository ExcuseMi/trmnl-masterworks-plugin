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
  def parts(page)
    page.evaluate("[...document.querySelectorAll('[data-strip] [data-info], [data-strip] [data-label]')].map(e => { const r = e.getBoundingClientRect(); return [e.dataset.info || 'label', r.left, r.top, r.right, r.bottom]; })")
  end

  %w[frame og_png].each do |device|
    COMBOS.each do |name, keys|
      VIEWS_INFO.each do |view|
        it "#{name} on #{device}, #{view}: only the parts that are on, composed inside the strip, nothing overlapping or cut off" do
          page = screen(device, fields_for(keys), view:)
          wait(page)
          expect(page).to have_css('[data-strip]')
          { 'date' => 'show_date', 'weather' => 'show_weather', 'agenda' => 'show_agenda' }.each do |part, key|
            if keys.include?(key)
              expect(page).to have_css("[data-strip] [data-info=\"#{part}\"]")
            else
              expect(page).to have_no_css("[data-strip] [data-info=\"#{part}\"]")
            end
          end
          strip = rect(page, '[data-strip]')
          lay = rect(page, '.layout')
          expect(strip[3]).to be <= lay[3] + 3
          expect(strip[1]).to be > lay[1] # below the picture, not over it
          shown = parts(page).sort_by { |p| p[1] }
          shown.each do |_n, l, t, r, b|
            expect(l).to be >= strip[0] - 1
            expect(r).to be <= strip[2] + 1
            expect(t).to be >= strip[1] - 1
            expect(b).to be <= strip[3] + 1
          end
          # the parts on one row do not overlap (the museum label may be left out when there is no room)
          row1 = shown.select { |p| (p[2] - shown.first[2]).abs < 20 }
          row1.each_cons(2) { |a, b| expect(b[1]).to be >= a[3] - 1 }
          # the picture is above the strip, whole
          img = rect(page, 'img.image')
          expect(img[3]).to be <= strip[1] + 2
        end
      end
    end

    it "nothing on: no strip, the museum label under the picture, as before (#{device})" do
      page = screen(device, {})
      wait(page)
      expect(page).to have_no_css('[data-strip]')
      expect(page).to have_css('[data-label], [data-placard]')
    end

    it "weather that cannot be fetched leaves the date alone and never an error (#{device})" do
      page = screen(device, fields_for(%w[show_date show_weather]), mocks: shards.merge(services).merge('https://api.open-meteo.com/*' => { status: 503 }))
      wait(page)
      expect(page).to have_css('[data-strip] [data-info="date"]')
      expect(page).to have_no_css('[data-info="weather"]')
      expect(page).to have_no_text('error')
    end

    it "no weather location: the date alone; an agenda toggle without a link: nothing (#{device})" do
      page = screen(device, fields_for(%w[show_date show_weather show_agenda]).merge('weather_location' => '', 'ics_url' => ''))
      wait(page)
      expect(page).to have_css('[data-strip] [data-info="date"]')
      expect(page).to have_no_css('[data-info="weather"], [data-info="agenda"]')
      only_agenda = screen(device, fields_for(%w[show_agenda]).merge('ics_url' => ''))
      wait(only_agenda)
      expect(only_agenda).to have_no_css('[data-strip]')
    end
  end

  it 'shows the weather text and the agenda events on the Frame' do
    page = screen('frame', fields_for(%w[show_date show_weather show_agenda]))
    wait(page)
    expect(page.evaluate("document.querySelector('[data-forecast]').innerText")).to match(/Rain|Dry|Snow|Fog|Sunny|Clear|Drizzle|Storm/)
    expect(page.evaluate("document.querySelector('[data-temp]').innerText")).to match(/\A-?\d+°\z/)
    expect(page.evaluate("[...document.querySelectorAll('[data-event-title]')].map(e => e.innerText).join('|')")).to include('Birthday').or include('Call the plumber')
    expect(page.evaluate("document.querySelector('[data-day]').innerText")).to match(/\A\d{1,2}\z/)
  end

  it 'draws the strip on a portrait Frame, below the picture' do
    page = screen('frame', fields_for(COMBOS['date, weather and agenda']), orientation: 'portrait', mocks: shards('one-wide-landscape', 'one-portrait').merge(services))
    wait(page)
    expect(page).to have_css('[data-strip]')
    strip = rect(page, '[data-strip]')
    expect(strip[3]).to be <= rect(page, '.layout')[3] + 3
    expect(rect(page, 'img.image')[3]).to be <= strip[1] + 2
  end

  it 'puts the strip in the band the work is fitted to: a work that fills the bare screen is hung in the band' do
    wide = shards('one-wide-landscape', 'one-portrait')
    bare = screen('frame', {}, mocks: wide)
    wait(bare)
    expect(bare).to have_css('[data-mode="full"]')
    with = screen('frame', fields_for(%w[show_date]), mocks: wide.merge(services))
    wait(with)
    expect(with).to have_css('[data-gallery]')
  end

  it 'draws the strip in white text on a black mat when the work hangs on black' do
    page = screen('frame', fields_for(%w[show_date]), mocks: shards('one-dark-landscape', 'one-portrait'))
    wait(page)
    expect(page.evaluate("getComputedStyle(document.querySelector('[data-strip]')).backgroundColor")).to eq('rgb(0, 0, 0)')
    expect(page.evaluate("getComputedStyle(document.querySelector('[data-day]')).color")).to eq('rgb(255, 255, 255)')
  end
end
