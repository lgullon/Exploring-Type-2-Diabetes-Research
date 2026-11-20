// Cohort rules: completed interventional type 2 diabetes studies with posted
// results and at least one listed United States facility.

/** Spellings researchers use for type 2 diabetes in the registry condition list. */
const TYPE_2_NUMBER = /type[\s-]*(?:2|ii|two)(?![0-9i])/i;
const DIABETES_WORD = /diabet|dm\b/i;
const TYPE_2_ABBREVIATION = /\bt2dm?\b|\bniddm\b/i;
const LEGACY_NAME = /non[\s-]*insulin[\s-]*dependent|adult[\s-]*onset/i;
/** Conditions that name type 2 diabetes but describe people who do not have it. */
const NOT_DIAGNOSED = /\bat[\s-]+risk\b|\brisk of\b|\bprevent|\bhealthy\b/i;

export type ConditionMatch = 'type-2-diabetes' | 'qualified-only' | 'no-match';

/**
 * Classify one condition string as written by the study's investigators.
 * "qualified-only" means it names type 2 diabetes but describes an at-risk,
 * prevention or healthy-volunteer population, which does not count on its own.
 */
export function classifyCondition(condition: string): ConditionMatch {
  const names =
    (TYPE_2_NUMBER.test(condition) && DIABETES_WORD.test(condition)) ||
    TYPE_2_ABBREVIATION.test(condition) ||
    (LEGACY_NAME.test(condition) && /diabet/i.test(condition));
  if (!names) return 'no-match';
  return NOT_DIAGNOSED.test(condition) ? 'qualified-only' : 'type-2-diabetes';
}

export const NCT_ID = /^NCT\d{8}$/;

export type StudyRow = {
  nct_id: string;
  overall_status: string;
  study_type: string;
  results_first_posted_date: string;
};

/** Exclusion reasons, in the order the rules are applied. */
export const exclusionReasons = [
  'invalid-nct-id',
  'duplicate-nct-id',
  'not-completed',
  'not-interventional',
  'no-posted-results',
  'no-type-2-diabetes-condition',
  'type-2-diabetes-only-in-at-risk-or-healthy-condition',
  'no-us-facility',
  'missing-required-field',
] as const;
export type ExclusionReason = (typeof exclusionReasons)[number];

/** Registry-level rules that only need the studies table. */
export function registryExclusion(study: StudyRow): ExclusionReason | null {
  if (!NCT_ID.test(study.nct_id)) return 'invalid-nct-id';
  if (study.overall_status !== 'COMPLETED') return 'not-completed';
  if (study.study_type !== 'INTERVENTIONAL') return 'not-interventional';
  if (!study.results_first_posted_date.trim()) return 'no-posted-results';
  return null;
}

/** Condition rule: at least one listed condition names type 2 diabetes for a diagnosed population. */
export function conditionExclusion(conditions: string[]): ExclusionReason | null {
  const matches = conditions.map(classifyCondition);
  if (matches.includes('type-2-diabetes')) return null;
  if (matches.includes('qualified-only')) return 'type-2-diabetes-only-in-at-risk-or-healthy-condition';
  return 'no-type-2-diabetes-condition';
}

export type Funnel = { considered: number; included: number; excluded: Record<ExclusionReason, number> };

export function emptyFunnel(): Funnel {
  return {
    considered: 0,
    included: 0,
    excluded: Object.fromEntries(exclusionReasons.map((r) => [r, 0])) as Record<ExclusionReason, number>,
  };
}
