import { describe, expect, it } from 'vitest';
import rawDataset from '../../public/data/trials.json';
import rawSources from '../../public/data/sources.json';
import { validateDataset, validateSources } from './validate';

const registry = validateSources(rawSources);
const sample = () => structuredClone(rawDataset);

describe('checked-in source-backed sample', () => {
  it('validates seven uniquely identified, eligible original records and all references', () => {
    const dataset = validateDataset(rawDataset, registry);
    expect(dataset.studies).toHaveLength(7);
    expect(dataset.limitedSample).toBe(true);
    expect(dataset.snapshotDate).toBe('2026-11-06');
  });
  it('rejects duplicate or malformed NCT identifiers', () => {
    const duplicate = sample(); duplicate.studies.push(duplicate.studies[0]);
    expect(() => validateDataset(duplicate, registry)).toThrow(/unique/);
    const bad = sample(); bad.studies[0].nctId = 'NCT123';
    expect(() => validateDataset(bad, registry)).toThrow(/valid/);
  });
  it('requires source identity, registry metadata and U.S. inclusion evidence', () => {
    const missing = sample(); missing.studies[0].sourceIds = [];
    expect(() => validateDataset(missing, registry)).toThrow(/evidence/);
    const unknown = sample(); unknown.studies[0].usLocation.sourceIds = ['unknown'];
    expect(() => validateDataset(unknown, registry)).toThrow(/unknown citation/);
    const wrongUrl = sample(); wrongUrl.studies[0].sourceUrl = 'https://clinicaltrials.gov/study/NCT00000000';
    expect(() => validateDataset(wrongUrl, registry)).toThrow(/original NCT/);
    const sources = structuredClone(rawSources); sources.sources[0].author = '';
    expect(() => validateSources(sources)).toThrow(/author/);
  });
  it('rejects studies without completed interventional posted-results status', () => {
    const invalid = sample(); invalid.studies[0].hasResults = false;
    expect(() => validateDataset(invalid, registry)).toThrow(/cohort/);
  });
  it('allows an empty snapshot for the UI empty state', () => {
    const empty = sample(); empty.studies = [];
    expect(validateDataset(empty, registry).studies).toEqual([]);
  });
});

describe('missingness and demographic boundaries (synthetic test mutations only)', () => {
  it('keeps null enrollment distinct from zero', () => {
    const missing = sample() as unknown as Record<string, unknown>;
    const studies = missing.studies as Array<Record<string, unknown>>;
    studies[0].enrollment = null; studies[1].enrollment = 0;
    const parsed = validateDataset(missing, registry);
    expect(parsed.studies[0].enrollment).toBeNull();
    expect(parsed.studies[1].enrollment).toBe(0);
    studies[0].enrollment = -1;
    expect(() => validateDataset(missing, registry)).toThrow(/enrollment/);
  });
  it('does not treat unextracted fields as absent reporting', () => {
    const dataset = validateDataset(sample(), registry);
    expect(dataset.studies[0].demographics.sex.status).toBe('not-extracted');
    expect(dataset.studies[0].demographics.gender.status).toBe('not-extracted');
    dataset.studies[0].demographics.age.status = 'not-reported';
    expect(() => validateDataset(dataset, registry)).toThrow(/evidence/);
    dataset.studies[0].demographics.age.sourceIds = dataset.studies[0].sourceIds;
    expect(validateDataset(dataset, registry).studies[0].demographics.age.status).toBe('not-reported');
  });
  it('requires measures for reported fields and rejects measures on unextracted fields', () => {
    const dataset = validateDataset(sample(), registry);
    const age = dataset.studies[0].demographics.age;
    age.status = 'reported'; age.sourceIds = dataset.studies[0].sourceIds;
    expect(() => validateDataset(dataset, registry)).toThrow(/conflicts/);
    age.measures = [{ measureLabel: 'Synthetic age', categoryLabel: null, value: 0,
      unit: 'years', statisticType: 'Mean', population: 'Synthetic arm', denominator: null,
      sourceIds: dataset.studies[0].sourceIds }];
    expect(validateDataset(dataset, registry).studies[0].demographics.age.measures[0].value).toBe(0);
    age.status = 'not-extracted';
    expect(() => validateDataset(dataset, registry)).toThrow(/conflicts/);
  });
  it('preserves year, month, day precision and null; rejects invented precision and invalid dates', () => {
    const dataset = validateDataset(sample(), registry);
    for (const completionDate of [null, {value:'2015',precision:'year' as const},
      {value:'2015-12',precision:'month' as const}, {value:'2015-12-17',precision:'day' as const}]) {
      dataset.studies[0].completionDate = completionDate;
      expect(validateDataset(dataset, registry).studies[0].completionDate).toEqual(completionDate);
    }
    dataset.studies[0].completionDate = {value:'2015-12',precision:'day'};
    expect(() => validateDataset(dataset, registry)).toThrow(/precision/);
    dataset.studies[0].completionDate = {value:'2015-02-30',precision:'day'};
    expect(() => validateDataset(dataset, registry)).toThrow(/calendar/);
  });
});
