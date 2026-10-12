import type { AnswerValue, FindingType, Severity } from '@prisma/client';

export interface DerivedFinding {
  applicable: boolean;
  type: FindingType;
  severity: Severity | null;
  rationale: string;
}

/**
 * Derives the default finding classification from the two mandatory answers:
 * "Is it documented?" and "Is it implemented?".
 *
 * Documented / Implemented matrix:
 *   YES / YES -> Conformity (C)
 *   YES / NO  -> Nonconformity - documented but not implemented
 *   NO  / YES -> Nonconformity - implemented but not documented
 *   NO  / NO  -> Nonconformity (Major) - neither documented nor implemented
 */
export function deriveFinding(documented: AnswerValue, implemented: AnswerValue): DerivedFinding {
  if (documented === 'NA' || implemented === 'NA') {
    return { applicable: false, type: 'NA', severity: null, rationale: 'Clause marked not applicable' };
  }
  if (documented === 'YES' && implemented === 'YES') {
    return { applicable: true, type: 'C', severity: null, rationale: 'Documented and implemented' };
  }
  if (documented === 'YES' && implemented === 'NO') {
    return {
      applicable: true,
      type: 'NC',
      severity: 'MINOR',
      rationale: 'Documented but not implemented',
    };
  }
  if (documented === 'NO' && implemented === 'YES') {
    return {
      applicable: true,
      type: 'OFI',
      severity: 'OBSERVATION',
      rationale: 'Implemented but not documented - opportunity to formalise',
    };
  }
  return {
    applicable: true,
    type: 'NC',
    severity: 'MAJOR',
    rationale: 'Neither documented nor implemented (systemic gap)',
  };
}

export const FINDING_MATRIX = [
  { documented: 'YES', implemented: 'YES', result: 'C', severity: null },
  { documented: 'YES', implemented: 'NO', result: 'NC', severity: 'MINOR' },
  { documented: 'NO', implemented: 'YES', result: 'OFI', severity: 'OBSERVATION' },
  { documented: 'NO', implemented: 'NO', result: 'NC', severity: 'MAJOR' },
] as const;
