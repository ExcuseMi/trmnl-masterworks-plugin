# frozen_string_literal: true

# A very long title (the Tiffany "On the Way between Old and New Cairo ..." work, 96 characters, and an even longer one) never leaves a
# tiny work with no label: the title stays visible and the work is not smaller than the layout with the label under it gives (the floor,
# data-floor in cqw), whatever the info settings. Whenever the info block is hidden the work takes the whole mat.
require 'json'

RSpec.describe 'Masterworks long titles' do
  BASES_LT = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze
  REAL = 'On the Way between Old and New Cairo, Citadel Mosque of Mohammed Ali, and Tombs of the Mamelukes'
  LONGER = "#{REAL}, with the Caravan Resting under the Walls" # 140 characters: on every device the title shows, clamped (data-clamp) to the lines that fit when it does not fit whole

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def render_lt(device, orientation, title, fields)
    doc = fixture('one-landscape')
    doc['w'][0].merge!('w' => 5732, 'h' => 3487, 't' => title)
    shards = BASES_LT.each_with_object({}) { |b, m| (0..7).each { |k| m["#{b}/landscape-#{k}.json"] = { json: doc }; m["#{b}/portrait-#{k}.json"] = { json: doc } } }
    page = trmnl.render(view: 'full', device:, orientation:, mocks: shards, custom_fields: fields)
    page.has_css?('img.image')
    page
  end

  def title_shown(page)
    page.evaluate("[...document.querySelectorAll('[data-block=\"primary\"] [data-label], [data-block=\"primary\"] [data-title]')].some(e => e.offsetParent && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0 && /\\w/.test(e.innerText))")
  end

  # the work's width and height as shares of its block, and the layout's floor (cqw) when it has one
  def work(page)
    page.evaluate("(() => { const b = document.querySelector('[data-block=\"primary\"]'), r = b.getBoundingClientRect(), i = b.querySelector('img.image').getBoundingClientRect(); return { w: 100 * i.width / r.width, h: 100 * i.height / r.height, floor: +(b.getAttribute('data-floor') || 0), info: !!b.querySelector('[data-info-block]:not(.hidden)'), blocks: b.querySelectorAll('[data-info-block]').length }; })()")
  end

  SETTINGS = {
    'label only' => { 'label' => 'true' },
    'date, weather, agenda, label' => { 'show_date' => 'true', 'show_weather' => 'true', 'show_agenda' => 'true', 'label' => 'true' },
    'date only' => { 'show_date' => 'true' }
  }.freeze

  # a title no layout can hold hides the whole block: the work then takes the whole mat (as much as the shape allows), never the size planned for the info
  %w[frame og_png v2].each do |device|
    %w[landscape portrait].each do |orientation|
      it "#{device} #{orientation} 900 chars: when the info block is hidden the work fills the mat" do
        page = render_lt(device, orientation, "#{LONGER} #{LONGER} #{LONGER} #{LONGER} #{LONGER}", SETTINGS['date, weather, agenda, label'])
        w = work(page)
        expect(w['w']).to be >= 45
        expect(w['w'] >= 88 || w['h'] >= 88).to be(true), "the work is #{w['w'].round} x #{w['h'].round}% with no info shown" if w['blocks'].positive? && !w['info']
      end
    end
  end

  %w[frame og_png v2].each do |device|
    %w[landscape portrait].each do |orientation|
      [REAL, LONGER].each do |title|
        SETTINGS.each do |name, fields|
          it "#{device} #{orientation} #{title.length} chars, #{name}: the title is shown (label on) and the work is big" do
            page = render_lt(device, orientation, title, fields)
            w = work(page)
            expect(title_shown(page)).to be(true), 'the title' if fields['label'] == 'true'
            if fields['label'] == 'true' && fields.key?('show_date')
              t = page.evaluate("(() => { const e = [...document.querySelectorAll('[data-block=\"primary\"] [data-info-block] [data-label]')].find(x => x.offsetParent && !x.classList.contains('hidden')); return e ? [e.textContent.trim(), e.getAttribute('data-clamp'), e.getAttribute('data-full')] : null; })()")
              expect(t).not_to be_nil, 'the title is in the info block'
              expect(t[0].end_with?('...') ? !t[1].nil? : true).to be(true), 'a shortened title carries data-clamp'
              expect(t[0].length).to be >= 20, 'a clamped title keeps its first lines'
            end
            expect(w['w']).to be >= 45, "the work is #{w['w'].round}% of the width (tiny)"
            expect(w['w']).to be >= w['floor'] - 1, "the work is narrower than the row-under floor #{w['floor']}"
          end
        end
      end
    end
  end
end
