// Driver compliance at dispatch (01 §6 C27, implementation-brief §8). Decided by the
// product owner 2026-09-30: an assignment is NEVER refused for compliance in this release
// (Runtruck1 allowed it, D6); instead every problem is recorded as a `complianceWarnings`
// entry in the LOAD_CREATED / LOAD_ASSIGNED audit record. The rule can later become
// blocking (09 §3.2 D3) by turning a non-empty result into a refusal.

export type DriverDocumentType = 'cdl' | 'medical_card' | 'mvr' | 'annual_review' | 'drug_test' | 'clearinghouse_query';

// A row of the driver's qualification file (driver_documents): expires_on null = missing.
export interface DriverDocumentFact {
  documentType: DriverDocumentType;
  expiresOn: string | null;
}

export interface ComplianceWarning {
  driverId: string;
  documentType: DriverDocumentType;
  problem: 'expired' | 'missing';
  // YYYY-MM-DD when the document has a date.
  expiresOn: string | null;
  message: string;
}

// Documents a driver must hold with a date that has not passed (expired CDL or medical card).
export const DATED_DRIVER_DOCUMENTS: readonly DriverDocumentType[] = ['cdl', 'medical_card'];

const LABEL: Readonly<Record<DriverDocumentType, string>> = {
  cdl: 'CDL',
  medical_card: 'Medical card',
  mvr: 'MVR',
  annual_review: 'Annual review',
  drug_test: 'Drug test',
  clearinghouse_query: 'Clearinghouse query',
};

// Evaluates the driver's file against the organization's business date (`today`,
// ClockService.today): a CDL or medical card that is absent, undated or dated before today,
// and every other document recorded as missing (no date, e.g. Tobias Frey's drug test).
// Month-precision dates are stored as the month's last day, so they expire after it.
export function evaluateDriverCompliance(driverId: string, documents: readonly DriverDocumentFact[], today: string): ComplianceWarning[] {
  const warnings: ComplianceWarning[] = [];
  const missing = (documentType: DriverDocumentType): ComplianceWarning => ({
    driverId,
    documentType,
    problem: 'missing',
    expiresOn: null,
    message: `${LABEL[documentType]} is missing.`,
  });

  for (const documentType of DATED_DRIVER_DOCUMENTS) {
    const doc = documents.find((d) => d.documentType === documentType);
    if (!doc || doc.expiresOn === null) warnings.push(missing(documentType));
    else if (doc.expiresOn < today) {
      warnings.push({ driverId, documentType, problem: 'expired', expiresOn: doc.expiresOn, message: `${LABEL[documentType]} expired on ${doc.expiresOn}.` });
    }
  }
  for (const doc of documents) {
    if (!DATED_DRIVER_DOCUMENTS.includes(doc.documentType) && doc.expiresOn === null) warnings.push(missing(doc.documentType));
  }
  return warnings;
}
