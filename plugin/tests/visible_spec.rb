# frozen_string_literal: true

# The painting's title (label on) and the day number (date on) never vanish while a layout fits them: every device, orientation and shape,
# with TRMNL's default settings and with the date on and no weather location or calendar link (as in TRMNL's own preview).
require 'json'

RSpec.describe 'Masterworks title and day number are always shown' do
  BASES_VIS = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def render_vis(device, orientation, aspect, fx, fields, title = nil, view = 'full')
    doc = fixture(fx)
    doc['w'][0]['t'] = title if title
    doc['w'][0]['w'] = (aspect * 1000).round
    doc['w'][0]['h'] = 1000
    shards = BASES_VIS.each_with_object({}) { |b, m| (0..7).each { |k| m["#{b}/landscape-#{k}.json"] = { json: doc }; m["#{b}/portrait-#{k}.json"] = { json: doc } } }
    page = trmnl.render(view:, device:, orientation:, mocks: shards, custom_fields: fields)
    page.has_css?('img.image')
    page
  end

  def shown(page, sel) = page.evaluate("[...document.querySelectorAll('[data-block=\"primary\"] #{sel}')].some(e => e.offsetParent && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0)")

  SETTINGS = {
    'defaults' => { 'label' => 'true' },
    'date, no location or link' => { 'label' => 'true', 'show_date' => 'true', 'show_weather' => 'true', 'show_agenda' => 'true' }
  }.freeze

  LONG = 'Madame Georges Charpentier and her Children'
  # TRMNL's own preview showed no label and no date for this work on the OG (the column was too narrow for the title)
  [['og_png', 1.24], ['og_png', 1.23], ['v2', 1.24], ['frame', 1.24]].each do |device, aspect|
    it "#{device} #{aspect} long title, date on: the title and the day number are shown" do
      page = render_vis(device, 'landscape', aspect, 'one-landscape', SETTINGS['date, no location or link'], LONG)
      expect(shown(page, 'span[data-label]')).to be(true), 'the title'
      expect(shown(page, '[data-day]')).to be(true), 'the day number'
    end
  end

  %w[og_png v2 frame].each do |device|
    %w[landscape portrait].each do |orientation|
      [[0.75, 'one-landscape'], [1.0, 'one-landscape'], [1.23, 'one-landscape'], [1.33, 'one-dark-landscape'], [1.5, 'one-landscape'], [1.78, 'one-dark-landscape']].each do |aspect, fx|
        SETTINGS.each do |name, fields|
          it "#{device} #{orientation} #{aspect} #{fx}, #{name}: the title and the day number are shown" do
            page = render_vis(device, orientation, aspect, fx, fields)
            expect(shown(page, 'span[data-label], [data-label] span, [data-label]')).to be(true), 'the title is shown'
            expect(shown(page, '[data-day]')).to be(true), 'the day number is shown' if fields['show_date'] == 'true'
          end
        end
      end
    end
  end

  # the four TRMNL views on the OG and the X, with TRMNL's defaults and with the date on (no location, no link)
  %w[full half_horizontal half_vertical quadrant].each do |view|
    %w[og_png v2].each do |device|
      [[1.24, 'one-landscape', LONG], [1.5, 'one-dark-landscape', nil]].each do |aspect, fx, title|
        SETTINGS.each do |name, fields|
          it "#{device} #{view} #{aspect} #{title ? 'long title' : fx}, #{name}: the title is shown, and the day number when the date is on" do
            page = render_vis(device, 'landscape', aspect, fx, fields, title, view)
            sel = "[data-block=\"primary\"] "
            expect(page.evaluate("[...document.querySelectorAll('#{sel}[data-label], #{sel}[data-slot=label] span, #{sel}.title, #{sel}.label')].some(e => e.offsetParent && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0 && /\\w/.test(e.innerText))")).to be(true), 'the title'
            # the OG's half and quarter slots are lower than INFO_MIN_SLOT (300 CSS px): no info fits there by design, the title stays
            small_og = device == 'og_png' && view != 'full'
            expect(shown(page, '[data-day]')).to be(true), 'the day number' if fields['show_date'] == 'true' && !small_og
          end
        end
      end
    end
  end
end
