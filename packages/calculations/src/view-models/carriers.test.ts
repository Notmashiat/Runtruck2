import { describe, expect, it } from 'vitest';
import { carrierOptionText, carrierOwnFleetNote, toCarrierVm } from './carriers.js';

describe('carriers view-model', () => {
  const own = toCarrierVm({ id: 'o', name: 'Sunridge Freight', mcNumber: '812044', dotNumber: '2291176', isOwnFleet: true });
  const partner = toCarrierVm({ id: 'p', name: 'Valley Line Transport', mcNumber: '604117', dotNumber: '1780342', isOwnFleet: false });

  it('builds Runtruck1 Carrier rows', () => {
    expect(own).toEqual({ name: 'Sunridge Freight (own fleet)', mc: 'MC 812044', dot: 'DOT 2291176', ref: { id: 'o', isOwnFleet: true } });
    expect(partner).toEqual({ name: 'Valley Line Transport', mc: 'MC 604117', dot: 'DOT 1780342', ref: { id: 'p', isOwnFleet: false } });
    expect(toCarrierVm({ id: 'x', name: 'No Authority', mcNumber: null, dotNumber: null, isOwnFleet: false })).toMatchObject({
      mc: '—',
      dot: '—',
    });
  });

  it('composes the New Load own-fleet note and partner option text', () => {
    expect(carrierOwnFleetNote(own)).toBe(
      'Sunridge Freight (own fleet) · MC 812044 · DOT 2291176. Assign the driver, truck and trailer in Driver & equipment.',
    );
    expect(carrierOwnFleetNote(undefined)).toBe('— · — · —. Assign the driver, truck and trailer in Driver & equipment.');
    expect(carrierOptionText(partner)).toBe('Valley Line Transport · MC 604117');
  });
});
