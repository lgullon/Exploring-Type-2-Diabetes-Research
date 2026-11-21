import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DemographicMeasure, Demographics } from './data/types'
import { DemographicTables } from './DemographicTables'

// Synthetic values modeled on a study that posted "Age, Continuous" twice.
const measure = (instance: number, description: string, population: string, value: number | null): DemographicMeasure => ({
  measureLabel: 'Age, Continuous', measureDescription: description, measureInstance: instance, categoryLabel: null,
  value, unit: 'years', statisticType: 'MEAN', population, denominator: null, sourceIds: ['src'],
})
const empty = { status: 'not-reported' as const, measures: [], sourceIds: ['src'], notes: [] }
const demographics: Demographics = {
  age: {
    status: 'reported', sourceIds: ['src'], notes: [],
    measures: [
      measure(1, 'Non-randomised population.', 'Arm A (BG000)', 61.9),
      measure(1, 'Non-randomised population.', 'Arm B (BG001)', null),
      measure(2, 'Randomised population.', 'Arm A (BG000)', null),
      measure(2, 'Randomised population.', 'Arm B (BG001)', 61.1),
    ],
  },
  sex: empty, gender: empty, race: empty, ethnicity: empty,
}

describe('demographic tables', () => {
  it('shows each posting of a repeated measure as its own table, so no value hides another', () => {
    const html = renderToStaticMarkup(<DemographicTables demographics={demographics} renderCitations={() => null} />)
    expect(html.match(/<table/g)).toHaveLength(2)
    expect(html).toContain('61.9')
    expect(html).toContain('61.1')
    expect(html).toContain('Age, Continuous (table 1 of 2)')
    expect(html).toContain('Age, Continuous (table 2 of 2)')
    expect(html).toContain('Non-randomised population.')
    expect(html).toContain('Randomised population.')
  })
})
