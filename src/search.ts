import type { Trial } from './data/types'

/** Exact, distinct word tokens shared by browsing and future ranking. */
export function normalizeTokens(text: string): string[] {
  return [...new Set(text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean))]
}

// Each study's searchable words are computed once and reused on every keystroke.
const wordCache = new WeakMap<Trial, string[]>()

/** Sorted, distinct normalized words from the four searchable fields. */
export function studyWords(study: Trial): string[] {
  let words = wordCache.get(study)
  if (!words) {
    words = normalizeTokens([study.title, study.summary, ...study.conditions, ...study.interventions].join(' ')).sort()
    wordCache.set(study, words)
  }
  return words
}

/** True when some word begins with the token (so "metformi" matches "metformin"). */
export function hasWordStartingWith(sortedWords: readonly string[], token: string): boolean {
  let low = 0
  let high = sortedWords.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (sortedWords[mid] < token) low = mid + 1
    else high = mid
  }
  return low < sortedWords.length && sortedWords[low].startsWith(token)
}

/**
 * Match any query token against the start of any word in the searchable
 * fields; never score or rank. Ranking and evaluation must reuse this rule.
 */
export function searchStudies(studies: readonly Trial[], query: string): Trial[] {
  const tokens = normalizeTokens(query)
  return studies.filter(study => {
    if (!query.trim()) return true
    const words = studyWords(study)
    return tokens.some(token => hasWordStartingWith(words, token))
  }).sort((a, b) => a.nctId < b.nctId ? -1 : a.nctId > b.nctId ? 1 : 0)
}
