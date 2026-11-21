import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SourceRegistry } from '../../src/data/types';
import { readRows, splitRecord } from './aact';
import { buildDataset } from './build';
import { classifyCondition, conditionExclusion } from './cohort';
import { assignMeasureInstances, buildDemographics, classifyMeasure, confirmedDenominator, parseCompletionDate, parseCount, type BaselineRow } from './normalize';

// Small synthetic AACT tables. Every record is invented; none enters the public dataset.
const FIXTURES = fileURLToPath(new URL('./fixtures/aact', import.meta.url));
const reference: SourceRegistry = {
  schemaVersion: '1.0',
  sources: [
    { id: 'aact-snapshot-2026-11-17', author: 'Fixture', title: 'Fixture snapshot', publicationDate: '2026-11-17', url: 'https://example.org/aact', accessedDate: '2026-11-18', supports: ['Test input.'] },
    { id: 'aact-overview', author: 'Fixture', title: 'Fixture overview', publicationDate: null, url: 'https://example.org/aact', accessedDate: '2026-11-18', supports: ['Test input.'] },
    { id: 'tasneem-2012-aact', author: 'Fixture', title: 'Fixture AACT paper', publicationDate: null, url: 'https://example.org/paper', accessedDate: '2026-11-18', supports: ['Test input.'] },
  ],
};
const build = () => buildDataset(FIXTURES, '2026-11-18', reference);

async function collect(text: string) {
  const rows = [];
  for await (const row of readRows(Readable.from([text]))) rows.push(row);
  return rows;
}

describe('AACT flat-file reader', () => {
  it('handles quoted pipes, doubled quotes and line breaks inside a field', async () => {
    expect(splitRecord('1|"a | b"|c')).toEqual(['1', 'a | b', 'c']);
    const rows = await collect('id|text\n1|"first ""line""\nsecond line"\n2|plain\n');
    expect(rows).toEqual([{ id: '1', text: 'first "line"\nsecond line' }, { id: '2', text: 'plain' }]);
  });
  it('rejects records with the wrong number of fields and unterminated quotes', async () => {
    await expect(collect('a|b\n1|2|3\n')).rejects.toThrow(/expected 2 fields/);
    await expect(collect('a|b\n1|"open\n')).rejects.toThrow(/unterminated/);
  });
});

describe('cohort rules', () => {
  it('recognizes type 2 diabetes spellings and rejects other diabetes types', () => {
    for (const name of ['Diabetes Mellitus, Type 2', 'Type II Diabetes', 'type2diabetes', 'T2DM', 'NIDDM',
      'Diabetes Mellitus, Non-Insulin-Dependent', 'Hypercholesterolemia with type2dm', 'Diabetes Mellitus, Adult-Onset']) {
      expect(classifyCondition(name), name).toBe('type-2-diabetes');
    }
    for (const name of ['Type 1 Diabetes', 'Diabetes Mellitus', 'Prediabetes', 'Gestational Diabetes', 'Type III hyperlipoproteinemia']) {
      expect(classifyCondition(name), name).toBe('no-match');
    }
  });
  it('does not count at-risk, prevention or healthy-volunteer conditions on their own', () => {
    expect(classifyCondition('At Risk of Type 2 Diabetes Mellitus')).toBe('qualified-only');
    expect(conditionExclusion(['At Risk of Type 2 Diabetes'])).toBe('type-2-diabetes-only-in-at-risk-or-healthy-condition');
    expect(conditionExclusion(['Healthy Volunteers Diabetes Mellitus, Type 2', 'Type 2 Diabetes'])).toBeNull();
    expect(conditionExclusion([])).toBe('no-type-2-diabetes-condition');
  });
});

describe('scalar normalization', () => {
  it('keeps the precision the registry supplied and never invents a day', () => {
    expect(parseCompletionDate('2015')).toEqual({ value: '2015', precision: 'year' });
    expect(parseCompletionDate('2015-06')).toEqual({ value: '2015-06', precision: 'month' });
    expect(parseCompletionDate('2015-06-30')).toEqual({ value: '2015-06-30', precision: 'day' });
    expect(parseCompletionDate('')).toBeNull();
    expect(parseCompletionDate('2015-02-30')).toBeNull();
    expect(parseCompletionDate('June 2015')).toBeNull();
  });
  it('treats missing or malformed counts as unknown, never zero', () => {
    expect(parseCount('')).toBeNull();
    expect(parseCount('-1')).toBeNull();
    expect(parseCount('1.5')).toBeNull();
    expect(parseCount('0')).toBe(0);
    expect(parseCount(' 42 ')).toBe(42);
  });
});

describe('demographic classification and denominators', () => {
  const row = (fields: Partial<BaselineRow>): BaselineRow => ({
    id: '1', result_group_id: 'g', ctgov_group_code: 'BG000', classification: '', category: '', title: 'Sex: Female, Male',
    units: 'Participants', param_type: 'COUNT_OF_PARTICIPANTS', param_value: '', param_value_num: '', explanation_of_na: '',
    number_analyzed: '', number_analyzed_units: 'Participants', ...fields,
  });
  it('keeps sex, gender and combined measures in the field their label names', () => {
    expect(classifyMeasure('Sex: Female, Male')).toMatchObject({ kind: 'demographic', rule: { domain: 'sex' } });
    expect(classifyMeasure('Gender')).toMatchObject({ kind: 'demographic', rule: { domain: 'gender' } });
    expect(classifyMeasure('Race/Ethnicity, Customized')).toMatchObject({ kind: 'demographic', rule: { domain: 'race' } });
    expect(classifyMeasure('Age at onset of diabetes')).toEqual({ kind: 'other' });
    expect(classifyMeasure('Hair loss score', 'Male')).toEqual({ kind: 'needs-review' });
  });
  it('uses a reported denominator only when the posted counts confirm it', () => {
    const female = row({ id: '1', category: 'Female', param_value_num: '25' });
    const male = row({ id: '2', category: 'Male', param_value_num: '35' });
    // AACT reported 56 analyzed, but the categories add up to the group's baseline count of 60.
    expect(confirmedDenominator([{ ...female, number_analyzed: '56' }, { ...male, number_analyzed: '56' }], 60)).toBe(60);
    // A genuine smaller per-measure count: the categories add up to it.
    expect(confirmedDenominator([{ ...female, number_analyzed: '60' }, { ...male, param_value_num: '35', number_analyzed: '60' }], 70)).toBe(60);
    // Customized measures may hold their category label in the classification column instead.
    const white = row({ classification: 'White', param_value_num: '50', number_analyzed: '999' });
    const black = row({ classification: 'Black', param_value_num: '10', number_analyzed: '999' });
    expect(confirmedDenominator([white, black], 60)).toBe(60);
    // Older registry counts use the NUMBER type with participant units; percentages do not count.
    const numberCounts = [white, black].map((r) => ({ ...r, param_type: 'NUMBER' }));
    expect(confirmedDenominator(numberCounts, 60)).toBe(60);
    expect(confirmedDenominator(numberCounts.map((r) => ({ ...r, units: 'percentage of participants' })), 60)).toBeNull();
    // Two-level tables (classification and category both used) are not summed.
    expect(confirmedDenominator([{ ...white, category: 'Female' }, { ...black, category: 'Male' }], 60)).toBeNull();
    // A continuous measure cannot be cross-checked against categories.
    const mean = row({ title: 'Age, Continuous', param_type: 'MEAN', param_value_num: '58', number_analyzed: '999' });
    expect(confirmedDenominator([mean], 60)).toBeNull();
    expect(confirmedDenominator([{ ...mean, number_analyzed: '60' }], 60)).toBe(60);
  });
  it('starts a new posting when a cell repeats, even with the same description', () => {
    const a = row({ id: '1', category: 'Female', param_value_num: '5' });
    const b = row({ id: '2', category: 'Male', param_value_num: '6' });
    const again = row({ id: '3', category: 'Female', param_value_num: '7' });
    const instances = assignMeasureInstances([a, b, again]);
    expect([a, b, again].map((r) => instances.get(r))).toEqual([1, 1, 2]);
  });
  it('keeps race-then-ethnicity style tables together and explains why they total twice the group', () => {
    const count = (id: string, classification: string, value: string) =>
      row({ id, title: 'Race/Ethnicity, Customized', classification, param_value_num: value, number_analyzed: '56' });
    const rows = [count('1', 'White', '7'), count('2', 'Black', '3'), count('3', 'Hispanic', '2'), count('4', 'Not Hispanic', '8')];
    const { demographics } = buildDemographics(rows, new Map(), new Map([['g', 10]]), 'src');
    expect(new Set(demographics.race.measures.map((m) => m.measureInstance))).toEqual(new Set([1]));
    expect(demographics.race.measures.every((m) => m.denominator === null)).toBe(true);
    expect(demographics.race.notes.join(' ')).toMatch(/add up to 2 times each group's size/);
    // Even when AACT's "number analyzed" equals the doubled total, it is not accepted as the denominator.
    const doubled = rows.map((r) => ({ ...r, number_analyzed: '20' }));
    expect(confirmedDenominator(doubled, 10)).toBeNull();
  });
  it('keeps a real zero as reported data', () => {
    const zero = row({ category: 'American Indian or Alaska Native', title: 'Race (NIH/OMB)', param_value_num: '0', number_analyzed: '40' });
    const { demographics } = buildDemographics([zero], new Map(), new Map([['g', 40]]), 'src');
    expect(demographics.race.status).toBe('reported');
    expect(demographics.race.measures[0].value).toBe(0);
  });
  it('marks unmatched fields not-reported, with every field resolved', () => {
    const { demographics } = buildDemographics([row({ param_value_num: '5', number_analyzed: '5' })], new Map(), new Map(), 'src');
    expect(demographics.sex.status).toBe('reported');
    for (const key of ['age', 'gender', 'race', 'ethnicity'] as const) {
      expect(demographics[key]).toEqual({ status: 'not-reported', measures: [], sourceIds: ['src'], notes: [] });
    }
  });
});

describe('end-to-end build from fixture tables', () => {
  it('counts every exclusion reason and keeps only eligible studies', async () => {
    const { dataset, report } = await build();
    expect(dataset.studies.map((s) => s.nctId)).toEqual(['NCT00000001', 'NCT00000007']);
    expect(report.funnel).toEqual({
      considered: 12,
      included: 2,
      excluded: {
        'invalid-nct-id': 1,
        'duplicate-nct-id': 2,
        'not-completed': 1,
        'not-interventional': 1,
        'no-posted-results': 1,
        'no-type-2-diabetes-condition': 1,
        'type-2-diabetes-only-in-at-risk-or-healthy-condition': 1,
        'no-us-facility': 1,
        'missing-required-field': 1,
      },
    });
    expect(report.usListedOnlyAsRemovedCountry).toBe(1);
    expect(dataset.snapshotDate).toBe('2026-11-17');
    expect(dataset.limitedSample).toBe(false);
  });

  it('preserves study fields, partial dates, order and missing values', async () => {
    const { dataset } = await build();
    const [full, sparse] = dataset.studies;
    expect(full.summary).toBe('Line one | with a pipe~Line two "quoted"\ncontinued on a new line');
    expect(full.interventions).toEqual(['Metformin', 'Placebo']);
    expect(full.conditions).toEqual(['Diabetes Mellitus, Type 2', 'Obesity']);
    expect(full.usLocation).toMatchObject({ facility: 'Example Clinic', city: 'San Diego', state: 'California' });
    expect(full.completionDate).toEqual({ value: '2015-06', precision: 'month' });
    expect(full.sourceIds).toEqual(['ctgov-nct00000001', 'aact-snapshot-2026-11-17']);
    expect(sparse.enrollment).toBeNull();
    expect(sparse.enrollmentType).toBeNull();
    expect(sparse.completionDate).toBeNull();
    expect(sparse.usLocation).toMatchObject({ facility: null, city: 'Houston' });
  });

  it('keeps arm and total rows separate and replaces unconfirmed denominators', async () => {
    const { dataset } = await build();
    const sex = dataset.studies[0].demographics.sex;
    expect(sex.measures.map((m) => [m.population, m.categoryLabel, m.value, m.denominator])).toEqual([
      ['Metformin (BG000)', 'Female', 25, 60], ['Metformin (BG000)', 'Male', 35, 60],
      ['Placebo (BG001)', 'Female', 30, 60], ['Placebo (BG001)', 'Male', 30, 60],
      ['Total (BG002)', 'Female', 55, 120], ['Total (BG002)', 'Male', 65, 120],
    ]);
    // The table shows the confirmed denominator; AACT's own number is not repeated in a note.
    expect(sex.notes).toEqual([]);
    expect(dataset.studies[0].demographics.race.measures).toHaveLength(2);
  });

  it('keeps repeated postings of one measure separate instead of merging them', async () => {
    const { dataset } = await build();
    const age = dataset.studies[0].demographics.age.measures;
    expect(age.map((m) => [m.measureInstance, m.measureDescription, m.population, m.value, m.denominator])).toEqual([
      [1, 'Randomised population.', 'Metformin (BG000)', 58.2, 60],
      [1, 'Randomised population.', 'Placebo (BG001)', 59.1, null],
      [1, 'Randomised population.', 'Total (BG002)', 58.6, 120],
      [2, 'Non-randomised population.', 'Metformin (BG000)', 61.9, 60],
      [2, 'Non-randomised population.', 'Placebo (BG001)', null, null],
      [2, 'Non-randomised population.', 'Total (BG002)', 61.9, 120],
    ]);
    // Every posting/category/group cell is distinct, so no value can hide another.
    const cells = age.map((m) => `${m.measureInstance}|${m.categoryLabel}|${m.population}`);
    expect(new Set(cells).size).toBe(cells.length);
    expect(dataset.studies[0].demographics.age.notes.join(' ')).toContain(
      'Some values in "Age, Continuous" (table 2 of 2) were posted as not available. The study\'s explanation: Values are in the other posting.',
    );
  });

  it('does not count a zero from a group with zero participants analyzed as reporting', async () => {
    const { dataset } = await build();
    const ethnicity = dataset.studies[0].demographics.ethnicity;
    expect(ethnicity.status).toBe('not-reported');
    expect(ethnicity.measures).toEqual([]);
    expect(ethnicity.notes[0]).toBe('Posted "Ethnicity (NIH/OMB)" without any values from participants analyzed, so treated as not reported.');
  });

  it('flags labeled gender, not-collected race/ethnicity, missing values and count mismatches', async () => {
    const { dataset, report } = await build();
    const d = dataset.studies[1].demographics;
    expect(d.gender.status).toBe('reported');
    expect(d.sex.status).toBe('not-reported');
    expect(d.sex.notes).toContain('No measure labeled sex; see the measure labeled "Gender" under Gender.');
    expect(d.gender.notes.join(' ')).toMatch(/add up to 7, not 8/);
    expect(d.race.status).toBe('not-reported');
    expect(d.race.notes).toContain('The study states that race and ethnicity were not collected.');
    expect(report.needsReview).toEqual({ NCT00000007: ['Hair loss score'] });
  });

  it('treats a measure posted with only missing values as not reported, keeping the explanation', async () => {
    const { dataset } = await build();
    const d = dataset.studies[1].demographics;
    // "Age, Continuous" was posted with only NA; "Sex/Gender, Customized" likewise.
    expect(d.age).toMatchObject({ status: 'not-reported', measures: [] });
    expect(d.age.notes).toContain("The study's explanation: Not collected for this group.");
    expect(d.sex).toMatchObject({ status: 'not-reported', measures: [] });
    expect(d.sex.notes).toContain("The study's explanation: Sex was not collected for this study.");
    // A posted zero from analyzed participants is still data.
    expect(d.gender.measures.map((m) => m.value)).toEqual([3, 4]);
  });

  it('produces identical output from identical input', async () => {
    const first = await build();
    const second = await build();
    expect(JSON.stringify(second.dataset)).toBe(JSON.stringify(first.dataset));
    expect(JSON.stringify(second.registry)).toBe(JSON.stringify(first.registry));
  });
});
