import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Trial, TrialDataset, SourceRegistry } from './data/types'
import { validateDataset, validateSources } from './data/validate'
import { DemographicTables } from './DemographicTables'
import { DEFAULT_RANKING_WEIGHTS, isCompletenessAvailable, normalizeWeights, rankStudies, type RankingResult, type RankingWeights } from './ranking'

/** Results are shown in pages so typing stays responsive with ~1,000 studies. */
const PAGE_SIZE = 50

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

const StudyCard = memo(function StudyCard({ study, index, ranking, baselineIsNeutral }: { study: Trial; index: number; ranking: RankingResult; baselineIsNeutral: boolean }) {
  // Details render only once opened, so long lists stay fast.
  const [detailsOpen, setDetailsOpen] = useState(false)
  const summaryWords = study.summary.split(/\s+/)
  const shortSummary = summaryWords.length > 45 ? `${summaryWords.slice(0, 45).join(' ')}…` : study.summary
  return <article className="study-card" aria-labelledby={`title-${study.nctId}`}>
    <div className="study-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
    <div className="study-body">
      <div className="study-topline"><span className="nct-id">{study.nctId}</span><span className="status-pill">Completed · Results posted</span></div>
      <h3 id={`title-${study.nctId}`}>{study.title}</h3>
      <p className="study-excerpt">{shortSummary}</p>
      <section className="ranking-breakdown" aria-label={`Ranking explanation for ${study.nctId}`}>
        <div className="ranking-score"><span className="ranking-score-label">Weighted score</span><strong>{(ranking.score * 100).toFixed(1)}</strong><span className="ranking-score-out-of">/ 100</span></div>
        <div className="ranking-position"><strong>Rank #{index + 1}</strong><span>{baselineIsNeutral ? `Neutral ID-order baseline: #${ranking.baselineRank}` : `Relevance-only baseline: #${ranking.baselineRank}`}</span><span>{ranking.baselineRank === index + 1 ? 'No position change' : ranking.baselineRank > index + 1 ? `Moved up ${ranking.baselineRank - index - 1} ${ranking.baselineRank - index - 1 === 1 ? 'place' : 'places'}` : `Moved down ${index + 1 - ranking.baselineRank} ${index + 1 - ranking.baselineRank === 1 ? 'place' : 'places'}`}</span></div>
        <div className="ranking-components">
          <div><span>Relevance</span><strong>{(ranking.components.relevance * 100).toFixed(0)}%</strong><small>{(ranking.contributions.relevance * 100).toFixed(1)} points · {(ranking.normalizedWeights.relevance * 100).toFixed(0)}% weight</small></div>
          <div><span>Recency</span><strong>{(ranking.components.recency * 100).toFixed(0)}%</strong><small>{(ranking.contributions.recency * 100).toFixed(1)} points · {(ranking.normalizedWeights.recency * 100).toFixed(0)}% weight</small></div>
          <div><span>Demographic reporting</span><strong>{ranking.components.completeness === null ? 'Unavailable' : `${(ranking.components.completeness * 100).toFixed(0)}%`}</strong><small>{ranking.contributions.completeness === null ? 'Disabled for this dataset' : `${(ranking.contributions.completeness * 100).toFixed(1)} points · ${(ranking.normalizedWeights.completeness * 100).toFixed(0)}% weight`}</small></div>
        </div>
        <details className="ranking-reasons"><summary>Why this study received this score</summary><ul><li>{ranking.reasons.relevance}</li><li>{ranking.reasons.recency}</li><li>{ranking.reasons.completeness}</li></ul><p className="small-note">The weighted contributions sum to the displayed score. This is an educational ranking rule, not a validated measure of trial quality.</p></details>
      </section>
      <dl className="study-facts">
        <div><dt>Study type</dt><dd>Interventional</dd></div>
        <div><dt>Completion</dt><dd>{study.completionDate ? displayDate(study.completionDate.value) : 'Not available'}</dd></div>
        <div><dt>Enrollment{study.enrollmentType ? ` (${study.enrollmentType.toLowerCase()})` : ''}</dt><dd>{study.enrollment === null ? 'Not available' : study.enrollment.toLocaleString('en-US')}</dd></div>
        <div><dt>U.S. study site</dt><dd>At least one U.S. site</dd></div>
      </dl>
      <div className="study-actions"><a className="source-link" href={study.sourceUrl}>Original trial record <span aria-hidden="true">↗</span><span className="sr-only"> for {study.nctId} on ClinicalTrials.gov</span></a></div>
      <details className="study-details" onToggle={event => setDetailsOpen(event.currentTarget.open)}>
        <summary>Study details and sources</summary>
        {detailsOpen && <div className="detail-content">
          <h4>Registry summary</h4><p className="registry-summary">{study.summary}</p>
          <div className="detail-columns"><div><h4>Conditions</h4><ul>{[...new Set(study.conditions)].map(value => <li key={value}>{value}</li>)}</ul></div><div><h4>Interventions</h4><ul>{[...new Set(study.interventions)].map(value => <li key={value}>{value}</li>)}</ul></div></div>
          <h4>Listed U.S. study site</h4><p>{[study.usLocation.facility, study.usLocation.city, study.usLocation.state, study.usLocation.country].filter(Boolean).join(', ')}. <Citations ids={study.usLocation.sourceIds} /></p>
          <p className="small-note">A listed U.S. site does not show where every participant lived. Enrollment is the number listed for the whole study and may differ from the population used in a demographic analysis.</p>
          <h4>Participant demographic data</h4>
          <p className="small-note">Values come from the study’s posted baseline characteristics, exactly as labeled. Each column is one study group; the Total column covers all groups, so do not add it to the others. “Number analyzed” shows “Not available” when the count could not be confirmed from the posted data. “Not reported” means the posted results include no measure with that label. Eligibility criteria describe who could join a study, not who actually participated.</p>
          <DemographicTables demographics={study.demographics} renderCitations={ids => <Citations ids={ids} />} />
          <p className="small-note">Study sources: <Citations ids={study.sourceIds} /></p>
        </div>}
      </details>
    </div>
  </article>
})

/** Memoized so the ~1,000 citations are not re-rendered on every keystroke. */
const SourceList = memo(function SourceList({ registry }: { registry: SourceRegistry }) {
  return <ol className="source-list">{registry.sources.map(source => <li id={`source-${source.id}`} key={source.id}><span className="source-id">{source.id}</span><div><h3><a href={source.url}>{source.title} <span aria-hidden="true">↗</span></a></h3><p>{source.author}{source.publicationDate ? ` · ${displayDate(source.publicationDate)}` : ''}</p><p>{source.supports.join(' ')}</p><small>Accessed {displayDate(source.accessedDate)}</small></div></li>)}</ol>
})

export default function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [weights, setWeights] = useState<RankingWeights>(DEFAULT_RANKING_WEIGHTS)
  const [showWeightResetNotice, setShowWeightResetNotice] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  function clearSearch() {
    setQuery('')
    searchInput.current?.focus()
  }
  function resetRanking() {
    setWeights(DEFAULT_RANKING_WEIGHTS)
    setShowWeightResetNotice(false)
  }
  function updateWeight(key: keyof RankingWeights, value: number) {
    const next = { ...weights, [key]: value }
    const enabledTotal = next.relevance + next.recency + (completenessEnabled ? next.completeness : 0)
    if (enabledTotal === 0) {
      setWeights(DEFAULT_RANKING_WEIGHTS)
      setShowWeightResetNotice(true)
    } else {
      setWeights(next)
      setShowWeightResetNotice(false)
    }
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
  // The input updates immediately; filtering and the list catch up a moment later.
  const deferredQuery = useDeferredValue(query)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  useEffect(() => setVisibleCount(PAGE_SIZE), [deferredQuery])
  const dataset = state.kind === 'ready' ? state.dataset : null
  const completenessEnabled = dataset ? isCompletenessAvailable(dataset.studies) : false
  const normalizedWeightState = normalizeWeights(weights, completenessEnabled)
  const studies = useMemo(() => dataset ? rankStudies(dataset.studies, deferredQuery, dataset.snapshotDate, weights) : [], [dataset, deferredQuery, weights])
  const visibleStudies = studies.slice(0, visibleCount)
  const baselineIsNeutral = !deferredQuery.trim()

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><a className="brand" href="#"><span className="brand-mark" aria-hidden="true">w</span><span>Who Was Studied?<small>TYPE 2 DIABETES RESEARCH</small></span></a><nav aria-label="Main navigation"><a href="#browse">Browse studies</a><a href="#about">About the sample</a><a href="#sources">Sources</a></nav></header>
    <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy"><p className="eyebrow"><span aria-hidden="true" /> Clinical trial browser</p><h1 id="hero-title">Explore type 2<br />diabetes trials.</h1><p className="hero-description">Browse completed trials with posted results and a listed U.S. study site. Each record links to ClinicalTrials.gov.</p><a className="primary-button" href="#browse">Browse studies <span aria-hidden="true">↓</span></a></div>
        <aside className="snapshot-panel" aria-label="Snapshot information"><div className="snapshot-label">IN THIS SNAPSHOT</div><div className="sample-count">{dataset ? dataset.studies.length : '…'}<span>trial records</span></div><div className="snapshot-rule" /><p>Completed · Interventional<br />Results posted · U.S. site listed</p><div className="snapshot-date">{dataset ? <>Snapshot <time dateTime={dataset.snapshotDate}>{displayDate(dataset.snapshotDate)}</time></> : state.kind === 'error' ? 'Snapshot unavailable' : 'Loading snapshot…'}</div><span className="sample-badge">{dataset && !dataset.limitedSample ? 'All matching studies in the snapshot' : 'Limited sample, not representative'}</span></aside>
      </section>

      <div className="context-strip"><span aria-hidden="true">ⓘ</span><p>Use this site to explore research. It does not provide treatment advice.</p></div>

      <section id="browse" className="browse-section" aria-labelledby="browse-title">
        <div className="section-heading"><div><h2 id="browse-title">Browse studies</h2></div>{dataset && <a className="download-link" href={dataUrl('trials.json')} download={`who-was-studied-${dataset.snapshotDate}.json`}>Download study data <span aria-hidden="true">↓</span><small>JSON · {dataset.snapshotDate}</small></a>}</div>
        <div className="search-panel"><label htmlFor="study-search">Search this sample</label><div className="search-row"><span className="search-icon" aria-hidden="true">⌕</span><input ref={searchInput} id="study-search" type="search" placeholder="Try empagliflozin or cardiovascular" value={query} onChange={event => setQuery(event.target.value)} aria-describedby="search-help" disabled={state.kind !== 'ready'} />{query && <button className="clear-button" onClick={clearSearch}>Clear<span className="sr-only"> search</span></button>}</div><p id="search-help">Matches words that start with what you type (for example, “metfor” finds “metformin”) in titles, summaries, conditions, or interventions. Capitalization and punctuation do not matter. Results use the adjustable ranking priorities below.</p></div>
        {state.kind === 'ready' && <section className="ranking-controls" aria-labelledby="ranking-controls-title">
          <div className="ranking-controls-heading"><div><p className="eyebrow">Personalize the order</p><h3 id="ranking-controls-title">What matters most to you?</h3><p>Adjust the relative importance of each factor. The active weights are normalized to add up to 100%.</p></div><button className="reset-ranking-button" type="button" onClick={resetRanking}>Reset priorities</button></div>
          <div className="weight-controls">
            <label className="weight-control"><span><strong>Relevance</strong><output>{Math.round(normalizedWeightState.weights.relevance * 100)}% effective</output></span><input aria-label="Relevance weight" type="range" min="0" max="100" step="1" value={Math.round(weights.relevance * 100)} onChange={event => updateWeight('relevance', Number(event.target.value) / 100)} /><small>How closely the study matches your search.</small></label>
            <label className="weight-control"><span><strong>Recency</strong><output>{Math.round(normalizedWeightState.weights.recency * 100)}% effective</output></span><input aria-label="Recency weight" type="range" min="0" max="100" step="1" value={Math.round(weights.recency * 100)} onChange={event => updateWeight('recency', Number(event.target.value) / 100)} /><small>How recently the study was completed.</small></label>
            <label className="weight-control"><span><strong>Demographic reporting</strong><output>{Math.round(normalizedWeightState.weights.completeness * 100)}% effective</output></span><input aria-label="Demographic reporting weight" type="range" min="0" max="100" step="1" value={Math.round(weights.completeness * 100)} disabled={!completenessEnabled} onChange={event => updateWeight('completeness', Number(event.target.value) / 100)} /><small>{completenessEnabled ? 'Whether age, sex-or-gender, race, and ethnicity results are reported.' : 'Unavailable: demographic extraction is incomplete for this dataset.'}</small></label>
          </div>
          {(normalizedWeightState.restoredDefaults || showWeightResetNotice) && <p className="weight-notice" role="status">All active weights were zero. Default priorities have been restored.</p>}
          {!completenessEnabled && <p className="weight-notice" role="status">Demographic reporting is disabled for every study because at least one required domain has not been extracted.</p>}
          <p className="weight-method-note">Reporting completeness describes what studies reported; it does not measure study quality, validity, or clinical relevance.</p>
          <details className="ranking-methodology"><summary>How the ranking is calculated</summary><p><strong>Final score</strong> = relevance × normalized relevance weight + recency × normalized recency weight + demographic reporting × normalized reporting weight. The normalized weights of enabled components add up to 100%.</p><p><strong>Relevance:</strong> the fraction of distinct search terms that match the beginning of a word in a study's title, summary, conditions, or interventions. With an empty search, relevance is neutral (0).</p><p><strong>Recency:</strong> clamp(1 − years since completion ÷ 10, 0, 1), measured against the fixed dataset snapshot date. For computation, year-only dates use January 1 and month-only dates use the first day of the month. Missing, invalid, and future dates score 0.</p><p><strong>Demographic reporting:</strong> the fraction of four domains reported: age, sex-or-gender, race, and ethnicity. If any required domain is not extracted anywhere in the dataset, this component is disabled for all studies.</p><p>The exact formula and default weights are project choices, informed by research on <a href="#source-robertson-2009-probabilistic-relevance">relevance ranking</a> and <a href="#source-tintarev-masthoff-2015-explaining-recommendations">recommender explanations</a>. This is an educational scoring rule, not a validated measure of trial quality.</p></details>
        </section>}
        {state.kind === 'loading' && <div className="state-panel" role="status"><span className="loading-dot" aria-hidden="true" /><h3>Loading the study sample</h3><p>Loading study records and sources.</p></div>}
        {state.kind === 'error' && <div className="state-panel" role="alert"><h3>The sample could not be loaded</h3><p>The data may be unavailable or could not be verified. Please try again.</p><button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
        {state.kind === 'ready' && <>
          <div className="results-bar"><p role="status" aria-live="polite"><strong>{studies.length}</strong> of {state.dataset.studies.length} studies{deferredQuery.trim() ? ` match “${deferredQuery}”` : ''}</p><span>WEIGHTED SCORE ↓</span></div>
          {state.dataset.studies.length === 0 ? <div className="state-panel"><h3>This snapshot has no studies</h3><p>The data loaded, but this sample contains no studies.</p></div> : studies.length === 0 ? <div className="state-panel"><h3>No matching studies</h3><p>Try another word or clear your search to browse the full sample.</p><button className="primary-button" onClick={clearSearch}>Show all studies</button></div> : <>
            <div className="study-list">{visibleStudies.map((ranking, index) => <StudyCard key={ranking.study.nctId} study={ranking.study} index={index} ranking={ranking} baselineIsNeutral={baselineIsNeutral} />)}</div>
            {studies.length > visibleStudies.length && <div className="show-more"><p>Showing {visibleStudies.length} of {studies.length}</p><button className="primary-button" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, studies.length - visibleStudies.length)} more</button></div>}
          </>}
        </>}
      </section>

      <section id="about" className="about-section" aria-labelledby="about-title"><div><h2 id="about-title">About this sample</h2><p>We built this site for students, journalists, and community members who want to learn about diabetes research. You can check each study against its original registry record.</p>{dataset && <p className="snapshot-inline">Data snapshot: <time dateTime={dataset.snapshotDate}>{displayDate(dataset.snapshotDate)}</time>. Records may have changed since this date. Recency scores use this fixed snapshot date, not today's date.</p>}</div><div className="about-notes"><article><h3>How this sample was selected</h3><p>{dataset?.cohort.selectionMethod ?? 'A small convenience sample, checked directly against ClinicalTrials.gov records for this prototype.'}</p>{dataset && <ul>{dataset.cohort.inclusionRules.map(rule => <li key={rule}>{rule}</li>)}</ul>}<p>The records come from a dated copy of AACT, a public database of ClinicalTrials.gov records, and are rebuilt with a documented, repeatable process.</p></article><article><h3>Limits of the data</h3><p>These studies do not represent all diabetes research and cannot tell you which treatment is right for you. A listed U.S. site does not mean all participants were based in the United States.</p><p>Demographics are shown as each study labeled them. How much a study reports does not establish its quality, scientific validity, or suitability for a patient. We keep sex and gender separate, do not split combined race/ethnicity measures, and do not infer combinations of demographic groups.</p></article><article><h3>Planned features</h3><p>Adjustable ranking lets users change their priorities and see why the order changes. Study comparisons and evaluation will extend this experience. The ranking is an educational scoring rule, not a measure of clinical trial quality.</p></article></div></section>

      <section id="sources" className="sources-section" aria-labelledby="sources-title"><div className="section-heading"><div><h2 id="sources-title">Sources</h2></div>{state.kind === 'ready' && <a className="download-link" href={dataUrl('sources.json')} download="who-was-studied-sources.json">Download sources <span aria-hidden="true">↓</span></a>}</div><p className="section-intro">Each entry links to an original trial record or database documentation and explains which information it supports. Access dates show when we checked the source.</p>{state.kind === 'ready' ? <SourceList registry={state.registry} /> : <p className="small-note">{state.kind === 'error' ? 'The source registry could not be loaded. Use Try again above to reload the sample and sources.' : 'Sources will appear when the sample has loaded.'}</p>}</section>
    </main>
    <footer className="site-footer"><div className="footer-brand">Who Was Studied?<span>A CSE 194 group project</span></div><p>Built with AI-assisted development.<br />See the linked trial records for the original study information.</p><a href="#">Back to top ↑</a></footer>
  </>
}
