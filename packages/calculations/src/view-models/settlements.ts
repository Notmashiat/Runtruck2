// settlements view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/settlements.md.

import type { SettlementPeriod, SettlementRow, SettlementsSummary, SettlementStatus } from '@runtruck/types';
import { EM_DASH, formatInt, formatMoney, formatShortDate, formatSignedMoney } from '../format.js';
import type { AccountingKpi, AccountingTone } from './billing.js';

export const SETTLEMENT_STATUS_TONE: Record<SettlementStatus, AccountingTone> = { ready: 'blue', approved: 'blue', on_hold: 'amber', paid: 'green' };

// "Ready", "Approved", "Hold · fuel", "Paid" (settlements.md §5).
export function settlementStatusLabel(status: SettlementStatus, holdReason: string | null): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'approved':
      return 'Approved';
    case 'on_hold':
      return `Hold · ${holdReason ?? ''}`;
    case 'paid':
      return 'Paid';
  }
}

export interface SettlementViewRow {
  name: string;
  basis: string;
  // Strings, as Runtruck1 kept them.
  loads: string;
  miles: string;
  gross: string;
  ded: string;
  net: string;
  status: string;
  tone: AccountingTone;
}

export function settlementViewRow(row: SettlementRow): SettlementViewRow {
  return {
    name: row.driverName,
    basis: row.payBasisLabel,
    loads: String(row.loadCount),
    miles: formatInt(row.miles),
    gross: formatMoney(row.grossCents),
    // "-$142" (hyphen-minus); zero → "—".
    ded: formatSignedMoney(row.deductionsCents, true),
    net: formatMoney(row.netCents),
    status: settlementStatusLabel(row.status, row.holdReason),
    tone: SETTLEMENT_STATUS_TONE[row.status],
  };
}

// "Sep 1", or "—" without a period (settlements.md §6 decision 5).
const periodLabel = (period: SettlementPeriod | null | undefined) => (period ? formatShortDate(period.start) : EM_DASH);

// Card title: "Driver settlements · week of Sep 1" (lower-case "week").
export function payrollCardTitle(period: SettlementPeriod | null | undefined): string {
  return `Driver settlements · week of ${periodLabel(period)}`;
}

// Payroll KPI tiles (settlements.md §5). `undefined` = pending or refused: labels, "—", no note.
export function payrollKpis(summary: SettlementsSummary | undefined): AccountingKpi[] {
  if (!summary) return ['Drivers', 'Gross', 'Deductions', 'Net payable'].map((label) => ({ label, value: EM_DASH }));
  return [
    { label: 'Drivers', value: String(summary.driverCount), note: summary.allApproved ? 'Approved for payment' : `${summary.readyCount} ready to approve` },
    { label: 'Gross', value: formatMoney(summary.grossCents), note: `Week of ${periodLabel(summary.period)}` },
    { label: 'Deductions', value: formatMoney(Math.abs(summary.deductionsCents)), note: 'Fuel advances and escrow' },
    { label: 'Net payable', value: formatMoney(summary.netCents), note: summary.allApproved ? 'Approved' : 'Awaiting approval' },
  ];
}
