# frozen_string_literal: true

# One wrapper holds the work and all its detail in every layout (band, row under, column, stack, label only below and in a column); the
# work is the only planned size, so no detail element carries a cqw width of its own and a row can never be wider than the work.
require 'json'

RSpec.describe 'Masterworks one wrapper per layout' do
  BASES_WR = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze

  def fixture(name) = JSON.parse(File.read(File.join(__dir__, 'fixtures', "#{name}.json")))

  def render_wr(device, orientation, w, h, fields)
    doc = fixture('one-landscape')
    doc['w'][0].merge!('w' => w, 'h' => h)
    shards = BASES_WR.each_with_object({}) { |b, m| (0..7).each { |k| m["#{b}/landscape-#{k}.json"] = { json: doc }; m["#{b}/portrait-#{k}.json"] = { json: doc } } }
    page = trmnl.render(view: 'full', device:, orientation:, mocks: shards, custom_fields: fields)
    page.has_css?('img.image')
    page
  end

  INFO = { 'show_date' => 'true', 'label' => 'true' }.freeze
  LABEL = { 'label' => 'true' }.freeze

  CASES_WR = [
    ['frame', 'landscape', 2400, 1000, INFO, 'band'], ['v2', 'landscape', 2000, 1000, INFO, 'band'], ['og_png', 'landscape', 2200, 1000, INFO, 'band'],
    ['v2', 'landscape', 1500, 1000, INFO, 'below'], ['og_png', 'landscape', 1780, 1000, INFO, 'below'], ['frame', 'landscape', 1780, 1000, INFO, 'below'],
    ['frame', 'landscape', 1000, 1000, INFO, 'column'], ['v2', 'landscape', 1000, 1000, INFO, 'column'], ['og_png', 'landscape', 1000, 1000, INFO, 'column'],
    ['v2', 'portrait', 1500, 1000, INFO, 'stack'], ['og_png', 'portrait', 1500, 1000, INFO, 'stack'], ['frame', 'portrait', 1500, 1000, INFO, 'stack'],
    ['v2', 'landscape', 1500, 1000, LABEL, 'label below'], ['frame', 'landscape', 1500, 1000, LABEL, 'label below'], ['og_png', 'landscape', 1000, 1000, LABEL, 'label column'],
    ['v2', 'landscape', 1000, 1000, LABEL, 'label column'], ['frame', 'landscape', 1000, 1000, LABEL, 'label column']
  ].freeze

  CASES_WR.each do |device, orientation, w, h, fields, kind|
    it "#{device} #{orientation} #{(w.to_f / h).round(2)} #{kind}: one wrapper holds the work and all the detail, no detail has its own cqw width" do
      page = render_wr(device, orientation, w, h, fields)
      r = page.evaluate(<<~JS)
        (() => {
          const lay = document.querySelector('[data-block="primary"]'), wraps = lay.querySelectorAll('[data-wrap]');
          if (wraps.length !== 1) return { wraps: wraps.length };
          const wr = wraps[0], detail = [...lay.querySelectorAll('[data-info-block], [data-row], [data-cell], [data-label], [data-who], [data-museum], [data-title], [data-day]')];
          return { wraps: 1, img: wr.contains(lay.querySelector('img.image')), outside: detail.filter(e => !wr.contains(e)).length, own: detail.filter(e => /(^| )w--\\[[0-9.]+cqw\\]/.test(e.className)).map(e => e.className) };
        })()
      JS
      expect(r['wraps']).to eq(1), "#{r['wraps']} wrappers"
      expect(r['img']).to be(true), 'the image is in the wrapper'
      expect(r['outside']).to eq(0), 'detail outside the wrapper'
      expect(r['own']).to eq([]), 'detail with its own cqw width'
    end
  end
end
