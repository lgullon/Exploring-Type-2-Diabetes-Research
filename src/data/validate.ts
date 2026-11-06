import { demographicKeys, type SourceRegistry, type TrialDataset } from './types';

type Obj = Record<string, unknown>;
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid research data: ${message}`);
}
function object(value: unknown, path: string): Obj {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${path} must be an object`);
  return value as Obj;
}
function text(value: unknown, path: string): asserts value is string {
  requireValue(typeof value === 'string' && value.trim().length > 0, `${path} must be nonempty text`);
}
function nullableText(value: unknown, path: string) {
  if (value !== null) text(value, path);
}
function strings(value: unknown, path: string, nonempty = false): asserts value is string[] {
  requireValue(Array.isArray(value) && (!nonempty || value.length > 0), `${path} must be a list${nonempty ? ' with evidence' : ''}`);
  value.forEach((item) => text(item, path));
}
function date(value: unknown, path: string, precision?: unknown) {
  text(value, path);
  const pattern = precision === 'year' ? /^\d{4}$/ : precision === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  requireValue(pattern.test(value), `${path} has invalid date precision`);
  const full = value.length === 4 ? `${value}-01-01` : value.length === 7 ? `${value}-01` : value;
  const parsed = new Date(`${full}T00:00:00Z`);
  requireValue(!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === full, `${path} is not a calendar date`);
}
function url(value: unknown, path: string) {
  text(value, path);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`Invalid research data: ${path} is not a URL`); }
  requireValue(parsed.protocol === 'https:', `${path} must use HTTPS`);
}
function count(value: unknown, path: string) {
  requireValue(value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0), `${path} must be a nonnegative integer or null`);
}

export function validateSources(input: unknown): SourceRegistry {
  const root = object(input, 'sources');
  requireValue(root.schemaVersion === '1.0', 'unsupported source schemaVersion');
  requireValue(Array.isArray(root.sources), 'sources must be a list');
  const ids = new Set<string>();
  root.sources.forEach((value, i) => {
    const s = object(value, `sources[${i}]`);
    for (const key of ['id', 'author', 'title']) text(s[key], `source.${key}`);
    requireValue(!ids.has(s.id as string), 'source IDs must be unique');
    ids.add(s.id as string);
    url(s.url, 'source.url');
    date(s.accessedDate, 'source.accessedDate');
    if (s.publicationDate !== null) {
      text(s.publicationDate, 'source.publicationDate');
      date(s.publicationDate, 'source.publicationDate', s.publicationDate.length === 4 ? 'year' : s.publicationDate.length === 7 ? 'month' : 'day');
    }
    strings(s.supports, 'source.supports', true);
  });
  return input as SourceRegistry;
}

export function validateDataset(input: unknown, registry: SourceRegistry): TrialDataset {
  validateSources(registry);
  const known = new Set(registry.sources.map((s) => s.id));
  function references(value: unknown, path: string, required = true) {
    strings(value, path, required);
    requireValue(value.every((id) => known.has(id)), `${path} references an unknown citation`);
  }
  const root = object(input, 'dataset');
  requireValue(root.schemaVersion === '1.0', 'unsupported dataset schemaVersion');
  date(root.snapshotDate, 'snapshotDate');
  requireValue(typeof root.limitedSample === 'boolean', 'limitedSample must be explicit');
  const cohort = object(root.cohort, 'cohort');
  text(cohort.description, 'cohort.description');
  text(cohort.selectionMethod, 'cohort.selectionMethod');
  strings(cohort.inclusionRules, 'cohort.inclusionRules', true);
  references(cohort.sourceIds, 'cohort.sourceIds');
  requireValue(Array.isArray(root.studies), 'studies must be a list');
  const ids = new Set<string>();
  root.studies.forEach((value, i) => {
    const s = object(value, `studies[${i}]`);
    text(s.nctId, 'nctId');
    requireValue(/^NCT\d{8}$/.test(s.nctId) && !ids.has(s.nctId), 'NCT IDs must be valid and unique');
    ids.add(s.nctId);
    text(s.title, 'study.title'); text(s.summary, 'study.summary');
    strings(s.conditions, 'study.conditions', true); strings(s.interventions, 'study.interventions', true);
    requireValue(s.status === 'COMPLETED' && s.studyType === 'INTERVENTIONAL' && s.hasResults === true, `${s.nctId} is outside the completed interventional results cohort`);
    url(s.sourceUrl, 'study.sourceUrl');
    requireValue(s.sourceUrl === `https://clinicaltrials.gov/study/${s.nctId}`, 'sourceUrl must identify the original NCT record');
    references(s.sourceIds, 'study.sourceIds');
    requireValue(registry.sources.some((source) => source.url === s.sourceUrl && (s.sourceIds as string[]).includes(source.id)), 'study citations must include its original record');
    const location = object(s.usLocation, 'usLocation');
    requireValue(location.country === 'United States', 'a U.S. location is required');
    for (const key of ['facility', 'city', 'state']) nullableText(location[key], `usLocation.${key}`);
    requireValue(location.facility !== null || location.city !== null || location.state !== null, 'U.S. site evidence must identify a location');
    references(location.sourceIds, 'usLocation.sourceIds');
    if (s.completionDate !== null) {
      const d = object(s.completionDate, 'completionDate');
      requireValue(['year', 'month', 'day'].includes(d.precision as string), 'completionDate needs precision');
      date(d.value, 'completionDate.value', d.precision);
    }
    count(s.enrollment, 'enrollment'); nullableText(s.enrollmentType, 'enrollmentType');
    const demographics = object(s.demographics, 'demographics');
    demographicKeys.forEach((key) => {
      const d = object(demographics[key], `demographics.${key}`);
      requireValue(['reported', 'not-reported', 'not-extracted'].includes(d.status as string), `${key} requires a missingness status`);
      requireValue(Array.isArray(d.measures), `${key}.measures must be a list`);
      references(d.sourceIds, `${key}.sourceIds`, d.status !== 'not-extracted');
      requireValue(d.status === 'reported' ? d.measures.length > 0 : d.measures.length === 0, `${key} status conflicts with measures`);
      d.measures.forEach((measure) => {
        const m = object(measure, `${key}.measure`);
        text(m.measureLabel, 'measureLabel'); text(m.population, 'population');
        for (const field of ['categoryLabel', 'unit', 'statisticType']) nullableText(m[field], field);
        requireValue(m.value === null || (typeof m.value === 'number' && Number.isFinite(m.value)) || (typeof m.value === 'string' && m.value.trim().length > 0), 'measure value must preserve a number, text or null');
        count(m.denominator, 'denominator'); references(m.sourceIds, 'measure.sourceIds');
      });
    });
  });
  return input as TrialDataset;
}
