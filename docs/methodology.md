# Sample methodology

Snapshot date: **2026-11-06**. This Stage 1 sample was checked directly against original ClinicalTrials.gov API v2 records, not extracted from AACT. There is no production extraction pipeline in this version.

## Selection and inclusion

Seven recognizable cardiovascular or renal outcome trials in type 2 diabetes were selected purposively by NCT ID. This is a convenience sample weighted toward large drug trials, not a systematic search or a representative sample of diabetes research. No effect estimates or treatment conclusions are extracted.

Each record was retrieved from `https://clinicaltrials.gov/api/v2/studies/{NCT_ID}` and checked for all five rules:

1. `protocolSection.statusModule.overallStatus` is `COMPLETED`.
2. `protocolSection.designModule.studyType` is `INTERVENTIONAL`.
3. Conditions or the brief summary explicitly describe type 2 diabetes.
4. Top-level `hasResults` is true and `resultsSection` exists.
5. At least one `protocolSection.contactsLocationsModule.locations` entry has `country` equal to `United States`.

The sample contains NCT00968708, NCT01131676, NCT01144338, NCT01179048, NCT01394952, NCT01730534 and NCT02065791. Each original record is a substantive source in `public/data/sources.json`; the records support the study's identity and inclusion evidence. The AACT overview is separate database background, not the origin of this sample.

## Field mapping

`src/data/types.ts` is the authoritative contract. Runtime validation is in `src/data/validate.ts`; this document explains provenance rather than redefining the schema.

- `title` and `summary`: original `identificationModule.briefTitle` and `descriptionModule.briefSummary`, retained as registry text.
- `conditions`: `conditionsModule.conditions`; `interventions`: names from `armsInterventionsModule.interventions`.
- `status`, `studyType`, `hasResults`: fields used in the inclusion checks above.
- `usLocation`: the first listed U.S. site, retaining facility, city and state as available. This is evidence of a listed location, not a statement that every participant was U.S.-based, or that anyone enrolled at that particular site.
- `completionDate`: `statusModule.completionDateStruct.date`, preserving the supplied day, month or year precision. Missing dates remain null.
- `enrollment` and `enrollmentType`: `designModule.enrollmentInfo.count` and `.type`. Trial-wide enrollment is not a demographic denominator and may differ from the population analyzed in results.
- `sourceUrl` links to the original record. `sourceIds` link to the single shared citation registry. Citation `publicationDate` is the record's first-posted date, not a journal publication date; `accessedDate` is the verification date. Sources without an available date use null.
- Age, sex, gender, race and ethnicity are deliberately **not-extracted**. This does not mean those trials failed to report them. Eligibility limits are not used as observed participant demographics.

No arms or populations were pooled, no percentages inferred, and no intersectional demographic values invented. Reporting completeness is not a measure of study quality, validity or clinical suitability.

## Replacement and maintenance

Lindsay's next stage can replace the sample with a reproducible AACT extract while preserving the contract. Preserve original measure/category labels, units/statistics, population labels, denominators and references when adding observed demographics. Keep sex and gender separate. Use `not-reported` only after checking the relevant result source; use `not-extracted` when extraction has not been done. Unknown values and denominators stay null, never zero.

For each update, verify inclusion from the source, refresh the snapshot/access dates, update citation records, run the data tests and all README checks, then review the built interface and downloadable JSON. Do not change `limitedSample` to false without evidence that the stated cohort was completely extracted. Do not overwrite an earlier snapshot's date merely because the app was rebuilt.

This checked-in snapshot does not update automatically. The site must remain visibly dated if maintenance stops. The team must designate its maintenance/grading contact and approve final product disclosure before final public release; no update frequency or owner is promised here.
