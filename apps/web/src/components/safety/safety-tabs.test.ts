import type { ClaimRow, ClaimsMeta, MeResponse, WorkOrderRow, WorkOrdersMeta } from '@runtruck/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionProvider } from '@/context/SessionContext';
import { ShellUiProvider } from '@/context/ShellUiContext';
import { ApiError } from '@/lib/api/client';
import { claimsQuery, driverDocumentsQuery, violationsQuery, workOrdersQuery } from '@/lib/api/safety';
import { ClaimSettlementsTab } from './ClaimSettlementsTab';
import { DriverDocumentsTab } from './DriverDocumentsTab';
import { MaintenanceTab } from './MaintenanceTab';
import { ViolationsTab } from './ViolationsTab';

// The Safety tabs' markup for the three states of implementation-brief §4 (data, pending or
// refused, failed), rendered to static HTML with the Runtruck1 structure of
// docs/reference/runtruck1/fleet-hr-safety.md §8–§11.

const me = (permissions: string[]): MeResponse => ({
  user: { id: 'u', fullName: 'Rosa Medina', email: 'rosa@example.test', memberNumber: '1', title: 'Dispatch' },
  organization: { id: 'o', name: 'Sunridge Freight', shortName: 'Sunridge', companyNumber: '30017', timezone: 'America/Los_Angeles' },
  permissions,
  today: '2026-09-03',
});

const ALL = ['maintenance.view', 'compliance.view', 'claims.view'];

function render(Tab: ComponentType, client: QueryClient, permissions = ALL): string {
  // The providers type `children` as a required prop; it is passed as createElement's child.
  const shell = createElement(ShellUiProvider, null as unknown as { children: ReactNode }, createElement(Tab));
  const session = createElement(SessionProvider, { me: me(permissions) } as { me: MeResponse; children: ReactNode }, shell);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, session));
}

// A client whose cache holds `error` for the query key, as after a fetch that failed while
// the page was mounted (retryOnMount off, so the static render keeps the error state).
function failed(queryKey: readonly unknown[], error: Error): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  client.getQueryCache().build(client, { queryKey }).setState({ status: 'error', error, fetchStatus: 'idle' });
  return client;
}

const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const workOrder: WorkOrderRow = {
  id: 'w1',
  unit: { kind: 'truck', id: 't', unitNumber: 'T-118' },
  item: 'Turbocharger replacement',
  dueOn: '2026-09-05',
  dueOdometer: null,
  shop: { facilityId: 'f', name: 'Sunridge shop', city: 'Modesto' },
  estimateCents: 485000,
  status: 'in_shop',
  completedOn: null,
};

const workOrdersMeta: WorkOrdersMeta = {
  total: 1,
  limit: 500,
  offset: 0,
  summary: {
    asOf: '2026-09-03',
    doneWindowStart: '2026-08-04',
    workOrderCount: 1,
    openCount: 1,
    doneLast30dCount: 0,
    inShopCount: 1,
    inShopShops: [workOrder.shop],
    overdue: [],
    openEstimateCents: 485000,
  },
};

describe('MaintenanceTab', () => {
  it('renders the Runtruck1 row, KPIs and chip from the API data', () => {
    const client = new QueryClient();
    client.setQueryData(workOrdersQuery.queryKey, { data: [workOrder], meta: workOrdersMeta });
    const html = render(MaintenanceTab, client);
    expect(html).toContain('<div class="ui-kpi-label">Est. cost open</div><div class="ui-kpi-note">Parts &amp; labor, open orders</div></div><div class="ui-kpi-value">$4,850</div>');
    expect(html).toContain('<div class="ui-card-title">Work orders</div>');
    expect(html).toContain(
      '<tr><td class="strong">T-118</td><td>Turbocharger replacement</td><td>Sep 5</td><td class="muted">Sunridge shop · Modesto</td><td class="num">$4,850</td><td class="num"><span class="ui-chip ui-chip-amber">In shop</span></td></tr>',
    );
    expect(html).not.toContain('ui-empty');
  });

  it('pending or refused: the structure, KPI "—" without notes, no rows and no empty line', () => {
    for (const client of [new QueryClient(), failed(workOrdersQuery.queryKey, new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.', 'r'))]) {
      const html = render(MaintenanceTab, client);
      expect(text(html)).toBe(
        '|Open work orders|—|In shop|—|Overdue|—|Est. cost open|—|Work orders|Unit|Item|Due|Shop|Estimate|Status|',
      );
      expect(html).not.toContain('ui-kpi-note');
      expect(html).not.toContain('ui-empty');
    }
    // Without the permission nothing is fetched and the page reads as pending.
    expect(text(render(MaintenanceTab, new QueryClient(), []))).toContain('|Open work orders|—|');
  });

  it('any other failure adds one ui-empty line with the API message', () => {
    const html = render(MaintenanceTab, failed(workOrdersQuery.queryKey, new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.', 'r')));
    expect(html.match(/ui-empty/g)).toHaveLength(1);
    expect(html).toContain('<div class="ui-empty">Something went wrong.</div>');
  });
});

describe('ClaimSettlementsTab', () => {
  const claim: ClaimRow = {
    id: 'k',
    claimNumber: 1108,
    occurredOn: '2026-05-09',
    driver: { id: 'a', fullName: 'Ana Cortez' },
    truck: { id: 't', unitNumber: 'T-109' },
    trailer: { id: 'r', unitNumber: 'FB-04' },
    load: null,
    claimType: 'bodily_injury',
    claimant: { kind: 'third_party', name: 'R. Delgado' },
    reservedCents: 2500000,
    paidCents: 1850000,
    status: 'settled',
  };
  const meta: ClaimsMeta = {
    total: 2,
    limit: 500,
    offset: 0,
    summary: {
      asOf: '2026-09-03',
      ytdStart: '2026-01-01',
      claimCount: 2,
      openCount: 1,
      underReviewCount: 0,
      openReservedCents: 680000,
      paidYtdCents: 1850000,
      paidYtdCount: 1,
      settledCount: 1,
      deniedCount: 0,
    },
  };

  it('renders money cells from cents and "—" for an unpaid claim', () => {
    const client = new QueryClient();
    const unpaid: ClaimRow = { ...claim, id: 'k2', claimNumber: 1112, paidCents: 0, reservedCents: 680000, status: 'open', claimant: { kind: 'customer', customerId: 'c', name: 'Cascade Building Supply' } };
    client.setQueryData(claimsQuery.queryKey, { data: [unpaid, claim], meta });
    const html = render(ClaimSettlementsTab, client);
    expect(html).toContain(
      '<tr><td class="strong">CLM-1108</td><td>May 9</td><td>Ana Cortez</td><td>T-109 / FB-04</td><td>Bodily injury</td><td>Third party · R. Delgado</td><td class="num">$25,000</td><td class="num">$18,500</td><td class="num"><span class="ui-chip ui-chip-green">Settled</span></td></tr>',
    );
    expect(html).toContain('<td class="num">$6,800</td><td class="num">—</td><td class="num"><span class="ui-chip ui-chip-amber">Open</span></td>');
    expect(text(html)).toContain('|Open claims|0 under review|1|Reserved|On open claims|$6,800|Paid YTD|1 settlements|$18,500|Settled|0 denied|1|');
  });
});

describe('DriverDocumentsTab and ViolationsTab', () => {
  it('render their card titles and table heads while pending', () => {
    expect(text(render(DriverDocumentsTab, new QueryClient()))).toBe(
      '|Documents|—|Expiring (60 d)|—|Expired|—|Missing|—|Driver qualification files|Driver|Document|Expires|Status|',
    );
    expect(text(render(ViolationsTab, new QueryClient()))).toBe(
      '|Open|—|Points (12 mo)|—|Contested|—|Closed|—|Roadside inspections &amp; violations|Date|Driver|Unit|Type|Points|Location|Status|',
    );
  });

  it('render the Runtruck1 rows from data (violation date plain, not strong)', () => {
    const client = new QueryClient();
    client.setQueryData(violationsQuery.queryKey, {
      data: [
        {
          id: 'v',
          occurredOn: '2026-06-12',
          driver: { id: 'd', fullName: 'Tobias Frey' },
          truck: { id: 't', unitNumber: 'T-118' },
          violationType: 'Speeding 6–10 over',
          severityPoints: 4,
          location: 'I-70 · Grand Junction, CO',
          status: 'closed',
        },
      ],
      meta: { total: 1, limit: 500, offset: 0, summary: { asOf: '2026-09-03', pointsWindowStart: '2025-09-04', violationCount: 1, openCount: 0, contestedCount: 0, closedCount: 1, pointsInWindow: 4, violationsInWindowCount: 1 } },
    });
    expect(render(ViolationsTab, client)).toContain(
      '<tr><td>Jun 12</td><td class="strong">Tobias Frey</td><td>T-118</td><td>Speeding 6–10 over</td><td class="num">4</td><td class="muted">I-70 · Grand Junction, CO</td><td class="num"><span class="ui-chip ui-chip-gray">Closed</span></td></tr>',
    );

    const docs = new QueryClient();
    docs.setQueryData(driverDocumentsQuery.queryKey, {
      data: [{ id: 'x', driver: { id: 'd', fullName: 'Tobias Frey' }, documentType: 'drug_test', expiresOn: null, expiresPrecision: 'month', status: 'missing' }],
      meta: {
        total: 1,
        limit: 500,
        offset: 0,
        summary: { asOf: '2026-09-03', expiringWindowEnd: '2026-11-02', documentCount: 1, driverCount: 1, expiringCount: 0, expired: [], missing: [{ driverDocumentId: 'x', driverId: 'd', fullName: 'Tobias Frey', documentType: 'drug_test' }] },
      },
    });
    const html = render(DriverDocumentsTab, docs);
    expect(html).toContain('<tr><td class="strong">Tobias Frey</td><td>Drug test</td><td>—</td><td class="num"><span class="ui-chip ui-chip-amber">Missing</span></td></tr>');
    expect(text(html)).toContain('|Expired|None|0|Missing|Tobias Frey · Drug test|1|');
  });
});

describe('every Safety tab (implementation-brief §4 rules 2–4)', () => {
  const TABS = [
    ['MaintenanceTab', MaintenanceTab, workOrdersQuery.queryKey, 'maintenance.view'],
    ['DriverDocumentsTab', DriverDocumentsTab, driverDocumentsQuery.queryKey, 'compliance.view'],
    ['ViolationsTab', ViolationsTab, violationsQuery.queryKey, 'compliance.view'],
    ['ClaimSettlementsTab', ClaimSettlementsTab, claimsQuery.queryKey, 'claims.view'],
  ] as const;

  it.each(TABS)('%s: pending, refused (403) and a missing permission render alike; another failure adds one message line', (_name, Tab, key, permission) => {
    const pending = render(Tab, new QueryClient());
    expect(pending).not.toContain('ui-empty');
    expect(pending).not.toContain('ui-kpi-note');
    expect(pending).not.toContain('<tbody><tr');
    expect(render(Tab, failed(key, new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.', 'r')))).toBe(pending);
    expect(render(Tab, new QueryClient(), ALL.filter((p) => p !== permission))).toBe(pending);

    const html = render(Tab, failed(key, new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', 'r')));
    expect(html.match(/ui-empty/g)).toHaveLength(1);
    expect(html).toBe(pending.replace('</table>', '</table><div class="ui-empty">Check the highlighted fields.</div>'));
  });
});
