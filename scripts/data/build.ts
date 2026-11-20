// Builds public/data/trials.json and public/data/sources.json from an
// extracted AACT flat-file snapshot. See docs/methodology.md.
//
//   npm run data:build -- --input <folder of AACT .txt tables> --accessed YYYY-MM-DD
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Source, SourceRegistry, Trial, TrialDataset } from '../../src/data/types.ts';
import { validateDataset, validateSources } from '../../src/data/validate.ts';
import { readTable } from './aact.ts';
import { classifyCondition, conditionExclusion, emptyFunnel, NCT_ID, registryExclusion, type Funnel, type StudyRow } from './cohort.ts';
import { buildDemographics, parseCompletionDate, parseCount, type BaselineRow, type ResultGroup } from './normalize.ts';

export const REQUIRED_TABLES = [
  'studies', 'conditions', 'countries', 'facilities', 'brief_summaries',
  'interventions', 'result_groups', 'baseline_counts', 'baseline_measurements',
] as const;

export type BuildReport = {
  funnel: Funnel;
  matchedConditionNames: Record<string, number>;
  usListedOnlyAsRemovedCountry: number;
  needsReview: Record<string, string[]>;
};

type Candidate = {
  nct_id: string; brief_title: string; source: string; study_first_posted_date: string;
  completion_month_year: string; enrollment: string; enrollment_type: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sourceIdFor = (nctId: string) => `ctgov-${nctId.toLowerCase()}`;

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

export async function buildDataset(inputDir: string, accessedDate: string, reference: SourceRegistry) {
  if (!datePattern.test(accessedDate)) throw new Error('--accessed must be a YYYY-MM-DD date');
  for (const table of REQUIRED_TABLES) {
    if (!existsSync(join(inputDir, `${table}.txt`))) throw new Error(`Missing AACT table ${table}.txt in ${inputDir}`);
  }
  const table = (name: (typeof REQUIRED_TABLES)[number]) => readTable(join(inputDir, `${name}.txt`));
  const funnel = emptyFunnel();
  const exclude = (reason: keyof Funnel['excluded'], n = 1) => { funnel.excluded[reason] += n; };

  // 1. Registry rules (studies table). Duplicated IDs are excluded entirely.
  // Each valid ID's single-row outcome is held until the pass ends, because a later duplicate row voids it.
  const outcome = new Map<string, { rows: number; reason: ReturnType<typeof registryExclusion>; row: Candidate | null }>();
  let snapshotDate = '';
  for await (const row of table('studies')) {
    funnel.considered++;
    // Snapshot date = the newest registry update the export contains (AACT's own reload spans several days).
    const posted = (row.last_update_posted_date ?? '').trim();
    if (datePattern.test(posted) && posted > snapshotDate) snapshotDate = posted;
    if (!NCT_ID.test(row.nct_id)) { exclude('invalid-nct-id'); continue; }
    const seen = outcome.get(row.nct_id);
    if (seen) { seen.rows++; continue; }
    const reason = registryExclusion(row as unknown as StudyRow);
    // Keep only the fields used later, so the full registry fits in memory.
    const kept: Candidate | null = reason ? null : {
      nct_id: row.nct_id, brief_title: row.brief_title, source: row.source, study_first_posted_date: row.study_first_posted_date,
      completion_month_year: row.completion_month_year, enrollment: row.enrollment, enrollment_type: row.enrollment_type,
    };
    outcome.set(row.nct_id, { rows: 1, reason, row: kept });
  }
  const candidates = new Map<string, Candidate>();
  for (const [id, o] of outcome) {
    if (o.rows > 1) exclude('duplicate-nct-id', o.rows);
    else if (o.reason) exclude(o.reason);
    else if (o.row) candidates.set(id, o.row);
  }
  outcome.clear();
  if (!snapshotDate) throw new Error('Could not determine the snapshot date from studies.last_update_posted_date');

  // 2. Condition rule.
  const conditions = new Map<string, { id: number; name: string }[]>();
  for await (const row of table('conditions')) {
    if (candidates.has(row.nct_id)) push(conditions, row.nct_id, { id: Number(row.id), name: row.name.trim() });
  }
  const matchedConditionNames: Record<string, number> = {};
  for (const id of [...candidates.keys()]) {
    const names = (conditions.get(id) ?? []).sort((a, b) => a.id - b.id).map((c) => c.name).filter(Boolean);
    const reason = conditionExclusion(names);
    if (reason) { exclude(reason); candidates.delete(id); continue; }
    for (const name of names) {
      if (classifyCondition(name) === 'type-2-diabetes') {
        const key = name.toLowerCase();
        matchedConditionNames[key] = (matchedConditionNames[key] ?? 0) + 1;
      }
    }
  }

  // 3. U.S. facility rule. The first listed U.S. facility (lowest AACT id) with any location text is kept as evidence.
  const usFacility = new Map<string, { id: number; facility: string | null; city: string | null; state: string | null }>();
  for await (const row of table('facilities')) {
    if (!candidates.has(row.nct_id) || row.country.trim() !== 'United States') continue;
    const loc = { id: Number(row.id), facility: row.name.trim() || null, city: row.city.trim() || null, state: row.state.trim() || null };
    if (!loc.facility && !loc.city && !loc.state) continue;
    const current = usFacility.get(row.nct_id);
    if (!current || loc.id < current.id) usFacility.set(row.nct_id, loc);
  }
  const removedUs = new Set<string>();
  for await (const row of table('countries')) {
    if (candidates.has(row.nct_id) && !usFacility.has(row.nct_id) && row.name === 'United States' && row.removed === 't') removedUs.add(row.nct_id);
  }
  for (const id of [...candidates.keys()]) {
    if (!usFacility.has(id)) { exclude('no-us-facility'); candidates.delete(id); }
  }

  // 4. Study text, interventions and baseline results for the remaining cohort.
  const summaries = new Map<string, string>();
  for await (const row of table('brief_summaries')) if (candidates.has(row.nct_id)) summaries.set(row.nct_id, row.description.trim());
  const interventions = new Map<string, { id: number; name: string }[]>();
  for await (const row of table('interventions')) {
    if (candidates.has(row.nct_id) && row.name.trim()) push(interventions, row.nct_id, { id: Number(row.id), name: row.name.trim() });
  }
  const groups = new Map<string, ResultGroup>();
  for await (const row of table('result_groups')) {
    if (candidates.has(row.nct_id) && row.result_type === 'Baseline') groups.set(row.id, { title: row.title, code: row.ctgov_group_code });
  }
  const groupCounts = new Map<string, number>();
  for await (const row of table('baseline_counts')) {
    const n = parseCount(row.count);
    if (candidates.has(row.nct_id) && row.scope === 'overall' && n !== null) groupCounts.set(row.result_group_id, n);
  }
  const baseline = new Map<string, BaselineRow[]>();
  for await (const row of table('baseline_measurements')) if (candidates.has(row.nct_id)) push(baseline, row.nct_id, row as unknown as BaselineRow);

  // 5. Assemble trials and their citation records.
  const snapshotSourceId = `aact-snapshot-${snapshotDate}`;
  if (!reference.sources.some((s) => s.id === snapshotSourceId)) {
    throw new Error(`reference-sources.json needs a source with id "${snapshotSourceId}" describing this snapshot`);
  }
  const studies: Trial[] = [];
  const trialSources: Source[] = [];
  const needsReview: Record<string, string[]> = {};
  for (const id of [...candidates.keys()].sort()) {
    const s = candidates.get(id)!;
    const summary = summaries.get(id) ?? '';
    const interventionNames = (interventions.get(id) ?? []).sort((a, b) => a.id - b.id).map((i) => i.name);
    if (!s.brief_title.trim() || !summary || interventionNames.length === 0) { exclude('missing-required-field'); continue; }
    const sourceId = sourceIdFor(id);
    const sourceUrl = `https://clinicaltrials.gov/study/${id}`;
    const loc = usFacility.get(id)!;
    const { demographics, needsReview: review } = buildDemographics(baseline.get(id) ?? [], groups, groupCounts, sourceId);
    if (review.length) needsReview[id] = review;
    studies.push({
      nctId: id,
      title: s.brief_title.trim(),
      summary,
      conditions: (conditions.get(id) ?? []).map((c) => c.name).filter(Boolean),
      interventions: interventionNames,
      status: 'COMPLETED',
      studyType: 'INTERVENTIONAL',
      hasResults: true,
      usLocation: { country: 'United States', facility: loc.facility, city: loc.city, state: loc.state, sourceIds: [sourceId] },
      completionDate: parseCompletionDate(s.completion_month_year),
      enrollment: parseCount(s.enrollment),
      enrollmentType: s.enrollment_type.trim() || null,
      sourceUrl,
      sourceIds: [sourceId, snapshotSourceId],
      demographics,
    });
    const posted = s.study_first_posted_date.trim();
    trialSources.push({
      id: sourceId,
      author: `${s.source.trim() || 'Responsible party not listed'}; ClinicalTrials.gov, U.S. National Library of Medicine`,
      title: `${s.brief_title.trim()} (${id})`,
      publicationDate: datePattern.test(posted) ? posted : null,
      url: sourceUrl,
      accessedDate,
      supports: [
        `Registry title, summary, conditions, interventions, status, completion date and enrollment, as recorded in the AACT snapshot dated ${snapshotDate}.`,
        'Listed U.S. facility used as evidence of a U.S. study site.',
        'Posted baseline characteristics used for age, sex, gender, race and ethnicity.',
      ],
    });
  }
  funnel.included = studies.length;

  const registry: SourceRegistry = { schemaVersion: '1.0', sources: [...reference.sources, ...trialSources] };
  const e = funnel.excluded;
  const dataset: TrialDataset = {
    schemaVersion: '1.0',
    snapshotDate,
    limitedSample: false,
    cohort: {
      description: 'Completed interventional type 2 diabetes trials with posted results and at least one listed U.S. facility.',
      inclusionRules: [
        'Overall status is Completed.',
        'Study type is Interventional.',
        'Results have been posted.',
        'At least one condition listed by the investigators names type 2 diabetes (conditions that only describe at-risk, prevention or healthy-volunteer groups do not count).',
        'At least one listed facility is in the United States. This shows a U.S. site, not that every participant was U.S.-based.',
      ],
      selectionMethod:
        `Every study in the AACT ClinicalTrials.gov snapshot dated ${snapshotDate} that meets all inclusion rules: ${studies.length} of ${funnel.considered.toLocaleString('en-US')} registry records. ` +
        `Excluded: ${(e['not-completed'] + e['not-interventional'] + e['no-posted-results']).toLocaleString('en-US')} not completed, not interventional or without posted results; ` +
        `${e['no-type-2-diabetes-condition'].toLocaleString('en-US')} without a type 2 diabetes condition; ` +
        `${e['type-2-diabetes-only-in-at-risk-or-healthy-condition']} naming type 2 diabetes only for at-risk, prevention or healthy-volunteer groups; ` +
        `${e['no-us-facility']} without a listed U.S. facility; ${e['missing-required-field']} missing a title, summary or intervention; ` +
        `${e['invalid-nct-id'] + e['duplicate-nct-id']} with invalid or duplicated IDs. Studies are not excluded for missing demographic data.`,
      sourceIds: [snapshotSourceId, 'aact-overview', 'tasneem-2012-aact'],
    },
    studies,
  };
  validateDataset(dataset, validateSources(registry));
  const report: BuildReport = { funnel, matchedConditionNames, usListedOnlyAsRemovedCountry: removedUs.size, needsReview };
  return { dataset, registry, report };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string', default: process.env.AACT_DIR },
    accessed: { type: 'string' },
    out: { type: 'string', default: 'public/data' },
  } });
  if (!values.input || !values.accessed) {
    throw new Error('Usage: npm run data:build -- --input <AACT table folder> --accessed <YYYY-MM-DD download date>');
  }
  const reference = validateSources(JSON.parse(readFileSync(resolve('scripts/data/reference-sources.json'), 'utf8')));
  const { dataset, registry, report } = await buildDataset(resolve(values.input), values.accessed, reference);
  const reviewIds = Object.keys(report.needsReview);
  if (reviewIds.length) {
    console.error(json(report.needsReview));
    throw new Error(`${reviewIds.length} studies have demographic-looking baseline titles that are not reviewed. Classify them in scripts/data/normalize.ts.`);
  }
  writeFileSync(resolve(values.out, 'trials.json'), json(dataset));
  writeFileSync(resolve(values.out, 'sources.json'), json(registry));
  console.log(json({ snapshotDate: dataset.snapshotDate, ...report.funnel, usListedOnlyAsRemovedCountry: report.usListedOnlyAsRemovedCountry }));
  console.log(`Wrote ${dataset.studies.length} studies and ${registry.sources.length} sources to ${values.out}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
