import { describe, expect, it } from 'vitest';
import { averageDaysToPay, draftSummary, overdueSummary, paidSummary } from './invoices.summary.js';

describe('averageDaysToPay (Runtruck1 Math.round over every paid row)', () => {
  it('rounds the seed 77 / 5 = 15.4 to 15', () => {
    expect(averageDaysToPay(77, 5)).toBe(15);
  });

  it('rounds halves up like JavaScript Math.round', () => {
    expect(averageDaysToPay(5, 2)).toBe(3);
    expect(averageDaysToPay(15, 10)).toBe(2);
  });

  it('is 0 without paid invoices (divides by max(n, 1))', () => {
    expect(averageDaysToPay(0, 0)).toBe(0);
  });
});

describe('summary assembly', () => {
  it('paid', () => {
    expect(
      paidSummary(
        {
          rowCount: 5,
          paidThisMonthCount: 5,
          daysToPaySum: 77,
          factoredCount: 2,
          factoredCents: 494_000,
          factoringCompanyNames: ['TriPoint Capital'],
          collectedThisMonthCents: 1_398_000,
        },
        '2026-09-01',
      ),
    ).toEqual({
      status: 'paid',
      monthStart: '2026-09-01',
      paidThisMonthCount: 5,
      collectedThisMonthCents: 1_398_000,
      avgDaysToPay: 15,
      factoredCount: 2,
      factoredCents: 494_000,
      factoringCompanyNames: ['TriPoint Capital'],
    });
  });

  it('overdue and draft', () => {
    const oldest = { invoiceId: 'x', invoiceNumber: 8811, customerName: 'Sierra Ag Partners', ageDays: 67 };
    expect(overdueSummary({ rowCount: 5, amountCents: 1_466_000, inCollectionsCount: 2, accountsAffected: 4, totalAccounts: 6, oldest })).toEqual({
      status: 'overdue',
      invoiceCount: 5,
      amountCents: 1_466_000,
      inCollectionsCount: 2,
      oldest,
      accountsAffected: 4,
      totalAccounts: 6,
    });
    expect(draftSummary({ rowCount: 1, amountCents: 245_000 })).toEqual({ status: 'draft', invoiceCount: 1, amountCents: 245_000 });
  });
});
