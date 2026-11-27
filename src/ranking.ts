import type { Trial, TrialDataset } from './data/types'
import { normalizeTokens, searchStudies, studyWords } from './search'

/** User-selected importance values. Values are nonnegative and normalized at scoring time. */
export type RankingWeights = {
  relevance: number
  recency: number
  completeness: number
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  relevance: 0.6,
  recency: 0.2,
  completeness: 0.2,
}

export type RankingComponents = {
  relevance: number
  recency: number
  completeness: number | null
}

export type RankingResult = {
  study: Trial
  score: number
  components: RankingComponents
  normalizedWeights: RankingWeights
  contributions: RankingComponents
  baselineRank: number
  reasons: { relevance: string; recency: string; completeness: string }
}

const DAY_MS = 24 * 60 * 60 * 1000
const DAYS_PER_YEAR = 365.2425

function parseCalendarDate(value: string): number | null {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2] ?? '1')
  const day = Number(match[3] ?? '1')
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return timestamp
}

/** For scoring only, year-only/month-only dates are placed on the first day of that period. */
export function completionTimestamp(study: Trial): number | null {
  if (!study.completionDate) return null
  const { value, precision } = study.completionDate
  if (precision === 'year' && !/^\d{4}$/.test(value)) return null
  if (precision === 'month' && !/^\d{4}-\d{2}$/.test(value)) return null
  if (precision === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return parseCalendarDate(value)
}

function snapshotTimestamp(snapshotDate: string): number | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) ? parseCalendarDate(snapshotDate) : null
}

function sexOrGenderStatus(study: Trial): 'reported' | 'not-reported' | 'not-extracted' {
  const sex = study.demographics.sex.status
  const gender = study.demographics.gender.status
  if (sex === 'reported' || gender === 'reported') return 'reported'
  if (sex === 'not-extracted' || gender === 'not-extracted') return 'not-extracted'
  return 'not-reported'
}

/** Disable completeness for the entire dataset if any required domain remains unextracted. */
export function isCompletenessAvailable(studies: readonly Trial[]): boolean {
  return studies.every(study =>
    study.demographics.age.status !== 'not-extracted' &&
    sexOrGenderStatus(study) !== 'not-extracted' &&
    study.demographics.race.status !== 'not-extracted' &&
    study.demographics.ethnicity.status !== 'not-extracted',
  )
}

export function demographicCompleteness(study: Trial): number {
  return [study.demographics.age.status, sexOrGenderStatus(study), study.demographics.race.status,
    study.demographics.ethnicity.status].filter(status => status === 'reported').length / 4
}

function nonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function normalizeWeights(weights: RankingWeights, completenessEnabled: boolean): {
  weights: RankingWeights
  restoredDefaults: boolean
} {
  const raw = {
    relevance: nonnegative(weights.relevance),
    recency: nonnegative(weights.recency),
    completeness: completenessEnabled ? nonnegative(weights.completeness) : 0,
  }
  const total = raw.relevance + raw.recency + raw.completeness
  if (total === 0) {
    const fallbackTotal = DEFAULT_RANKING_WEIGHTS.relevance + DEFAULT_RANKING_WEIGHTS.recency +
      (completenessEnabled ? DEFAULT_RANKING_WEIGHTS.completeness : 0)
    return {
      weights: {
        relevance: DEFAULT_RANKING_WEIGHTS.relevance / fallbackTotal,
        recency: DEFAULT_RANKING_WEIGHTS.recency / fallbackTotal,
        completeness: completenessEnabled ? DEFAULT_RANKING_WEIGHTS.completeness / fallbackTotal : 0,
      },
      restoredDefaults: true,
    }
  }
  return {
    weights: {
      relevance: raw.relevance / total,
      recency: raw.recency / total,
      completeness: raw.completeness / total,
    },
    restoredDefaults: false,
  }
}

function relevanceScore(study: Trial, query: string): { score: number; reason: string } {
  const tokens = normalizeTokens(query)
  if (tokens.length === 0) {
    return { score: 0, reason: 'No search query: relevance is neutral (0), not a finding about this study.' }
  }
  const words = studyWords(study)
  const matched = tokens.filter(token => words.some(word => word.startsWith(token)))
  return {
    score: matched.length / tokens.length,
    reason: `${matched.length} of ${tokens.length} distinct search terms matched the title, summary, conditions, or interventions${matched.length ? ` (${matched.join(', ')})` : ''}.`,
  }
}

function recencyScore(study: Trial, snapshotDate: string): { score: number; reason: string } {
  const snapshot = snapshotTimestamp(snapshotDate)
  if (snapshot === null) return { score: 0, reason: 'The dataset snapshot date is invalid; recency contributes 0.' }
  const completed = completionTimestamp(study)
  if (completed === null) return { score: 0, reason: 'Completion date is missing or invalid; recency contributes 0.' }
  if (completed > snapshot) return { score: 0, reason: 'The completion date is after the dataset snapshot; it is treated as a future date and contributes 0.' }
  const ageInYears = (snapshot - completed) / DAY_MS / DAYS_PER_YEAR
  const score = Math.max(0, Math.min(1, 1 - ageInYears / 10))
  return {
    score,
    reason: `Completed ${study.completionDate?.value} (${study.completionDate?.precision} precision); approximately ${ageInYears.toFixed(2)} years before the ${snapshotDate} snapshot.`,
  }
}

function compareById(a: Trial, b: Trial): number {
  return a.nctId < b.nctId ? -1 : a.nctId > b.nctId ? 1 : 0
}

/** Search candidates, relevance baseline, and weighted ranking share one candidate set. */
export function rankStudies(
  allStudies: readonly Trial[],
  query: string,
  snapshotDate: string,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): RankingResult[] {
  const candidates = searchStudies([...allStudies], query)
  const completenessEnabled = isCompletenessAvailable(allStudies)
  const normalized = normalizeWeights(weights, completenessEnabled).weights
  const tokens = normalizeTokens(query)
  const baseline = candidates.map(study => ({ study, relevance: relevanceScore(study, query).score }))
    .sort((a, b) => b.relevance - a.relevance || compareById(a.study, b.study))
  const baselineRanks = new Map(baseline.map((entry, index) => [entry.study.nctId, index + 1]))

  return candidates.map(study => {
    const relevance = relevanceScore(study, query)
    const recency = recencyScore(study, snapshotDate)
    const completenessValue = completenessEnabled ? demographicCompleteness(study) : null
    const reportedCount = [study.demographics.age.status, sexOrGenderStatus(study), study.demographics.race.status,
      study.demographics.ethnicity.status].filter(status => status === 'reported').length
    const completenessReason = completenessEnabled
      ? `${reportedCount} of 4 reporting domains are marked reported (age, sex-or-gender, race, ethnicity).`
      : 'Demographic reporting completeness is unavailable because at least one required domain has not been extracted somewhere in this dataset; this component is disabled for all studies.'
    const contributions: RankingComponents = {
      relevance: relevance.score * normalized.relevance,
      recency: recency.score * normalized.recency,
      completeness: completenessValue === null ? null : completenessValue * normalized.completeness,
    }
    const score = contributions.relevance + contributions.recency + (contributions.completeness ?? 0)
    return {
      study,
      score,
      components: { relevance: relevance.score, recency: recency.score, completeness: completenessValue },
      normalizedWeights: normalized,
      contributions,
      baselineRank: baselineRanks.get(study.nctId) ?? 0,
      reasons: {
        relevance: tokens.length === 0 ? 'No search query: neutral ID-order baseline.' : relevance.reason,
        recency: recency.reason,
        completeness: completenessReason,
      },
    }
  }).sort((a, b) => b.score - a.score || compareById(a.study, b.study))
}

export function rankDataset(dataset: TrialDataset, query: string, weights: RankingWeights): RankingResult[] {
  return rankStudies(dataset.studies, query, dataset.snapshotDate, weights)
}
