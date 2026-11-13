import type { Trial } from './data/types'

/** Exact, distinct word tokens shared by browsing and future ranking. */
export function normalizeTokens(text: string): string[] {
  return [...new Set(text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean))]
}

/** Match any query token across all searchable fields; never score or rank. */
export function searchStudies(studies: readonly Trial[], query: string): Trial[] {
  const tokens = normalizeTokens(query)
  return studies.filter(study => {
    if (!query.trim()) return true
    const words = new Set(normalizeTokens([
      study.title, study.summary, ...study.conditions, ...study.interventions,
    ].join(' ')))
    return tokens.some(token => words.has(token))
  }).sort((a, b) => a.nctId < b.nctId ? -1 : a.nctId > b.nctId ? 1 : 0)
}
