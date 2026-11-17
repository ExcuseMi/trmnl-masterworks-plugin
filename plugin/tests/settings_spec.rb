# frozen_string_literal: true

# The settings form: which fields appear when (TRMNL conditional_validation on the parent field).
require 'yaml'

RSpec.describe 'Masterworks settings form' do
  let(:fields) { YAML.safe_load_file(File.join(__dir__, '..', 'src', 'settings.yml'))['custom_fields'].to_h { |f| [f['keyname'], f] } }

  def hidden_by(parent_key, value)
    rules = fields.fetch(parent_key)['conditional_validation'] || []
    rules.select { |r| r['when'].to_s == value }.flat_map { |r| r['hidden'] || [] }
  end

  it 'hides Fill the screen when the label, the date, the weather or the agenda is on (a rule on each of the four parents)' do
    %w[label show_date show_weather show_agenda].each do |parent|
      expect(hidden_by(parent, 'true')).to include('fill'), parent
    end
  end

  it 'shows the weather fields only with the weather on, the calendar link only with the agenda on' do
    expect(hidden_by('show_weather', 'false')).to match_array(%w[weather_location temperature_unit])
    expect(hidden_by('show_agenda', 'false')).to eq(%w[ics_url])
  end

  it 'a field uses hidden or visible, never both; a conditionally hidden field is optional' do
    all = fields.values.flat_map { |f| f['conditional_validation'] || [] }
    expect(all.select { |r| r['visible'] }).to eq([]), 'hidden only: one way to say it'
    hidden = all.flat_map { |r| r['hidden'] || [] }.uniq
    expect(hidden).to match_array(%w[fill weather_location temperature_unit ics_url])
    hidden.each { |k| expect(fields.fetch(k)['optional']).to be(true), "#{k} must be optional: it may be hidden when the form is submitted" }
  end

  it 'the Fill help says it applies only when nothing else is on' do
    expect(fields['fill']['help_text']).to match(/label, the date, the weather and the agenda all off/)
  end
end
