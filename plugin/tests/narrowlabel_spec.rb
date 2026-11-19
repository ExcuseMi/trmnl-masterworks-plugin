# frozen_string_literal: true

# Review 2026-11-19: a tall narrow work on a portrait OG (the Mummy of Herakleides, four times as high as wide) showed its
# label cut: "UNKNOWN AR..." and "J. Paul Getty M...". The artist and detail lines take a second line there; nothing of the
# label is cut and the label stays under the picture, inside the screen.
require 'json'

RSpec.describe 'Masterworks label under a narrow picture' do
  NL_BASES = %w[
    https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data
    https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
    https://excusemi.github.io/trmnl-masterworks-plugin/data
    https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data
  ].freeze
  NL_WORK = { 'i' => 'Q111417085', 't' => 'Mummy of Herakleides', 'a' => 'Unknown artist', 'f' => 'Mummy of Herakleides, front view - Getty Museum (91.AP.6).jpg',
              'w' => 4719, 'h' => 11_123, 's' => 3, 'p' => 0.439, 'k' => 0, 'g' => 0, 'c' => 0, 'x' => [2422, 586, 5331, 8879] }.freeze
  NL_DOC = { 'v' => 1, 'built' => '2026-11-19', 'n' => 1, 'gen' => %w[portrait], 'col' => ['J. Paul Getty Museum'], 'mov' => [], 'med' => [], 'w' => [NL_WORK] }.freeze

  let(:mocks) { NL_BASES.each_with_object({}) { |b, m| (0..15).each { |k| m["#{b}/landscape-#{k}.json"] = { json: NL_DOC }; m["#{b}/portrait-#{k}.json"] = { json: NL_DOC } } } }

  %w[og_png og_plus].each do |device|
    it "#{device} portrait: the artist and museum lines are whole, on at most two lines, inside the screen" do
      page = trmnl.render(view: 'full', device:, orientation: 'portrait', mocks:, custom_fields: { 'family_friendly' => 'false', 'label' => 'true' })
      page.has_css?('[data-label] [data-title]')
      got = page.evaluate(<<~JS)
        (() => { const lab = document.querySelector('[data-block="primary"] [data-label]'), lay = lab.closest('.layout').getBoundingClientRect(), r = lab.getBoundingClientRect();
          return { text: Array.from(lab.querySelectorAll('span')).map(s => s.textContent.trim()), heights: Array.from(lab.querySelectorAll('span')).map(s => Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight))),
            inside: r.bottom <= lay.bottom + 1 && r.left >= lay.left - 1 && r.right <= lay.right + 1 }; })()
      JS
      expect(got['text']).to eq(['Mummy of Herakleides', 'UNKNOWN ARTIST', 'J. Paul Getty Museum'])
      expect(got['heights'].max).to be <= 2
      expect(got['inside']).to be(true)
    end
  end
end
