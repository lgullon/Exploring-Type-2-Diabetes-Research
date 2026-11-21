import type { ReactNode } from 'react'
import type { DemographicField, DemographicMeasure, Demographics } from './data/types'

const domainLabels: Record<keyof Demographics, string> = {
  age: 'Age', sex: 'Sex', gender: 'Gender', race: 'Race', ethnicity: 'Ethnicity',
}
const statusLabels: Record<DemographicField['status'], string> = {
  reported: 'Reported', 'not-reported': 'Not reported', 'not-extracted': 'Not extracted',
}

/** "COUNT_OF_PARTICIPANTS" -> "Count of participants". */
function readable(code: string): string {
  const text = code.replaceAll('_', ' ').toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function distinctInOrder<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function formatValue(measure: DemographicMeasure | undefined): string {
  if (!measure) return '–'
  if (measure.value === null) return 'Not available'
  return typeof measure.value === 'number' ? measure.value.toLocaleString('en-US') : measure.value
}

/**
 * One measure as posted: categories as rows, result groups (arms and Total) as
 * columns. Values are shown exactly as reported; nothing is summed or converted.
 */
function MeasureTable({ label, description, measures }: { label: string; description: string | null; measures: DemographicMeasure[] }) {
  const populations = distinctInOrder(measures.map(m => m.population))
  const categories = distinctInOrder(measures.map(m => m.categoryLabel))
  const cells = new Map(measures.map(m => [`${m.categoryLabel}\u0000${m.population}`, m]))
  const statistics = distinctInOrder(measures.map(m => m.statisticType))
  const units = distinctInOrder(measures.map(m => m.unit))
  const sharedStatistic = statistics.length === 1 ? statistics[0] : null
  const sharedUnit = units.length === 1 ? units[0] : null
  const caption = [label, sharedStatistic && readable(sharedStatistic), sharedUnit].filter(Boolean).join(' · ')
  const denominator = (population: string) => {
    const values = distinctInOrder(measures.filter(m => m.population === population).map(m => m.denominator))
    if (values.length > 1) return 'Varies'
    return values[0] === null ? 'Not available' : values[0].toLocaleString('en-US')
  }
  const isTotal = (population: string) => /^total\b/i.test(population)

  return <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
    <table className="demo-table">
      <caption>{caption}{description && <span className="measure-description">{description}</span>}</caption>
      <thead><tr>
        <th scope="col">Category</th>
        {populations.map(p => <th scope="col" key={p} className={isTotal(p) ? 'total' : undefined}>{p}</th>)}
      </tr></thead>
      <tbody>
        {categories.map(category => <tr key={category ?? ''}>
          <th scope="row">{category ?? (sharedStatistic ? readable(sharedStatistic) : 'Value')}</th>
          {populations.map(p => {
            const measure = cells.get(`${category}\u0000${p}`)
            const extra = [!sharedStatistic && measure?.statisticType && readable(measure.statisticType), !sharedUnit && measure?.unit]
              .filter(Boolean).join(', ')
            return <td key={p} className={isTotal(p) ? 'total' : undefined}>{formatValue(measure)}{extra && <small> ({extra})</small>}</td>
          })}
        </tr>)}
        <tr className="denominator-row">
          <th scope="row">Number analyzed</th>
          {populations.map(p => <td key={p} className={isTotal(p) ? 'total' : undefined}>{denominator(p)}</td>)}
        </tr>
      </tbody>
    </table>
  </div>
}

export function DemographicTables({ demographics, renderCitations }: {
  demographics: Demographics
  renderCitations: (ids: string[]) => ReactNode
}) {
  return <div className="demographic-domains">
    {(Object.keys(domainLabels) as (keyof Demographics)[]).map(key => {
      const field = demographics[key]
      // One table per posted measure: a study may post the same title more than once.
      const byMeasure = new Map<string, DemographicMeasure[]>()
      for (const m of field.measures) {
        const key = `${m.measureLabel}\u0000${m.measureInstance}`
        const list = byMeasure.get(key)
        if (list) list.push(m); else byMeasure.set(key, [m])
      }
      const postings = (label: string) => field.measures.reduce((n, m) => m.measureLabel === label ? Math.max(n, m.measureInstance) : n, 0)
      return <section className="demographic-domain" key={key} aria-label={domainLabels[key]}>
        <h5>{domainLabels[key]} <span className={`status-badge ${field.status}`}>{statusLabels[field.status]}</span></h5>
        {[...byMeasure].map(([key, measures]) => {
          const { measureLabel, measureInstance, measureDescription } = measures[0]
          const count = postings(measureLabel)
          const label = count > 1 ? `${measureLabel} (table ${measureInstance} of ${count})` : measureLabel
          return <MeasureTable key={key} label={label} description={measureDescription} measures={measures} />
        })}
        {field.notes.length > 0 && <ul className="demo-notes">{field.notes.map(note => <li key={note}>{note}</li>)}</ul>}
        {field.sourceIds.length > 0 && <p className="demo-source">Source: {renderCitations(field.sourceIds)}</p>}
      </section>
    })}
  </div>
}
