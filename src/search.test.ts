import { describe, expect, it } from 'vitest'
import type { Trial } from './data/types'
import { normalizeTokens, searchStudies } from './search'

// Synthetic fixtures only: these records never enter the public dataset.
function fixture(nctId: string, fields: Partial<Trial> = {}): Trial {
  const missing = () => ({ status: 'not-extracted' as const, measures: [], sourceIds: [] })
  return {
    nctId, title: 'Synthetic study', summary: 'Synthetic description', conditions: [], interventions: [],
    status: 'COMPLETED', studyType: 'INTERVENTIONAL', hasResults: true,
    usLocation: { country: 'United States', facility: null, city: null, state: null, sourceIds: ['fixture'] },
    completionDate: null, enrollment: null, enrollmentType: null,
    sourceUrl: `https://clinicaltrials.gov/study/${nctId}`, sourceIds: ['fixture'],
    demographics: { age: missing(), sex: missing(), gender: missing(), race: missing(), ethnicity: missing() },
    ...fields,
  }
}

const studies = [
  fixture('NCT00000003', { title: 'Metformin: Type-2 trial', summary: 'Measured glycemic outcomes' }),
  fixture('NCT00000001', { conditions: ['Type 2 Diabetes'], interventions: ['Lifestyle coaching'] }),
  fixture('NCT00000002', { title: 'Insulin trial', summary: 'Exercise and glucose' }),
]
const ids = (query: string) => searchStudies(studies, query).map(study => study.nctId)

describe('shared search rule', () => {
  it('normalizes case, punctuation, accents and duplicate tokens', () => {
    expect(normalizeTokens('  MÉTFORMIN, metformin; TYPE–2! ')).toEqual(['metformin', 'type', '2'])
  })
  it('selects candidates by any matching distinct token, without ranking', () => {
    expect(ids('metformin exercise missing exercise')).toEqual(['NCT00000002', 'NCT00000003'])
  })
  it('searches each of the four supported fields', () => {
    expect(ids('metformin')).toEqual(['NCT00000003'])
    expect(ids('glycemic')).toEqual(['NCT00000003'])
    expect(ids('diabetes')).toEqual(['NCT00000001'])
    expect(ids('lifestyle')).toEqual(['NCT00000001'])
  })
  it('matches complete normalized tokens, not arbitrary substrings', () => {
    expect(ids('met')).toEqual([])
    expect(ids('TYPE–2')).toEqual(['NCT00000001', 'NCT00000003'])
  })
  it('shows all studies for empty or whitespace-only queries in stable NCT order', () => {
    expect(ids('')).toEqual(['NCT00000001', 'NCT00000002', 'NCT00000003'])
    expect(ids(' \t\n ')).toEqual(ids(''))
  })
  it('returns no candidates for unmatched or punctuation-only nonempty queries', () => {
    expect(ids('unfindable')).toEqual([])
    expect(ids('!!!')).toEqual([])
  })
  it('handles empty data without mutating the source list', () => {
    expect(searchStudies([], 'insulin')).toEqual([])
    const before = [...studies]
    searchStudies(studies, '')
    expect(studies).toEqual(before)
    expect(studies[0].nctId).toBe('NCT00000003')
  })
})
