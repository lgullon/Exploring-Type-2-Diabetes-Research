/** Version 1 is a bounded public snapshot, not a general clinical-data model. */
export type PartialDate = { value: string; precision: 'year' | 'month' | 'day' };

export type DemographicMeasure = {
  measureLabel: string;
  categoryLabel: string | null;
  value: number | string | null;
  unit: string | null;
  statisticType: string | null;
  /** Preserve the original population or arm. Do not pool incompatible groups. */
  population: string;
  denominator: number | null;
  sourceIds: string[];
};

export type DemographicField = {
  /** not-extracted makes no claim about whether the source reports the field. */
  status: 'reported' | 'not-reported' | 'not-extracted';
  measures: DemographicMeasure[];
  sourceIds: string[];
};
export const demographicKeys = ['age', 'sex', 'gender', 'race', 'ethnicity'] as const;
export type Demographics = Record<(typeof demographicKeys)[number], DemographicField>;

export type Trial = {
  nctId: string;
  title: string;
  summary: string;
  conditions: string[];
  interventions: string[];
  status: 'COMPLETED';
  studyType: 'INTERVENTIONAL';
  hasResults: true;
  /** One listed U.S. site is evidence of location, not participant residence. */
  usLocation: {
    country: 'United States';
    facility: string | null;
    city: string | null;
    state: string | null;
    sourceIds: string[];
  };
  completionDate: PartialDate | null;
  enrollment: number | null;
  enrollmentType: string | null;
  sourceUrl: string;
  sourceIds: string[];
  demographics: Demographics;
};

export type TrialDataset = {
  schemaVersion: '1.0';
  snapshotDate: string;
  limitedSample: boolean;
  cohort: {
    description: string;
    inclusionRules: string[];
    selectionMethod: string;
    sourceIds: string[];
  };
  studies: Trial[];
};

export type Source = {
  id: string;
  author: string;
  title: string;
  publicationDate: string | null;
  url: string;
  accessedDate: string;
  supports: string[];
};
export type SourceRegistry = { schemaVersion: '1.0'; sources: Source[] };
