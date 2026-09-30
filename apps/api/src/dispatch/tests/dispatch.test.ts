import { describe, expect, it } from 'vitest';
import { evaluateDriverCompliance } from '../compliance.js';
import { dispatchValues, haulAssigns, payColumns, type Haul } from '../dispatch-rules.js';

const OWN: Haul = { hauledBy: 'own_fleet', driverId: null, truckId: null, trailerId: null, driverPayCents: null };
const PARTNER: Haul = {
  hauledBy: 'partner_carrier',
  carrierId: 'c',
  carrierRateCents: 150000,
  carrierContactName: null,
  carrierPhone: null,
  driverName: null,
  truckNumber: null,
  trailerNumber: null,
};

describe('dispatch rules (09 §3.1, §4)', () => {
  it('E1: assigning means a driver, truck, trailer or partner carrier', () => {
    expect(haulAssigns(OWN)).toBe(false);
    expect(haulAssigns({ ...OWN, trailerId: 'r' })).toBe(true);
    expect(haulAssigns({ ...OWN, driverId: 'd' })).toBe(true);
    expect(haulAssigns(PARTNER)).toBe(true);
  });

  it('writes a dispatch row only when something concrete is assigned (E3)', () => {
    expect(dispatchValues(OWN)).toBeNull();
    expect(dispatchValues({ ...OWN, driverId: 'd', truckId: 't' })).toEqual({ driverId: 'd', truckId: 't', trailerId: null, driverName: null, truckNumber: null, trailerNumber: null });
    expect(dispatchValues(PARTNER)).toBeNull();
    expect(dispatchValues({ ...PARTNER, driverName: 'Sam Lee' })).toEqual({ driverId: null, truckId: null, trailerId: null, driverName: 'Sam Lee', truckNumber: null, trailerNumber: null });
  });

  it('keeps driver pay and carrier rate apart; driver pay 0 means none (L10)', () => {
    expect(payColumns({ ...OWN, driverPayCents: 0 })).toEqual({ driverPayCents: null, carrierRateCents: null });
    expect(payColumns({ ...OWN, driverPayCents: 61200 })).toEqual({ driverPayCents: 61200, carrierRateCents: null });
    expect(payColumns(PARTNER)).toEqual({ driverPayCents: null, carrierRateCents: 150000 });
  });
});

describe('evaluateDriverCompliance (C27)', () => {
  const today = '2026-09-03';

  it('flags Priya Raman: CDL expired 07/2026', () => {
    expect(
      evaluateDriverCompliance(
        'priya',
        [
          { documentType: 'cdl', expiresOn: '2026-07-31' },
          { documentType: 'medical_card', expiresOn: '2028-01-31' },
        ],
        today,
      ),
    ).toEqual([{ driverId: 'priya', documentType: 'cdl', problem: 'expired', expiresOn: '2026-07-31', message: 'CDL expired on 2026-07-31.' }]);
  });

  it('flags Tobias Frey: missing drug test', () => {
    const warnings = evaluateDriverCompliance(
      'tobias',
      [
        { documentType: 'cdl', expiresOn: '2028-01-31' },
        { documentType: 'medical_card', expiresOn: '2026-12-31' },
        { documentType: 'drug_test', expiresOn: null },
      ],
      today,
    );
    expect(warnings).toEqual([{ driverId: 'tobias', documentType: 'drug_test', problem: 'missing', expiresOn: null, message: 'Drug test is missing.' }]);
  });

  it('flags an absent CDL or medical card; a document expiring today is still valid', () => {
    expect(evaluateDriverCompliance('x', [{ documentType: 'cdl', expiresOn: today }], today).map((w) => [w.documentType, w.problem])).toEqual([['medical_card', 'missing']]);
    expect(evaluateDriverCompliance('x', [], today).map((w) => w.documentType)).toEqual(['cdl', 'medical_card']);
  });

  it('ignores expiring-soon documents (Marcus Hale clearinghouse query Sep 20)', () => {
    expect(
      evaluateDriverCompliance(
        'marcus',
        [
          { documentType: 'cdl', expiresOn: '2028-04-30' },
          { documentType: 'medical_card', expiresOn: '2027-03-31' },
          { documentType: 'clearinghouse_query', expiresOn: '2026-09-20' },
        ],
        today,
      ),
    ).toEqual([]);
  });
});
