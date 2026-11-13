import { useEffect, useMemo, useRef, useState } from 'react'
import type { Trial, TrialDataset, SourceRegistry } from './data/types'
import { validateDataset, validateSources } from './data/validate'
import { searchStudies } from './search'

type LoadedData = { dataset: TrialDataset; registry: SourceRegistry }
type LoadState = { kind: 'loading' } | { kind: 'error' } | ({ kind: 'ready' } & LoadedData)

const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`

function displayDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  if (!month) return String(year)
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', ...(day ? { day: 'numeric' as const } : {}), timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day || 1)))
}

function Citations({ ids }: { ids: string[] }) {
  return <span className="citation-links">{ids.map(id => <a key={id} href={`#source-${id}`}>{id}</a>)}</span>
}

function StudyCard({ study, index }: { study: Trial; index: number }) {
  const summaryWords = study.summary.split(/\s+/)
  const shortSummary = summaryWords.length > 45 ? `${summaryWords.slice(0, 45).join(' ')}…` : study.summary
  return <article className="study-card" aria-labelledby={`title-${study.nctId}`}>
    <div className="study-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
    <div className="study-body">
      <div className="study-topline"><span className="nct-id">{study.nctId}</span><span className="status-pill">Completed · Results posted</span></div>
      <h3 id={`title-${study.nctId}`}>{study.title}</h3>
      <p className="study-excerpt">{shortSummary}</p>
      <dl className="study-facts">
        <div><dt>Study type</dt><dd>Interventional</dd></div>
        <div><dt>Completion</dt><dd>{study.completionDate ? displayDate(study.completionDate.value) : 'Not available'}</dd></div>
        <div><dt>Enrollment{study.enrollmentType ? ` (${study.enrollmentType.toLowerCase()})` : ''}</dt><dd>{study.enrollment === null ? 'Not available' : study.enrollment.toLocaleString('en-US')}</dd></div>
        <div><dt>Location evidence</dt><dd>At least one U.S. site</dd></div>
      </dl>
      <div className="study-actions"><a className="source-link" href={study.sourceUrl}>Original trial record <span aria-hidden="true">↗</span><span className="sr-only"> for {study.nctId} on ClinicalTrials.gov</span></a></div>
      <details className="study-details">
        <summary>Study details &amp; data provenance</summary>
        <div className="detail-content">
          <h4>Registry summary</h4><p className="registry-summary">{study.summary}</p>
          <div className="detail-columns"><div><h4>Conditions</h4><ul>{[...new Set(study.conditions)].map(value => <li key={value}>{value}</li>)}</ul></div><div><h4>Interventions</h4><ul>{[...new Set(study.interventions)].map(value => <li key={value}>{value}</li>)}</ul></div></div>
          <h4>U.S. location evidence</h4><p>{[study.usLocation.facility, study.usLocation.city, study.usLocation.state, study.usLocation.country].filter(Boolean).join(', ')}. <Citations ids={study.usLocation.sourceIds} /></p>
          <p className="small-note">A U.S. location does not mean every participant was U.S.-based. Enrollment is the registry’s study enrollment, not a demographic denominator.</p>
          <h4>Participant demographic data</h4>
          <p className="small-note">“Not extracted” means this version has not collected that information; it does not mean the trial failed to report it. Eligibility criteria are not observed participant demographics.</p>
          <dl className="demographics">{Object.entries(study.demographics).map(([name, field]) => <div key={name}>
            <dt>{name}</dt><dd><span className="demographic-status">{field.status.replaceAll('-', ' ')}</span>
              {field.measures.map((measure, i) => <div className="measure" key={i}>
                <strong>{measure.measureLabel}{measure.categoryLabel ? ` — ${measure.categoryLabel}` : ''}</strong>
                <span>{measure.value ?? 'Not available'}{measure.unit ? ` ${measure.unit}` : ''}{measure.statisticType ? ` (${measure.statisticType})` : ''}</span>
                <span>Population: {measure.population}. Denominator: {measure.denominator ?? 'not available'}.</span>
                <Citations ids={measure.sourceIds} />
              </div>)}
              {field.sourceIds.length > 0 && <Citations ids={field.sourceIds} />}
            </dd>
          </div>)}</dl>
          <p className="small-note">Study sources: <Citations ids={study.sourceIds} /></p>
        </div>
      </details>
    </div>
  </article>
}

export default function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  function clearSearch() {
    setQuery('')
    searchInput.current?.focus()
  }
  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    async function load() {
      try {
        const responses = await Promise.all(['trials.json', 'sources.json'].map(file => fetch(dataUrl(file), { signal: controller.signal })))
        if (responses.some(response => !response.ok)) throw new Error('Data request failed')
        const [rawDataset, rawSources]: unknown[] = await Promise.all(responses.map(response => response.json()))
        const registry = validateSources(rawSources)
        const dataset = validateDataset(rawDataset, registry)
        if (!controller.signal.aborted) setState({ kind: 'ready', dataset, registry })
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'error' })
      }
    }
    void load()
    return () => controller.abort()
  }, [attempt])
  const studies = useMemo(() => state.kind === 'ready' ? searchStudies(state.dataset.studies, query) : [], [state, query])
  const dataset = state.kind === 'ready' ? state.dataset : null

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><a className="brand" href="#"><span className="brand-mark" aria-hidden="true">w</span><span>Who Was Studied?<small>TYPE 2 DIABETES RESEARCH</small></span></a><nav aria-label="Main navigation"><a href="#browse">Browse studies</a><a href="#about">About the sample</a><a href="#sources">Sources</a></nav></header>
    <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy"><p className="eyebrow"><span aria-hidden="true" /> A public research explorer · Stage 1 prototype</p><h1 id="hero-title">Research starts with<br />better questions.</h1><p className="hero-description">What was studied? Who participated? Explore a small, traceable sample of type 2 diabetes trials—and the limits of what their records can tell us.</p><a className="primary-button" href="#browse">Explore the studies <span aria-hidden="true">↓</span></a></div>
        <aside className="snapshot-panel" aria-label="Snapshot information"><div className="snapshot-label">THE CURRENT COLLECTION</div><div className="sample-count">{dataset ? dataset.studies.length : '—'}<span>source-checked studies</span></div><div className="snapshot-rule" /><p>Completed · Interventional<br />Results posted · U.S. site evidence</p><div className="snapshot-date">{dataset ? <>Snapshot <time dateTime={dataset.snapshotDate}>{displayDate(dataset.snapshotDate)}</time></> : state.kind === 'error' ? 'Snapshot unavailable' : 'Loading snapshot…'}</div><span className="sample-badge">Limited sample, not representative</span></aside>
      </section>

      <div className="context-strip"><span aria-hidden="true">ⓘ</span><p>For exploring research, not choosing treatment. This version supports browsing and keyword search. Demographic comparison and explained ranking are planned.</p></div>

      <section id="browse" className="browse-section" aria-labelledby="browse-title">
        <div className="section-heading"><div><p className="eyebrow">01 / THE STUDIES</p><h2 id="browse-title">Explore the evidence</h2></div>{dataset && <a className="download-link" href={dataUrl('trials.json')} download={`who-was-studied-${dataset.snapshotDate}.json`}>Download dated dataset <span aria-hidden="true">↓</span><small>JSON · {dataset.snapshotDate}</small></a>}</div>
        <div className="search-panel"><label htmlFor="study-search">Search this sample</label><div className="search-row"><span className="search-icon" aria-hidden="true">⌕</span><input ref={searchInput} id="study-search" type="search" placeholder="Try empagliflozin or cardiovascular" value={query} onChange={event => setQuery(event.target.value)} aria-describedby="search-help" disabled={state.kind !== 'ready'} />{query && <button className="clear-button" onClick={clearSearch}>Clear<span className="sr-only"> search</span></button>}</div><p id="search-help">Matches any whole word in titles, summaries, conditions, or interventions. Case and punctuation are ignored. Studies stay in NCT-ID order; no ranking is applied.</p></div>
        {state.kind === 'loading' && <div className="state-panel" role="status"><span className="loading-dot" aria-hidden="true" /><h3>Loading the study sample</h3><p>Opening the dated dataset and its source registry.</p></div>}
        {state.kind === 'error' && <div className="state-panel" role="alert"><h3>The sample could not be loaded</h3><p>The data may be unavailable or could not be verified. Please try again.</p><button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
        {state.kind === 'ready' && <>
          <div className="results-bar"><p role="status" aria-live="polite">Showing <strong>{studies.length}</strong> of {state.dataset.studies.length} studies{query.trim() ? ` for “${query}”` : ''}</p><span>NCT ID ↑</span></div>
          {state.dataset.studies.length === 0 ? <div className="state-panel"><h3>This snapshot has no studies</h3><p>The dataset loaded successfully, but contains no eligible study records.</p></div> : studies.length === 0 ? <div className="state-panel"><h3>No matching studies</h3><p>Try another word or clear your search to browse the full sample.</p><button className="primary-button" onClick={clearSearch}>Show all studies</button></div> : <div className="study-list">{studies.map((study, index) => <StudyCard key={study.nctId} study={study} index={index} />)}</div>}
        </>}
      </section>

      <section id="about" className="about-section" aria-labelledby="about-title"><div><p className="eyebrow">02 / CONTEXT &amp; LIMITS</p><h2 id="about-title">A starting point,<br />with a clear paper trail.</h2><p>This project is for students, journalists, and community members asking questions about research. Every study links back to its original registry record.</p>{dataset && <p className="snapshot-inline">Data snapshot: <time dateTime={dataset.snapshotDate}>{displayDate(dataset.snapshotDate)}</time>. Records may have changed since this date.</p>}</div><div className="about-notes"><article><h3>How this sample was selected</h3><p>{dataset?.cohort.selectionMethod ?? 'A small convenience sample, checked directly against ClinicalTrials.gov records for this prototype.'}</p>{dataset && <ul>{dataset.cohort.inclusionRules.map(rule => <li key={rule}>{rule}</li>)}</ul>}<p>Stage 1 uses direct ClinicalTrials.gov records. A reproducible AACT extraction is planned for the next stage.</p></article><article><h3>What the data cannot establish</h3><p>This limited sample cannot represent all diabetes research or show which treatment is right for a person. A U.S. study site does not establish that all participants were U.S.-based.</p><p>Demographic fields marked “not extracted” have not been collected for this version. Reporting completeness is not a measure of study quality, scientific validity, or clinical suitability. Sex and gender remain separate; no intersectional groups are inferred.</p></article><article><h3>What comes next</h3><p>Lindsay will add reproducible extraction and demographic provenance. Giulia will add transparent ranking and adjustable priorities. Leena will add study comparison and refine public content and accessibility. Archi will evaluate the system and verify the release.</p></article></div></section>

      <section id="sources" className="sources-section" aria-labelledby="sources-title"><div className="section-heading"><div><p className="eyebrow">03 / FOLLOW THE SOURCES</p><h2 id="sources-title">Evidence you can inspect</h2></div>{state.kind === 'ready' && <a className="download-link" href={dataUrl('sources.json')} download="who-was-studied-sources.json">Download source registry <span aria-hidden="true">↓</span></a>}</div><p className="section-intro">Original study records and database documentation support the sample and its provenance. Each entry records what it supports and when it was accessed.</p>{state.kind === 'ready' ? <ol className="source-list">{state.registry.sources.map(source => <li id={`source-${source.id}`} key={source.id}><span className="source-id">{source.id}</span><div><h3><a href={source.url}>{source.title} <span aria-hidden="true">↗</span></a></h3><p>{source.author}{source.publicationDate ? ` · ${displayDate(source.publicationDate)}` : ''}</p><p>{source.supports.join(' ')}</p><small>Accessed {displayDate(source.accessedDate)}</small></div></li>)}</ol> : <p className="small-note">{state.kind === 'error' ? 'The source registry could not be loaded. Use Try again above to reload the sample and sources.' : 'Sources will appear when the sample has loaded.'}</p>}</section>
    </main>
    <footer className="site-footer"><div className="footer-brand">Who Was Studied?<span>A CSE 194 group project</span></div><p>A limited research prototype. Built with AI-assisted development.<br />Use original records to investigate further.</p><a href="#">Back to top ↑</a></footer>
  </>
}
