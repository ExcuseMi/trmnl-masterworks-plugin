# frozen_string_literal: true

# The settings form: which fields appear when (TRMNL conditional_validation on the parent field).
require 'yaml'
require 'json'

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

  # Live plugin, many users: TRMNL keeps a user's saved value by keyname, and a changed key, type or option value loses it
  # (seen on another plugin: changed custom fields wiped the saved values). Labels, help texts and the order may change freely.
  # A new field or option is added to tests/settings_contract.json on purpose; nothing in it is ever renamed or removed.
  it 'keeps every saved setting: no keyname, field type, default or option value of the released form is changed or removed' do
    contract = JSON.parse(File.read(File.join(__dir__, 'settings_contract.json')))
    contract.each do |key, was|
      now = fields[key]
      expect(now).not_to be_nil, "#{key} is gone: its saved values are lost"
      expect(now['field_type']).to eq(was['field_type']), "#{key}: field type"
      expect(now['multiple'] == true).to eq(was['multiple']), "#{key}: multiple"
      expect(now['default']).to eq(was['default']), "#{key}: default (users who never saved get the new one)"
      values = (now['options'] || []).map { |o| o.values.first.to_s }
      expect(was['options'] - values).to eq([]), "#{key}: option values removed or renamed"
    end
    extra = fields.keys - contract.keys - %w[author_bio]
    expect(extra).to eq([]), "new fields #{extra}: add them to tests/settings_contract.json"
  end

  it 'the Fill help says it applies only when nothing else is on' do
    expect(fields['fill']['help_text']).to match(/label, the date, the weather and the agenda all off/)
  end
end
