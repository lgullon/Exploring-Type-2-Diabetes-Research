# Who Was Studied?

A public research explorer for students, journalists, and community members interested in type 2 diabetes trials. It covers all 981 completed, interventional type 2 diabetes trials with posted results and a listed U.S. site in a dated AACT snapshot of ClinicalTrials.gov (data as of 2026-11-17), and shows who participated as each study reported it. It informs research exploration; it does not recommend treatments.

## Run locally

Use **Node 24 LTS** (`.nvmrc`) and npm. Packages require Node 22.12 or newer; Node 24 is the supported development/CI version.

```sh
git clone https://github.com/lgullon/Exploring-Type-2-Diabetes-Research.git
cd Exploring-Type-2-Diabetes-Research
# If using nvm:
nvm use
npm ci
npm run dev
```

Open the Vite URL at `/Exploring-Type-2-Diabetes-Research/`.

```sh
npm run typecheck
npm test -- --run
npm run build
npm run preview
```

The production preview is normally `http://localhost:4173/Exploring-Type-2-Diabetes-Research/`. Preview is local, not public hosting. `npm test` starts Vitest's watch mode. No credentials, database, API key, or extraction step is needed to run the site. On Windows PowerShell, if `npm` is blocked by the script execution policy, use `npm.cmd` (for example `npm.cmd run dev`).

## Rebuild the dataset (optional)

```sh
npm run data:build -- --input <folder of extracted AACT tables> --accessed <download date YYYY-MM-DD>
```

This reads an AACT flat-file export, applies the cohort rules, and rewrites `public/data/trials.json` and `public/data/sources.json`. Identical input produces byte-identical output. The raw export needs a free AACT account, is about 18 GB unzipped, and is never committed. See [docs/methodology.md](docs/methodology.md) for the exact snapshot, checksums, and refresh steps.

## Implemented scope

- Browse titles, summaries, conditions, interventions, enrollment, completion dates, and evidence of a U.S. location for every study in the cohort.
- Search titles, summaries, conditions, and interventions using one reusable candidate-selection rule. Results show 50 at a time.
- Per study, see participant demographics as posted: one table per measure, with categories as rows, study groups and the Total as columns, the confirmed number analyzed, and notes on anything ambiguous.
- Open original records, inspect citations, and download the dated JSON dataset.
- See the snapshot date, cohort rules, and limitations.
- Use a responsive keyboard-accessible interface with explicit loading, load-error/retry, empty-data, and no-results states.

**Search rule (shared).** Search normalizes case, punctuation and accents, then matches **any distinct query token** against the **start of** whole words in the four searchable fields: "metfor" matches "metformin", but "formin" does not. An empty or whitespace-only query shows all studies; punctuation-only queries match nothing. Results use ascending NCT-ID order. There is no weighted ranking or treatment recommendation. Weighted ranking and evaluation must reuse `searchStudies` in `src/search.ts` so they share this candidate rule. (Until 2026-11-20 the rule matched only complete words.)

## Data and extension points

| File | Role |
| --- | --- |
| `src/data/types.ts` | Shared contract and authoritative field definitions |
| `src/data/validate.ts` | Runtime validation of dataset, citations, and missingness |
| `public/data/trials.json` | Dated public dataset, loaded and downloaded unchanged |
| `public/data/sources.json` | Single citation registry with stable IDs |
| `scripts/data/` | AACT extraction pipeline (`npm run data:build`), its tests, and non-trial citations (`reference-sources.json`) |
| `src/search.ts` | Shared search normalization and candidate selection |
| `src/App.tsx` | Browser, study details, citations, and load states |
| `src/DemographicTables.tsx` | Per-study demographic tables |
| `docs/methodology.md` | Snapshot, cohort rules and counts, field mapping, verification, limitations, refresh procedure |

The dataset is a complete extract of the stated cohort from the AACT snapshot dated 2026-11-17 (`limitedSample: false`). It is not representative of all diabetes research. Each study cites its original ClinicalTrials.gov record and the AACT snapshot.

Demographics come only from posted baseline characteristics. Every study's age, sex, gender, race and ethnicity fields are `reported` or `not-reported`; none are `not-extracted`. Sex and gender stay separate, and each measure stays under the label the study used. Combined race/ethnicity measures are not split. Arm rows and the Total row are never added together, and no percentages are computed. Denominators are stored only when the posted counts confirm them, because AACT's "number analyzed" values were wrong for most measures in this snapshot; 15% of values have an unknown denominator. A field is `reported` only when it has at least one posted value from participants analyzed. When a study posts the same measure title more than once, each posting is kept separate (`measureInstance`). Eligibility criteria are not observed demographics. A U.S. site does not mean all participants were U.S.-based. Reporting completeness does not establish research quality, validity, or clinical suitability. Details and counts are in [docs/methodology.md](docs/methodology.md).

**For later stages.** Ranking should reuse `searchStudies` for candidates and may use each demographic field's `status` for reporting completeness (age, sex-or-gender, race, ethnicity); `notes` explain ambiguous cases and should not be treated as missing data. Comparison work can reuse or restyle `DemographicTables.tsx` (group rows by `measureLabel` and `measureInstance`, never by label alone); categories differ between studies and must not be pooled across incompatible labels or denominators. Evaluation should use the same candidate rule as the keyword baseline.

## Deployment

Vite's base is `/Exploring-Type-2-Diabetes-Research/`; data loading uses `import.meta.env.BASE_URL`. Update the base if the repository name changes. There are no client-side routes requiring a server fallback.

Pull requests run installation, type checking, tests, and production build in `.github/workflows/check.yml`. After a reviewed merge to `main`, `.github/workflows/deploy.yml` repeats these checks and deploys `dist` to GitHub Pages. Manual deployment is restricted to `main`. No secrets are needed.

**Live status:** `https://lgullon.github.io/Exploring-Type-2-Diabetes-Research/` returned HTTP 200 on 2026-11-20. It serves whatever is merged to `main`; until the AACT dataset is merged it still shows the seven-record sample dated 2026-11-06. After each deployment, check without a team login: data loading, search/no matches, original-source links, and JSON download.

Configuration follows [Vite deployment](https://vite.dev/guide/static-deploy.html). Compatibility was checked against [Vite setup](https://vite.dev/guide/), [React versions](https://react.dev/versions), and [Vitest setup](https://vitest.dev/guide/). The committed lockfile fixes installed versions.

## Maintenance and release limits

Follow the refresh steps in `docs/methodology.md` when updating data. Change the snapshot date only when the data is actually rebuilt from a newer export, run the commands above, and review before merging. If updates stop, the site remains a dated archive of its snapshot; do not imply archived data is current. No update schedule or maintenance commitment has been agreed.

This implementation used AI assistance. The team will supply its course-required public-product disclosure and designated maintenance/grading contact before final public release. Those texts are pending team approval; this README does not substitute for the product disclosure. Human review, merge, and public verification remain release steps. Course submissions and teammate messages are handled separately by the team.
