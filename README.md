# Who Was Studied?

A public research explorer for students, journalists, and community members interested in type 2 diabetes trials. Stage 1 provides a static browse/search application over seven dated, source-checked ClinicalTrials.gov records. It informs research exploration; it does not recommend treatments.

## Run locally

Use **Node 24 LTS** (`.nvmrc`) and npm. Packages require Node 22.12 or newer; Node 24 is the supported development/CI version.

```sh
git clone https://github.com/lgullon/Exploring-Type-2-Diabetes-Research.git
cd Exploring-Type-2-Diabetes-Research
# Before the foundation PR merges:
git switch feature/foundation
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

The production preview is normally `http://localhost:4173/Exploring-Type-2-Diabetes-Research/`. Preview is local, not public hosting. `npm test` starts Vitest's watch mode. No credentials, database, API key, or extraction step is needed.

## Implemented scope

- Browse titles, summaries, conditions, interventions, enrollment, completion dates, and evidence of a U.S. location.
- Search titles, summaries, conditions, and interventions using one reusable candidate-selection rule.
- Open original records, inspect citations, and download the dated JSON sample.
- See sample selection, snapshot date, demographic extraction status, and limitations.
- Use a responsive keyboard-accessible interface with explicit loading, load-error/retry, empty-data, and no-results states.

Search normalizes case and punctuation and matches **any distinct query token** against whole tokens in the four searchable fields. An empty or whitespace-only query shows all studies; punctuation-only queries have no matching tokens and show no results. Results use ascending NCT-ID order. There is no weighted ranking or treatment recommendation.

## Data and extension points

| File | Role |
| --- | --- |
| `src/data/types.ts` | Shared contract and authoritative field definitions |
| `src/data/validate.ts` | Runtime validation of dataset, citations, and missingness |
| `public/data/trials.json` | Dated public snapshot, loaded and downloaded unchanged |
| `public/data/sources.json` | Single citation registry with stable IDs |
| `src/search.ts` | Shared search normalization and candidate selection |
| `src/App.tsx` | Browser, study details, citations, and load states |
| `docs/methodology.md` | Source mapping, selection, and update procedure |

The 2026-11-06 sample uses directly verified ClinicalTrials.gov records, **not an AACT extraction**. All seven trials are completed, interventional, concern type 2 diabetes, have posted results, and have evidence of a U.S. location. This convenience sample is neither a census nor representative. Original trial records in the registry provide substantive project evidence.

Demographics are intentionally `not-extracted`; this does not mean a study failed to report them. Age, sex, gender, race, and ethnicity remain separate. Eligibility criteria are not observed demographics. Enrollment may describe an international population; a U.S. location does not make all participants U.S.-based. Missing values remain null. Dates retain their source precision. Reporting completeness does not establish research quality, validity, or clinical suitability. Do not pool incompatible arms or infer intersectional demographics.

Lindsay can replace the snapshot and registry while preserving the contract and validation tests. Update the sample-specific count/date assertions and visible provenance/sample labels when replacing this snapshot. Giulia should reuse the search helper. Planned later work: reproducible AACT extraction/provenance (Lindsay), adjustable explained ranking (Giulia), study/demographic comparison and public-content refinement (Leena), and evaluation/release verification (Archi). These features are not implemented here.

## Deployment

Vite's base is `/Exploring-Type-2-Diabetes-Research/`; data loading uses `import.meta.env.BASE_URL`. Update the base if the repository name changes. There are no client-side routes requiring a server fallback.

Pull requests run installation, type checking, tests, and production build in `.github/workflows/check.yml`. After a reviewed merge to `main`, `.github/workflows/deploy.yml` repeats these checks and deploys `dist` to GitHub Pages. Manual deployment is restricted to `main`. No secrets are needed.

**Owner action:** Repository **Settings → Pages → Build and deployment → Source → GitHub Actions**. The implementation account has push access but no administration access; an owner must enable Pages. No broader access is needed. Pages/OIDC write permissions are limited to the deployment job.

**Live status:** Not deployed or publicly verified. Expected address after setup and merge: `https://lgullon.github.io/Exploring-Type-2-Diabetes-Research/` (not a verified working link). After deployment, check without a team login: data loading, search/no matches, original-source links, and JSON download. Record the verified URL and accepted merge SHA in the human handoff.

Configuration follows [Vite deployment](https://vite.dev/guide/static-deploy.html). Compatibility was checked against [Vite setup](https://vite.dev/guide/), [React versions](https://react.dev/versions), and [Vitest setup](https://vitest.dev/guide/). The committed lockfile fixes installed versions.

## Maintenance and release limits

Follow `docs/methodology.md` when updating records. Change snapshot/access dates only when records are rechecked, run the commands above, and review before merging. If updates stop, retain the dated sample as an archive; do not imply archived data is current. No update schedule or maintenance commitment has been agreed.

This implementation used AI assistance. The team will supply its course-required public-product disclosure and designated maintenance/grading contact before final public release. Those texts are pending team approval; this README does not substitute for the product disclosure. Human review, merge, owner Pages setup, and public verification remain release steps. Course submissions and teammate messages are handled separately by the team.
