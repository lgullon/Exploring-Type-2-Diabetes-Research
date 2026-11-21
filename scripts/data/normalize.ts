// Normalization from AACT rows into the shared Trial contract (src/data/types.ts).
import { demographicKeys, type DemographicField, type DemographicMeasure, type Demographics, type PartialDate } from '../../src/data/types.ts';

type Domain = (typeof demographicKeys)[number];

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Demographic measure titles
//
// Baseline measures are matched by their exact registry title (case and
// spacing ignored). Every title below was reviewed against the 2026-11-17 AACT
// snapshot. Titles are placed in the field their own label names; nothing is
// reclassified (for example, a measure titled "Gender" stays under gender).
// ---------------------------------------------------------------------------

type TitleRule = { domain: Domain; note?: string };

const COMBINED_SEX_GENDER =
  'Reported under the registry measure "Sex/Gender, Customized", so its categories may describe sex, gender or both. They are kept as reported.';
const LABELED_GENDER =
  'The study labeled this measure "Gender". It is kept under gender as labeled and is not reclassified as sex.';
const COMBINED_RACE_ETHNICITY =
  'Reported as one combined race/ethnicity measure. Its categories may mix race and ethnicity and are kept as reported, not split.';

const TITLE_RULES: Record<string, TitleRule> = {
  'age, continuous': { domain: 'age' },
  'age continuous': { domain: 'age' },
  'age, categorical': { domain: 'age' },
  'age, customized': { domain: 'age' },
  'age range': { domain: 'age' },
  'age group': { domain: 'age' },
  'age at screening': { domain: 'age' },
  'female age': { domain: 'age' },
  'age characterization female only': { domain: 'age' },
  'age categorization, female only': { domain: 'age' },
  'age categorization females only': { domain: 'age' },
  'sex: female, male': { domain: 'sex' },
  'parent-reported sex of their child: female': { domain: 'sex' },
  'sex/gender, customized': { domain: 'sex', note: COMBINED_SEX_GENDER },
  gender: { domain: 'gender', note: LABELED_GENDER },
  'race (nih/omb)': { domain: 'race' },
  race: { domain: 'race' },
  'race/ethnicity, customized': { domain: 'race', note: COMBINED_RACE_ETHNICITY },
  'race/ethnicity': { domain: 'race', note: COMBINED_RACE_ETHNICITY },
  'race-ethnicity': { domain: 'race', note: COMBINED_RACE_ETHNICITY },
  'ethnicity (nih/omb)': { domain: 'ethnicity' },
  ethnicity: { domain: 'ethnicity' },
};

/** The registry's explicit statement that race and ethnicity were not collected. */
const NOT_COLLECTED_TITLE = 'race and ethnicity not collected';

/** Words that suggest a demographic measure. Used only to force human review. */
const DEMOGRAPHIC_HINT =
  /\b(age|ages|aged|sex|gender|male|males|female|females|women|men|race|racial|ethnic|ethnicity|hispanic|latino|latina|latinx|white|black|asian|caucasian|african)\b/i;

/**
 * Titles that contain a demographic word but were reviewed and are not
 * participant age, sex, gender, race or ethnicity (e.g. disease duration,
 * gestational age, comorbidity scores, language, region).
 */
export const REVIEWED_NOT_DEMOGRAPHIC = new Set<string>([
  'age-adjusted charlson comorbidity score',
  'age at onset of diabetes',
  'gestational age diagnosed',
  'gestational age at entry to dipp',
  'gestational age insulin started',
  // Flagged because a category or classification contains a demographic word:
  'body mass index (bmi)', // BMI reported separately for men and women
  'cardiovascular risk groups', // risk groups defined partly by an age threshold
  'baseline cardiovasular disease (cvd)/chronic kidney disease (ckd) risk details', // same; spelling as registered
  'child-bearing status', // includes "Not Applicable (Male)"; not a sex measure
  'household receipt of benefits in past year', // program name "...for Women, Infants and Children"
]);

export type TitleClass =
  | { kind: 'demographic'; rule: TitleRule }
  | { kind: 'not-collected' }
  | { kind: 'other' }
  | { kind: 'needs-review' };

export function classifyMeasure(title: string, classification = '', category = ''): TitleClass {
  const key = normalizeTitle(title);
  const rule = TITLE_RULES[key];
  if (rule) return { kind: 'demographic', rule };
  if (key === NOT_COLLECTED_TITLE) return { kind: 'not-collected' };
  if (REVIEWED_NOT_DEMOGRAPHIC.has(key)) return { kind: 'other' };
  if (DEMOGRAPHIC_HINT.test(title) || DEMOGRAPHIC_HINT.test(classification) || DEMOGRAPHIC_HINT.test(category)) {
    return { kind: 'needs-review' };
  }
  return { kind: 'other' };
}

// ---------------------------------------------------------------------------
// Scalar fields
// ---------------------------------------------------------------------------

function isCalendarDate(value: string): boolean {
  const full = value.length === 4 ? `${value}-01-01` : value.length === 7 ? `${value}-01` : value;
  const parsed = new Date(`${full}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === full;
}

/**
 * Completion date with the precision the registry supplied. AACT's
 * `completion_date` column fills a day in for month-only dates, so the
 * `completion_month_year` column is used instead.
 */
export function parseCompletionDate(monthYear: string): PartialDate | null {
  const value = monthYear.trim();
  if (!value) return null;
  const precision = /^\d{4}$/.test(value) ? 'year' : /^\d{4}-\d{2}$/.test(value) ? 'month' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'day' : null;
  if (!precision || !isCalendarDate(value)) return null;
  return { value, precision };
}

/** A nonnegative whole number, or null when missing or not a valid count. Missing is never zero. */
export function parseCount(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Demographics
// ---------------------------------------------------------------------------

export type BaselineRow = {
  id: string;
  result_group_id: string;
  ctgov_group_code: string;
  classification: string;
  category: string;
  title: string;
  /** The study's description of the measure; distinguishes repeated postings of one title. */
  description?: string;
  units: string;
  param_type: string;
  param_value: string;
  param_value_num: string;
  explanation_of_na: string;
  number_analyzed: string;
  number_analyzed_units: string;
};

export type ResultGroup = { title: string; code: string };

export type DemographicsResult = { demographics: Demographics; needsReview: string[] };

function measureValue(row: BaselineRow): number | string | null {
  const num = row.param_value_num.trim();
  if (num !== '' && Number.isFinite(Number(num))) return Number(num);
  const text = row.param_value.trim();
  return text === '' || text.toUpperCase() === 'NA' ? null : text;
}

function categoryLabel(row: BaselineRow): string | null {
  const parts = [row.classification.trim(), row.category.trim()].filter(Boolean);
  return parts.length ? parts.join(' / ') : null;
}

function populationLabel(row: BaselineRow, groups: Map<string, ResultGroup>): string {
  const group = groups.get(row.result_group_id);
  const code = row.ctgov_group_code.trim() || 'unknown group';
  return group?.title.trim() ? `${group.title.trim()} (${code})` : code;
}

const PARTICIPANT_UNITS = /^participants?$/i;

/**
 * Total of a single-dimension participant-count measure in one group, or null
 * when the rows are not simple counts (continuous values, nested
 * classifications or missing values), where a total would be meaningless.
 */
export function categorySum(groupRows: BaselineRow[]): number | null {
  // Participant counts: the standard type, or the older "NUMBER" type when its unit is participants.
  const isCount = (r: BaselineRow) =>
    r.param_type === 'COUNT_OF_PARTICIPANTS' || (r.param_type === 'NUMBER' && PARTICIPANT_UNITS.test(r.units.trim()));
  if (!groupRows.every(isCount)) return null;
  // One level of categories, whichever AACT column holds the label; two-level tables are not summed.
  const oneLevel = groupRows.every((r) => !r.classification.trim()) || groupRows.every((r) => !r.category.trim());
  if (!oneLevel) return null;
  const values = groupRows.map(measureValue);
  if (values.some((v) => typeof v !== 'number')) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/**
 * The denominator for one measure in one result group, or null if it cannot be
 * confirmed. In the 2026-11-17 snapshot AACT's `number_analyzed` disagreed with
 * both the group's baseline count and the category total for most measures,
 * while ClinicalTrials.gov listed no separate per-measure count. So the
 * reported value is used only when it agrees with the group's baseline count
 * or with the category total; otherwise the group's baseline count is used when
 * the categories add up to it.
 */
export function confirmedDenominator(groupRows: BaselineRow[], groupCount: number | undefined): number | null {
  const analyzed = new Set(groupRows.map((r) => parseCount(r.number_analyzed)));
  const reported = analyzed.size === 1 ? [...analyzed][0] : null;
  const sum = categorySum(groupRows);
  // A denominator can never exceed the group's own baseline count (that would mean participants counted twice).
  const withinGroup = (n: number) => groupCount === undefined || n <= groupCount;
  if (reported !== null && (reported === groupCount || (reported === sum && withinGroup(reported)))) return reported;
  if (groupCount !== undefined && sum === groupCount) return groupCount;
  return null;
}


/**
 * Split a study's demographic rows into posted measures. A study can post the
 * same title more than once (for example one "Age, Continuous" for a
 * randomised population and another for a non-randomised one). Rows belong to
 * a new posting when the description, unit or statistic changes, or when a
 * category/group cell repeats. Postings of a title are numbered from 1.
 */
export function assignMeasureInstances(ordered: BaselineRow[]): Map<BaselineRow, number> {
  const instance = new Map<BaselineRow, number>();
  const current = new Map<string, { n: number; signature: string; cells: Set<string> }>();
  for (const row of ordered) {
    const title = row.title.trim();
    const signature = [(row.description ?? '').trim(), row.units.trim(), row.param_type.trim()].join('\u0000');
    const cell = [row.classification.trim(), row.category.trim(), row.result_group_id].join('\u0000');
    let posting = current.get(title);
    if (!posting || posting.signature !== signature || posting.cells.has(cell)) {
      posting = { n: (posting?.n ?? 0) + 1, signature, cells: new Set() };
      current.set(title, posting);
    }
    posting.cells.add(cell);
    instance.set(row, posting.n);
  }
  return instance;
}

/**
 * Build the five demographic fields for one study from all of its baseline
 * measurement rows. Every study passed here has posted results, so a field is
 * "reported" only when a matching measure has at least one posted value from a
 * group with participants analyzed; otherwise it is "not-reported" (verified by
 * inspecting all of the study's baseline titles), never "not-extracted".
 */
export function buildDemographics(
  rows: BaselineRow[],
  groups: Map<string, ResultGroup>,
  groupCounts: Map<string, number>,
  sourceId: string,
): DemographicsResult {
  const ordered = [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  const measures = Object.fromEntries(demographicKeys.map((k) => [k, [] as DemographicMeasure[]])) as Record<Domain, DemographicMeasure[]>;
  const notes = Object.fromEntries(demographicKeys.map((k) => [k, new Set<string>()])) as Record<Domain, Set<string>>;
  const explanations = Object.fromEntries(demographicKeys.map((k) => [k, new Set<string>()])) as Record<Domain, Set<string>>;
  const hasValue = Object.fromEntries(demographicKeys.map((k) => [k, false])) as Record<Domain, boolean>;
  const needsReview = new Set<string>();
  let notCollected = false;

  const demographicRows = ordered.filter((row) => classifyMeasure(row.title, row.classification, row.category).kind === 'demographic');
  const instances = assignMeasureInstances(demographicRows);
  const postings = new Map<string, number>();
  for (const row of demographicRows) postings.set(row.title.trim(), Math.max(postings.get(row.title.trim()) ?? 0, instances.get(row)!));

  // Rows of each posted measure, per result group.
  const byMeasureGroup = new Map<string, BaselineRow[]>();
  const measureGroupKey = (row: BaselineRow) => `${row.title.trim()}\u0000${instances.get(row)}\u0000${row.result_group_id}`;
  for (const row of demographicRows) {
    const list = byMeasureGroup.get(measureGroupKey(row));
    if (list) list.push(row); else byMeasureGroup.set(measureGroupKey(row), [row]);
  }
  const denominators = new Map<string, number | null>();
  for (const [key, groupRows] of byMeasureGroup) {
    denominators.set(key, confirmedDenominator(groupRows, groupCounts.get(groupRows[0].result_group_id)));
  }

  for (const row of ordered) {
    const cls = classifyMeasure(row.title, row.classification, row.category);
    if (cls.kind === 'needs-review') needsReview.add(row.title.trim());
    if (cls.kind === 'not-collected') notCollected = true;
    if (cls.kind !== 'demographic') continue;
    const { domain, note } = cls.rule;
    if (note) notes[domain].add(note);
    const title = row.title.trim();
    const instance = instances.get(row)!;
    const named = postings.get(title)! > 1 ? `"${title}" (posting ${instance})` : `"${title}"`;
    const population = populationLabel(row, groups);
    const value = measureValue(row);
    const denominator = denominators.get(measureGroupKey(row)) ?? null;
    const reportedAnalyzed = parseCount(row.number_analyzed);
    if (value === null) {
      const why = row.explanation_of_na.trim();
      if (why) explanations[domain].add(why);
      notes[domain].add(`${population}: a value for ${named} is not available${why ? ` (${why})` : ''}.`);
    }
    // Zero is a posted value; a value from a group with zero participants analyzed is not.
    if (value !== null && denominator !== 0 && reportedAnalyzed !== 0) hasValue[domain] = true;
    if (denominator === null && reportedAnalyzed !== null) {
      notes[domain].add(`AACT's "number analyzed" for ${named} could not be confirmed against the posted group counts, so those denominators are left unknown.`);
    } else if (denominator !== null && reportedAnalyzed !== null && reportedAnalyzed !== denominator) {
      notes[domain].add(`AACT's "number analyzed" for ${named} did not match the posted group counts, so each group's baseline participant count, which the categories add up to, is used as the denominator.`);
    }
    const analyzedUnits = row.number_analyzed_units.trim();
    if (denominator !== null && analyzedUnits && !PARTICIPANT_UNITS.test(analyzedUnits)) {
      notes[domain].add(`${named} was analyzed in units of "${analyzedUnits}", not participants.`);
    }
    measures[domain].push({
      measureLabel: title,
      measureDescription: (row.description ?? '').trim() || null,
      measureInstance: instance,
      categoryLabel: categoryLabel(row),
      value,
      unit: row.units.trim() || null,
      statisticType: row.param_type.trim() || null,
      population,
      denominator,
      sourceIds: [sourceId],
    });
  }

  // Count measures whose categories do not add up to the confirmed denominator are flagged, never fixed.
  for (const [key, groupRows] of byMeasureGroup) {
    const sum = categorySum(groupRows);
    const denominator = denominators.get(key) ?? null;
    const cls = classifyMeasure(groupRows[0].title);
    if (sum === null || cls.kind !== 'demographic') continue;
    const title = groupRows[0].title.trim();
    const groupCount = groupCounts.get(groupRows[0].result_group_id);
    // AACT cannot show whether such a table is one measure counting people more
    // than once (e.g. race then ethnicity) or several measures posted under one
    // title, so the table is kept together and the reason is stated.
    const multiple = denominator === null && groupCount ? sum / groupCount : 0;
    if (Number.isInteger(multiple) && multiple >= 2) {
      notes[cls.rule.domain].add(`Categories of "${title}" add up to ${multiple} times each group's size: participants may be counted in more than one category (for example once for race and once for ethnicity), or the study posted ${multiple} measures under this title. Do not add the categories together.`);
      continue;
    }
    if (denominator === null || sum === denominator) continue;
    notes[cls.rule.domain].add(`${populationLabel(groupRows[0], groups)}: categories of "${title}" add up to ${sum}, not ${denominator}.`);
  }

  // A field whose measures carry no usable values is not reported. The empty
  // rows are dropped and replaced by a note that keeps the study's own explanation.
  for (const k of demographicKeys) {
    if (measures[k].length === 0 || hasValue[k]) continue;
    const titles = [...new Set(measures[k].map((m) => `"${m.measureLabel}"`))].join(', ');
    const why = [...explanations[k]];
    measures[k] = [];
    notes[k] = new Set([
      `The study posted ${titles} but with no values from participants analyzed, so this field is treated as not reported.`,
      ...why.map((w) => `The study's explanation: ${w}`),
    ]);
  }

  if (notCollected) {
    notes.race.add('The study reported that race and ethnicity were not collected.');
    notes.ethnicity.add('The study reported that race and ethnicity were not collected.');
  }
  if (measures.ethnicity.length === 0 && measures.race.some((m) => TITLE_RULES[normalizeTitle(m.measureLabel)]?.note === COMBINED_RACE_ETHNICITY)) {
    notes.ethnicity.add('No separate ethnicity measure was reported. See the combined race/ethnicity measure under race.');
  }
  if (measures.sex.length === 0 && measures.gender.length > 0) {
    notes.sex.add('No measure labeled as sex was reported. See the measure labeled "Gender" under gender.');
  }

  const demographics = Object.fromEntries(
    demographicKeys.map((k): [Domain, DemographicField] => [k, {
      status: measures[k].length > 0 ? 'reported' : 'not-reported',
      measures: measures[k],
      sourceIds: [sourceId],
      notes: [...notes[k]],
    }]),
  ) as Demographics;
  return { demographics, needsReview: [...needsReview].sort() };
}
