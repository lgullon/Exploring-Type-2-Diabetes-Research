import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DemographicMeasure, Demographics } from './data/types'
import { DemographicTables } from './DemographicTables'
import rawDataset from '../public/data/trials.json'

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

  it('renders every posted value of every study in the real dataset, so nothing is overwritten', () => {
    const studies = rawDataset.studies as unknown as { nctId: string; demographics: Demographics }[]
    for (const study of studies) {
      const html = renderToStaticMarkup(<DemographicTables demographics={study.demographics} renderCitations={() => null} />)
      // Each table has categories x groups cells; cells without a posted value show a dash.
      let cells = 0
      let values = 0
      for (const field of Object.values(study.demographics)) {
        const tables = new Map<string, DemographicMeasure[]>()
        for (const m of field.measures) tables.set(`${m.measureLabel}|${m.measureInstance}`, [...(tables.get(`${m.measureLabel}|${m.measureInstance}`) ?? []), m])
        for (const ms of tables.values()) cells += new Set(ms.map(m => m.categoryLabel)).size * new Set(ms.map(m => m.population)).size
        values += field.measures.length
      }
      const dashes = (html.match(/>–<\/td>/g) ?? []).length
      expect(cells - dashes, study.nctId).toBe(values)
    }
  })

  it('shows the values the review found hidden in NCT01388361', () => {
    const study = (rawDataset.studies as unknown as { nctId: string; demographics: Demographics }[]).find(s => s.nctId === 'NCT01388361')!
    const html = renderToStaticMarkup(<DemographicTables demographics={study.demographics} renderCitations={() => null} />)
    for (const value of ['61.9', '61.1', '60.9', '90', '146', '25', '36', '63', '53']) expect(html).toContain(`>${value}</td>`)
  })
})
