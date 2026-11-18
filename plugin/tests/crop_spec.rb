# frozen_string_literal: true

# A work with the curator's crop (x: a scanner bed or a pale paper margin round the print) shows only the print: its box is a
# window that clips, the picture inside is larger by whole percents and pushed so the margins fall outside. The Great Wave
# on the OG showed the print 9 px inside its box (box y 74 to 414, print from y 83) and the text beside it looked misplaced.
require 'json'

RSpec.describe 'Masterworks cropped work' do
  BASES_CR = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze

  def render_cr(device, fields, box)
    doc = JSON.parse(File.read(File.join(__dir__, 'fixtures', 'one-landscape.json')))
    doc['w'][0].merge!('w' => 8561, 'h' => 6037)
    doc['w'][0]['x'] = box if box
    shards = BASES_CR.each_with_object({}) { |b, m| (0..7).each { |k| m["#{b}/landscape-#{k}.json"] = { json: doc }; m["#{b}/portrait-#{k}.json"] = { json: doc } } }
    page = trmnl.render(view: 'full', device:, orientation: 'landscape', mocks: shards, custom_fields: fields)
    page.has_css?('img.image')
    page
  end

  MEASURE_CR = <<~JS
    (() => {
      const P = '[data-block="primary"] ', r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; };
      const win = document.querySelector(P + '[data-crop]'), img = document.querySelector(P + 'img.image');
      if (!win) return { win: null, img: r(img), box: r(img.parentElement) };
      return { win: r(win), box: r(win.parentElement), pic: r(win.querySelector('[data-crop-picture]')), img: r(img), overflow: getComputedStyle(win).overflow, styles: win.querySelectorAll('[style]').length + (win.hasAttribute('style') ? 1 : 0) };
    })()
  JS

  INFO_CR = { 'show_date' => 'true', 'label' => 'true' }.freeze
  LABEL_CR = { 'label' => 'true' }.freeze
  OFF_CR = { 'label' => 'false' }.freeze
  WAVE_CR = [137, 313, 9682, 9375].freeze # hides 2 % left and right, 3.5 % above and below (transform.js cropPlan: 104 by 107 percent)
  TOP_CR = [0, 500, 10000, 9500].freeze   # a margin above only: 106 percent high, 5.5 % hidden above, 0.5 % below

  [['og_png', INFO_CR], ['v2', INFO_CR], ['frame', INFO_CR], ['og_png', LABEL_CR], ['v2', LABEL_CR], ['og_png', OFF_CR]].each do |device, fields|
    it "#{device} #{fields.keys.join('+')}: the box clips, the print fills it, the scanner bed is outside" do
      g = render_cr(device, fields, WAVE_CR).evaluate(MEASURE_CR)
      expect(g['win']).not_to be_nil, 'no clipping window'
      expect(g['overflow']).to eq('hidden')
      expect(g['styles']).to eq(0), 'Framework classes only'
      4.times { |k| expect(g['win'][k]).to be_within(0.6).of(g['box'][k]), "window #{g['win']} is not the picture's box #{g['box']}" }
      4.times { |k| expect(g['img'][k]).to be_within(0.6).of(g['pic'][k]), "image #{g['img']} is not its box #{g['pic']}" }
      w, h = g['win'][2], g['win'][3]
      expect(g['pic'][2]).to be_within(0.6).of(w * 1.04)
      expect(g['pic'][3]).to be_within(0.6).of(h * 1.07)
      expect(g['win'][0] - g['pic'][0]).to be_within(0.6).of(w * 0.02), 'hidden on the left'
      expect(g['win'][1] - g['pic'][1]).to be_within(0.6).of(h * 0.035), 'hidden above'
    end
  end

  it 'og_png: a margin on one side only is pushed out on that side' do
    g = render_cr('og_png', INFO_CR, TOP_CR).evaluate(MEASURE_CR)
    w, h = g['win'][2], g['win'][3]
    expect(g['pic'][2]).to be_within(0.6).of(w)
    expect(g['pic'][3]).to be_within(0.6).of(h * 1.06)
    expect(g['win'][1] - g['pic'][1]).to be_within(0.6).of(h * 0.055), 'hidden above'
    expect(g['win'][0] - g['pic'][0]).to be_within(0.6).of(0)
  end

  it 'og_png: a work without a box, or with a broken one, is drawn whole in its box as before' do
    [nil, [0, 0, 4000, 10000], 'x'].each do |box|
      g = render_cr('og_png', INFO_CR, box).evaluate(MEASURE_CR)
      expect(g['win']).to be_nil, "a window for #{box.inspect}"
      4.times { |k| expect(g['img'][k]).to be_within(0.6).of(g['box'][k]) }
    end
  end
end
