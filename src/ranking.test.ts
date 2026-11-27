import { describe, expect, it } from 'vitest'
import type { DemographicField, Trial } from './data/types'
import {
  DEFAULT_RANKING_WEIGHTS,
  completionTimestamp,
  demographicCompleteness,
  isCompletenessAvailable,
  normalizeWeights,
  rankStudies,
} from './ranking'

function field(status: DemographicField['status'], value = 1): DemographicField {
  return {
    status,
    measures: status === 'reported' ? [{
      measureLabel: 'Synthetic baseline measure', measureDescription: null, measureInstance: 1,
      categoryLabel: null, value, unit: 'Participants', statisticType: 'COUNT_OF_PARTICIPANTS',
      population: 'Total', denominator: 10, sourceIds: ['fixture'],
    }] : [],
    sourceIds: ['fixture'], notes: [],
  }
}

function fixture(
  nctId: string,
  options: {
    title?: string
    summary?: string
    completionDate?: Trial['completionDate']
    age?: DemographicField
    sex?: DemographicField
    gender?: DemographicField
    race?: DemographicField
    ethnicity?: DemographicField
  } = {},
): Trial {
  const missing = () => field('not-reported')
  return {
    nctId,
    title: options.title ?? 'Type 2 diabetes study',
    summary: options.summary ?? 'A clinical research study',
    conditions: ['Type 2 diabetes'],
    interventions: ['Lifestyle support'],
    status: 'COMPLETED', studyType: 'INTERVENTIONAL', hasResults: true,
    usLocation: { country: 'United States', facility: null, city: null, state: null, sourceIds: ['fixture'] },
    completionDate: options.completionDate === undefined ? null : options.completionDate,
    enrollment: null, enrollmentType: null,
    sourceUrl: `https://clinicaltrials.gov/study/${nctId}`, sourceIds: ['fixture'],
    demographics: {
      age: options.age ?? field('reported', 0),
      sex: options.sex ?? missing(),
      gender: options.gender ?? field('reported', 0),
      race: options.race ?? missing(),
      ethnicity: options.ethnicity ?? missing(),
    },
  }
}

const snapshot = '2026-11-17'

describe('transparent ranking', () => {
  it('uses neutral relevance and stable ID order for an empty query', () => {
    const results = rankStudies([fixture('NCT00000002'), fixture('NCT00000001')], '', snapshot)
    expect(results.map(result => result.study.nctId)).toEqual(['NCT00000001', 'NCT00000002'])
    expect(results.every(result => result.components.relevance === 0)).toBe(true)
    expect(results[0].reasons.relevance).toContain('neutral ID-order')
    expect(results[0].baselineRank).toBe(1)
  })

  it('normalizes punctuation and case and counts distinct matching query tokens', () => {
    const study = fixture('NCT00000001', { title: 'METFORMIN, Type-2 Diabetes' })
    const [result] = rankStudies([study], 'metforMIN! TYPE type', snapshot)
    expect(result.components.relevance).toBe(1)
    expect(result.reasons.relevance).toContain('2 of 2')
  })

  it('keeps deterministic NCT-ID tie-breaking', () => {
    const results = rankStudies([fixture('NCT00000003'), fixture('NCT00000001'), fixture('NCT00000002')], 'diabetes', snapshot)
    expect(results.map(result => result.study.nctId)).toEqual(['NCT00000001', 'NCT00000002', 'NCT00000003'])
  })

  it('uses the first day of year/month-only dates for computation', () => {
    const year = fixture('NCT00000001', { completionDate: { value: '2020', precision: 'year' } })
    const month = fixture('NCT00000002', { completionDate: { value: '2020-06', precision: 'month' } })
    expect(new Date(completionTimestamp(year)!).toISOString().slice(0, 10)).toBe('2020-01-01')
    expect(new Date(completionTimestamp(month)!).toISOString().slice(0, 10)).toBe('2020-06-01')
  })

  it('scores missing or invalid completion dates as zero', () => {
    const [missing] = rankStudies([fixture('NCT00000001')], '', snapshot)
    const [invalid] = rankStudies([fixture('NCT00000002', { completionDate: { value: '2024-13', precision: 'month' } })], '', snapshot)
    expect(missing.components.recency).toBe(0)
    expect(invalid.components.recency).toBe(0)
    expect(missing.reasons.recency).toContain('missing or invalid')
  })

  it('flags future completion dates before applying the recency formula', () => {
    const [result] = rankStudies([fixture('NCT00000001', { completionDate: { value: '2027-01-01', precision: 'day' } })], '', snapshot)
    expect(result.components.recency).toBe(0)
    expect(result.reasons.recency).toContain('future date')
  })

  it('is reproducible for a fixed snapshot date', () => {
    const studies = [fixture('NCT00000001', { completionDate: { value: '2020-05', precision: 'month' } })]
    expect(rankStudies(studies, 'diabetes', snapshot)).toEqual(rankStudies(studies, 'diabetes', snapshot))
  })

  it('normalizes weights and restores defaults when all enabled weights are zero', () => {
    const normalized = normalizeWeights({ relevance: 6, recency: 2, completeness: 2 }, true)
    expect(normalized.weights).toEqual({ relevance: 0.6, recency: 0.2, completeness: 0.2 })
    expect(normalizeWeights({ relevance: 0, recency: 0, completeness: 0 }, true)).toEqual({
      weights: DEFAULT_RANKING_WEIGHTS, restoredDefaults: true,
    })
  })

  it('disables completeness for all studies if a required domain is not extracted', () => {
    const complete = fixture('NCT00000001')
    const incomplete = fixture('NCT00000002', { race: field('not-extracted') })
    expect(isCompletenessAvailable([complete, incomplete])).toBe(false)
    const results = rankStudies([complete, incomplete], '', snapshot)
    expect(results.every(result => result.components.completeness === null)).toBe(true)
    expect(results.every(result => result.normalizedWeights.completeness === 0)).toBe(true)
  })

  it('treats reported zero as reported and not-reported as missing', () => {
    const reportedZero = fixture('NCT00000001', { race: field('reported', 0) })
    const notReported = fixture('NCT00000002', { race: field('not-reported') })
    expect(demographicCompleteness(reportedZero)).toBe(0.75)
    expect(demographicCompleteness(notReported)).toBe(0.5)
  })


  it('keeps weighted and relevance-baseline candidates identical and sums contributions to the total', () => {
    const studies = [fixture('NCT00000001', { title: 'Metformin diabetes' }), fixture('NCT00000002', { title: 'Insulin diabetes' })]
    const results = rankStudies(studies, 'metformin insulin', snapshot)
    expect(results.map(result => result.study.nctId).sort()).toEqual(['NCT00000001', 'NCT00000002'])
    for (const result of results) {
      const contributionSum = result.contributions.relevance + result.contributions.recency + (result.contributions.completeness ?? 0)
      expect(Math.abs(result.score - contributionSum)).toBeLessThan(1e-12)
      expect(result.baselineRank).toBeGreaterThan(0)
    }
  })

  it('can change order when a component weight changes for that component reason', () => {
    const olderComplete = fixture('NCT00000001', {
      title: 'Diabetes trial', completionDate: { value: '2025-01-01', precision: 'day' },
      age: field('reported'), sex: field('reported'), gender: field('reported'),
      race: field('reported'), ethnicity: field('reported'),
    })
    const recentSparse = fixture('NCT00000002', {
      title: 'Diabetes trial', completionDate: { value: '2026-01-01', precision: 'day' },
      age: field('reported'), sex: field('not-reported'), gender: field('not-reported'),
      race: field('not-reported'), ethnicity: field('not-reported'),
    })
    const reportingFirst = rankStudies([recentSparse, olderComplete], 'diabetes', snapshot,
      { relevance: 0, recency: 0, completeness: 1 })
    const recencyFirst = rankStudies([recentSparse, olderComplete], 'diabetes', snapshot,
      { relevance: 0, recency: 1, completeness: 0 })
    expect(reportingFirst[0].study.nctId).toBe('NCT00000001')
    expect(recencyFirst[0].study.nctId).toBe('NCT00000002')
    expect(reportingFirst[0].contributions.completeness).toBeGreaterThan(reportingFirst[1].contributions.completeness!)
  })
})
