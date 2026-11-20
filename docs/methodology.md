# Data methodology

This document explains where `public/data/trials.json` and `public/data/sources.json` come from, which rules decide what is included, how each field is mapped, what was checked, and how to rebuild or refresh the data. The shared contract is `src/data/types.ts`; runtime validation is `src/data/validate.ts`. Source IDs in brackets refer to entries in `public/data/sources.json`.

## Snapshot and input

| Item | Value |
| --- | --- |
| Data as of | **2026-11-17**: the newest `last_update_posted_date` in the export. AACT's own reload ran from 2026-11-16 to 2026-11-18. |
| Input file | `20261118_export_ctgov.zip`, the AACT pipe-delimited flat-file export, downloaded 2026-11-18 [aact-snapshot-2026-11-17] |
| Zip SHA-256 | `6f80d7298d5e3398852b82b60a31e15a03e138cbd2e564e161740318aa7e3822` (2,453 MB) |
| Tables read | `studies`, `conditions`, `countries`, `facilities`, `brief_summaries`, `interventions`, `result_groups`, `baseline_counts`, `baseline_measurements` |
| Access | Downloads require a free AACT account. The raw export is not committed (about 18 GB unzipped) and is never needed to run the site. |

AACT is a relational copy of ClinicalTrials.gov built for aggregate analysis [aact-overview, tasneem-2012-aact]. Every study also cites its original ClinicalTrials.gov record (`ctgov-nct…`), which is the authoritative source.

SHA-256 of each extracted table, for confirming identical input:

```
c11871a255e078fe1808a56f1e1da81ece64337615110ae618e9dba69a65e739  studies.txt
2978e643535bf0f8775a2032369ebb255337fe248355e342ccb52e9758dcee7d  conditions.txt
44fb31820c31ec60bba2a7fd931d66d98be73b1a8465387e2d60991df1450fc4  countries.txt
171558b0042350365de83f65c63c93ac5b844d25afcedd4b6155e7932c7117ba  facilities.txt
9fc8dcb9fcf83a86cd16b5de397695ab9c07b84b8f0948ffdf68b98fb10be5ca  brief_summaries.txt
2833c5acda3c8f9fe78841822c91e4ff2944fc6309faf1f37bb07913103747ca  interventions.txt
03d8fc9e3db41f042272c0144bb33f7b9ab790ac4bcc3914ba7da1885d5d874f  result_groups.txt
c281fce809257f23f1273727a96901c031b1b4c829ed1d13a768f5a6ff9be0c0  baseline_counts.txt
abba7b895bb994fc152f35de42e2f42d0c0ef7a21b65602692df2bc07880817f  baseline_measurements.txt
```

## Cohort rules and counts

The dataset contains **every** study in the snapshot that meets all five rules. It is a complete extract of this cohort (`limitedSample: false`), not a sample. It is not representative of all diabetes research.

| Step | Rule | Excluded | Remaining |
| --- | --- | ---: | ---: |
| | All registry records in the export | | 612,286 |
| 1 | Valid, unique NCT ID | 0 | 612,286 |
| 2 | `overall_status` is `COMPLETED` | 276,987 | 335,299 |
| 3 | `study_type` is `INTERVENTIONAL` | 72,867 | 262,432 |
| 4 | Results posted (`results_first_posted_date` present) | 199,234 | 63,198 |
| 5a | A listed condition names type 2 diabetes | 61,599 | 1,599 |
| 5b | ...and that condition is not only an at-risk, prevention or healthy-volunteer description | 3 | 1,596 |
| 6 | At least one listed U.S. facility | 615 | 981 |
| 7 | Has a title, a summary and at least one intervention | 0 | **981** |

Studies are never excluded because demographic data is missing.

### Type 2 diabetes condition rule

A study is included when at least one condition in `conditions.name` (as written by the investigators) names type 2 diabetes. Matching is case-insensitive and accepts:

- "type 2", "type II", "type two" or "type2" in the same condition as "diabet" or "DM" (for example "Diabetes Mellitus, Type 2", "Type2Diabetes", "type2dm");
- the abbreviations T2D, T2DM and NIDDM;
- "non-insulin-dependent" or "adult-onset" together with "diabet".

A matching condition that contains "at risk", "risk of", "prevent…" or "healthy" does not count on its own (for example "At Risk of Type 2 Diabetes Mellitus"). Three studies were excluded for this reason.

**Mixed conditions are kept.** Studies listing type 2 diabetes alongside other conditions (for example type 1 diabetes, chronic kidney disease or hypertension) are included, and every listed condition is preserved in `conditions`.

**MeSH terms were considered and not used for inclusion.** AACT's `browse_conditions` table holds MeSH terms assigned by an NLM algorithm [tasneem-2012-aact]. Among completed interventional studies with results in this snapshot, 82 carried the type 2 diabetes MeSH term without any listed condition naming it (and 62 named it without the MeSH term). Examples include conditions listed only as "Hepatitis B", "Healthy Volunteers" or "Gastroparesis". Requiring the investigators' own wording avoids those false matches. The cost is that a study listing only "Diabetes" or "Diabetes Mellitus" is not included even if its participants had type 2 diabetes.

### U.S. location rule

A study needs at least one row in `facilities` with `country` equal to `United States` and at least one of facility name, city or state. The first such facility (lowest AACT row ID) is stored as `usLocation`. For the type 2 diabetes studies in this snapshot, the `countries` table (current entries) and the facility list identified exactly the same 981 studies with a U.S. location.

A listed U.S. facility shows that the study had a U.S. site. It does not mean all participants were U.S.-based or that anyone enrolled at that particular site. A further 82 type 2 diabetes studies listed the United States only as a removed country (`countries.removed = t`) with no current U.S. facility; they are excluded.

## Field mapping

| Contract field | AACT source | Rule |
| --- | --- | --- |
| `nctId` | `studies.nct_id` | Must match `NCT` plus 8 digits; duplicated IDs are excluded entirely. |
| `title` | `studies.brief_title` | Trimmed, otherwise unchanged. |
| `summary` | `brief_summaries.description` | Kept exactly. AACT writes line breaks as `~`; these are not converted, because a real tilde would be indistinguishable. |
| `conditions` | `conditions.name` | All conditions, in AACT row order. |
| `interventions` | `interventions.name` | All intervention names, in AACT row order. |
| `status`, `studyType`, `hasResults` | `studies.overall_status`, `studies.study_type`, `studies.results_first_posted_date` | Fixed by the cohort rules. |
| `completionDate` | `studies.completion_month_year` | Keeps the registry's precision: year, month (464 studies) or day (495 studies). The `completion_date` column is not used because AACT fills in a last-of-month day for month-only dates. 22 studies have no date (`null`). |
| `enrollment`, `enrollmentType` | `studies.enrollment`, `studies.enrollment_type` | Whole numbers only; missing is `null`, never 0. Enrollment is study-wide and is not a demographic denominator. |
| `usLocation` | `facilities` | See the U.S. location rule. |
| `sourceUrl`, `sourceIds` | | `https://clinicaltrials.gov/study/{NCT ID}`, citing the original record and the AACT snapshot. |
| `demographics` | `baseline_measurements`, `result_groups`, `baseline_counts` | See below. |

Each study gets a citation entry: author is the responsible party (`studies.source`) and ClinicalTrials.gov; `publicationDate` is the record's first-posted date; `accessedDate` is the AACT download date.

## Demographics

Values come only from each study's posted **baseline characteristics** (who actually enrolled). Eligibility criteria (who could enroll) are never used. Only study-level group summaries are used; there is no participant-level data.

### Which measures count

Measures are matched by their exact registry title (case and spacing ignored), and each goes in the field its own label names. Nothing is reclassified, and no values are inferred.

| Field | Titles | Note added |
| --- | --- | --- |
| age | Age, Continuous; Age Continuous; Age, Categorical; Age, Customized; Age Range; Age Group; Age at Screening; and three female-only age titles | |
| sex | Sex: Female, Male; Parent-reported sex of their child: female | |
| sex | Sex/Gender, Customized | Categories may describe sex, gender or both (21 studies) |
| gender | Gender | Kept as labeled, not reclassified as sex (38 studies) |
| race | Race (NIH/OMB); Race | |
| race | Race/Ethnicity, Customized; Race/Ethnicity; Race-Ethnicity | Combined measure, not split into race and ethnicity (238 studies) |
| ethnicity | Ethnicity (NIH/OMB); Ethnicity | |

Sex and gender are kept separate, following the distinction in the SAGER reporting guidelines [heidari-2016-sager].

**Review safeguard.** Any other baseline title, classification or category containing a demographic word (age, sex, gender, male, female, women, men, race, ethnic, Hispanic, Latino, White, Black, Asian, Caucasian, African) stops the build until it is reviewed. Ten such titles were reviewed and confirmed not to be participant demographics (for example "Age at onset of diabetes", "Gestational age diagnosed", BMI reported separately for men and women, and "Child-Bearing Status"). They are listed with reasons in `REVIEWED_NOT_DEMOGRAPHIC` in `scripts/data/normalize.ts`.

### Status

Every study in the cohort has posted results, and all of its baseline titles were inspected. So each field is either:

- **reported**: at least one matching measure, or
- **not-reported**: no matching measure in the posted baseline table. If the study posted the registry's "Race and Ethnicity Not Collected" statement (30 studies), race and ethnicity carry a note saying so.

No field is left `not-extracted`. Missing reporting is shown, never hidden, because incomplete race/ethnicity reporting is common in ClinicalTrials.gov results [turner-2022-race-ethnicity-reporting].

| Field | Reported | Not reported |
| --- | ---: | ---: |
| Age | 981 | 0 |
| Sex | 945 | 36 |
| Gender | 38 | 943 |
| Sex or gender (either) | 981 | 0 |
| Race | 632 | 349 |
| Ethnicity | 391 | 590 |

Reporting completeness is not a measure of study quality, validity or clinical relevance.

### Measures

Each measure row keeps:
- the original title (`measureLabel`);
- the category (`categoryLabel`), with AACT's classification and category joined by " / " when both are present;
- the value exactly as posted (a number, the original text, or `null` when the study posted "NA", with a note giving the study's explanation);
- the unit and statistic type (`param_type`, for example `COUNT_OF_PARTICIPANTS` or `MEAN`);
- the result group as `population` (group title and code, for example "Placebo (BG001)").

Arm rows and the Total row are kept separate and are never added together. No percentages are calculated and no categories are combined. Measures of spread (standard deviations, ranges) are not stored, because the contract has no field for them.

### Denominators and the AACT "number analyzed" problem

For most measures in this snapshot, AACT's `baseline_measurements.number_analyzed` did not match ClinicalTrials.gov. For example, in NCT00032487 AACT lists 56, 13 and 26 participants analyzed for sex, while the posted groups had 899, 892 and 1,791 participants and the sex counts add up to exactly those numbers. ClinicalTrials.gov lists no separate per-measure count for that study.

Across single-level sex, race, ethnicity and categorical age measures, 6,047 of 6,679 group-level measures had a category total equal to the group's baseline count but a different AACT "number analyzed". Only 32 had a genuinely smaller per-measure count.

So a denominator is stored only when it can be confirmed:

1. AACT's value is used when it equals the group's baseline participant count (`baseline_counts`) or the measure's category total.
2. Otherwise the group's baseline count is used when the categories add up to it.
3. Otherwise the denominator is `null` with a note.

Category totals are only computed for single-level participant counts (`COUNT_OF_PARTICIPANTS`, or `NUMBER` in participant units). As a result, 5,283 of 32,652 measure values (16%) have an unknown denominator. These are mostly means, such as average age, and percentages, where nothing can be cross-checked. When the categories of a count measure do not add up to the confirmed denominator, a note says so; the values are not changed.

## Verification

**Automated:** `npm test -- --run` runs the contract validation and pipeline tests. These cover the cohort rules and counts, partial dates, missing values, duplicated and invalid IDs, denominator confirmation and mismatches, multi-line quoted text, the review safeguard, and byte-identical output. The fixtures in `scripts/data/fixtures/aact/` are invented records.

**Against original records (2026-11-20):** 8 exported studies were compared field by field with their original ClinicalTrials.gov records, retrieved from the ClinicalTrials.gov API rather than from AACT. Six were chosen for difficult cases: NCT00032487, NCT01730534, NCT00518115, NCT00147745, NCT00179400 and NCT02004366. Two were chosen at random: NCT00528372 and NCT03837405.

- 88 study fields checked (title, summary, conditions, interventions, status, type, results, completion date, enrollment, U.S. site and source link): no discrepancies.
- 532 demographic values checked (value, unit, statistic type, group and denominator): no discrepancies. Every stored denominator matched ClinicalTrials.gov. The only differences were 19 values the study itself posted as "NA", which are stored as `null` with a note, as intended.
- For these 8 studies, no posted age, sex, gender, race or ethnicity measure was missing from the export, so each "not reported" status was correct.

This check found the denominator problem described above and led to two fixes before release. Eight studies is a spot check, not proof that every record is correct.

## Limitations

- The dataset reflects ClinicalTrials.gov as of 2026-11-17. Records can change after that date.
- Inclusion depends on investigators naming type 2 diabetes in the condition list; studies listing only "Diabetes" are missed.
- A U.S. facility does not mean U.S. participants.
- Demographics are only as complete as each study's posting. Labels vary between studies and are kept as posted, so categories are not always comparable across studies.
- 16% of measure values have an unknown denominator, and measures of spread are not stored.
- Summaries keep AACT's `~` line-break markers.

## Rebuilding and refreshing

The website only reads the committed JSON. Running the pipeline is needed only to reproduce or refresh the data.

**Reproduce this snapshot:**

1. Sign in at https://aact.ctti-clinicaltrials.org and download the pipe-delimited flat-file export `20261118_export_ctgov.zip` from AACT's snapshot archive. Confirm its SHA-256 matches the value above. Whether AACT keeps this exact daily file available long term has not been confirmed. If it is gone, follow the refresh steps instead; a new snapshot will not be byte-identical.
2. Extract only the needed tables into a folder outside the repository, for example:
   `tar -xf 20261118_export_ctgov.zip -C <folder> studies.txt conditions.txt countries.txt facilities.txt brief_summaries.txt interventions.txt result_groups.txt baseline_counts.txt baseline_measurements.txt`
3. Run `npm run data:build -- --input <folder> --accessed 2026-11-18`. On Windows PowerShell, use `npm.cmd` if scripts are blocked. This takes about 35 seconds.
4. `git diff --stat -- public/data` should show no changes. The committed files have these SHA-256 values:
   `trials.json d2a6ac56df4769bb67dbaf819c616d3b36e43f93d65755b92ca805d818e59b04`,
   `sources.json 9a1ad1e7a03bce8ca203b0c044ccc20e24c4a48757ac2f9c348be78c5dee45ab`.

**Refresh to a newer snapshot:**

1. Download and extract a newer export as above, and record its file name and SHA-256.
2. Add an `aact-snapshot-YYYY-MM-DD` entry to `scripts/data/reference-sources.json`, describing the new file and checksum. The build stops with a message if this is missing.
3. Run `npm run data:build -- --input <folder> --accessed <download date>`. If the build stops on unreviewed demographic titles, review each one in the source records and add it to `TITLE_RULES` or `REVIEWED_NOT_DEMOGRAPHIC` in `scripts/data/normalize.ts`.
4. Update the snapshot date and study count in `src/data/validate.test.ts`, then run `npm run typecheck`, `npm test -- --run` and `npm run build`.
5. Spot-check several records against ClinicalTrials.gov, update the counts and checksums in this document, and open a pull request for review.

The checked-in snapshot does not update automatically. If maintenance stops, the site remains a dated archive of this snapshot; the visible snapshot date must not be changed unless the data is actually refreshed.
