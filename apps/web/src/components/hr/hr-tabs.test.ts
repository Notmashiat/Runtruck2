import type { EmployeeContractsMeta, MeResponse, OnboardingCasesMeta } from '@runtruck/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionProvider } from '@/context/SessionContext';
import { ShellUiProvider } from '@/context/ShellUiContext';
import { ApiError } from '@/lib/api/client';
import { employeeContractsQuery, onboardingCasesQuery } from '@/lib/api/hr';
import { EmployeeContractsTab } from './EmployeeContractsTab';
import { OnboardingTab } from './OnboardingTab';

// The HR tabs' markup for the three states of implementation-brief §4 (data, pending or
// refused, failed), rendered to static HTML with the Runtruck1 structure of
// docs/reference/runtruck1/fleet-hr-safety.md §6–§7.

const me = (permissions: string[]): MeResponse => ({
  user: { id: 'u', fullName: 'Rosa Medina', email: 'rosa@example.test', memberNumber: '1', title: 'Dispatch' },
  organization: { id: 'o', name: 'Sunridge Freight', shortName: 'Sunridge', companyNumber: '30017', timezone: 'America/Los_Angeles' },
  permissions,
  today: '2026-09-03',
});

function render(Tab: ComponentType, client: QueryClient, permissions = ['hr.view']): string {
  // The providers type `children` as a required prop; it is passed as createElement's child.
  const shell = createElement(ShellUiProvider, null as unknown as { children: ReactNode }, createElement(Tab));
  const session = createElement(SessionProvider, { me: me(permissions) } as { me: MeResponse; children: ReactNode }, shell);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, session));
}

const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

describe('EmployeeContractsTab', () => {
  const meta: EmployeeContractsMeta = {
    total: 1,
    limit: 500,
    offset: 0,
    summary: {
      asOf: '2026-09-03',
      contractCount: 1,
      activeCount: 0,
      renewalsDue: [{ contractId: 'c', employeeId: 'e', fullName: 'Ellis Nakamura', lastName: 'Nakamura', contractType: 'w2', startsOn: '2023-10-01', renewsOn: '2026-10-01' }],
      ownerOperators: [],
      drafts: [],
    },
  };

  it('renders the Runtruck1 row and KPIs from the API data', () => {
    const client = new QueryClient();
    client.setQueryData(employeeContractsQuery.queryKey, {
      data: [
        {
          id: 'c',
          employee: { id: 'e', fullName: 'Ellis Nakamura' },
          role: 'company_driver',
          contractType: 'w2',
          status: 'renewal_due',
          startsOn: '2023-10-01',
          renewsOn: '2026-10-01',
          payBasis: 'percent_of_line_haul',
          payRateCents: null,
          payPercentBp: 2500,
        },
      ],
      meta,
    });
    const html = render(EmployeeContractsTab, client);
    expect(html).toContain(
      '<tr><td class="strong">Ellis Nakamura</td><td>Company driver</td><td>W-2</td><td>Oct 1, 2023</td><td>Oct 1</td><td class="muted">25% of line haul</td><td class="num"><span class="ui-chip ui-chip-amber">Renewal due</span></td></tr>',
    );
    expect(text(html)).toContain('|Active contracts|1 on file|0|Renewals due (30 d)|Nakamura Oct 1|1|Owner-operators|None|0|Drafts|None|0|Employee contracts|');
    expect(html).not.toContain('ui-empty');
  });

  it('pending, refused and failed states', () => {
    const pending = text(render(EmployeeContractsTab, new QueryClient()));
    expect(pending).toBe('|Active contracts|—|Renewals due (30 d)|—|Owner-operators|—|Drafts|—|Employee contracts|Employee|Role|Type|Start|Renews|Pay basis|Status|');
    expect(text(render(EmployeeContractsTab, new QueryClient(), []))).toBe(pending);

    const failed = (error: Error) => {
      const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
      client.getQueryCache().build(client, { queryKey: employeeContractsQuery.queryKey }).setState({ status: 'error', error, fetchStatus: 'idle' });
      return render(EmployeeContractsTab, client);
    };
    expect(text(failed(new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.', 'r')))).toBe(pending);
    const html = failed(new ApiError(502, 'DEPENDENCY_UNAVAILABLE', 'Try again shortly.', 'r'));
    expect(html.match(/ui-empty/g)).toHaveLength(1);
    expect(html).toContain('<div class="ui-empty">Try again shortly.</div>');
  });
});

describe('OnboardingTab', () => {
  const meta: OnboardingCasesMeta = {
    total: 1,
    limit: 500,
    offset: 0,
    summary: {
      asOf: '2026-09-03',
      weekStart: '2026-08-31',
      weekEnd: '2026-09-06',
      quarterStart: '2026-07-01',
      caseCount: 1,
      inProgressCount: 1,
      inOrientationCount: 1,
      startedThisWeekCount: 0,
      awaitingDocuments: [],
      completedThisQuarterCount: 0,
    },
  };

  it('renders the progress bar markup and the stage chip left-aligned', () => {
    const client = new QueryClient();
    client.setQueryData(onboardingCasesQuery.queryKey, {
      data: [
        {
          id: 'o',
          candidateName: 'Jamal Reed',
          employeeId: 'e',
          role: 'company_driver',
          stage: 'orientation',
          startedOn: '2026-08-17',
          owner: { id: 'w', fullName: 'Rosa Medina' },
          progressPercent: 85,
          nextStep: 'Ride-along with Ana Cortez',
          nextStepOn: '2026-09-05',
          completedOn: null,
          pendingDocumentLabels: [],
        },
      ],
      meta,
    });
    const html = render(OnboardingTab, client);
    expect(html).toContain(
      '<tr><td class="strong">Jamal Reed</td><td>Company driver</td><td><span class="ui-chip ui-chip-blue">Orientation</span></td><td>Aug 17</td><td>Rosa Medina</td><td><div style="display:flex;align-items:center;gap:10px"><div class="ui-bar-track" style="width:120px;flex:none"><div class="ui-bar-fill" style="width:85%"></div></div><span style="font-size:13px;color:var(--ui-muted);font-variant-numeric:tabular-nums">85%</span></div></td><td class="muted">Ride-along with Ana Cortez · Sep 5</td></tr>',
    );
    expect(text(html)).toContain('|In progress|1 in orientation|1|Starting this week|Opened since Mon Aug 31|0|Awaiting documents|None|0|Completed this quarter|Since Jul 1|0|');
  });

  it('renders the structure while pending', () => {
    expect(text(render(OnboardingTab, new QueryClient()))).toBe(
      '|In progress|—|Starting this week|—|Awaiting documents|—|Completed this quarter|—|Onboarding|Candidate|Role|Stage|Started|Owner|Progress|Next step|',
    );
  });
});

describe('both HR tabs (implementation-brief §4 rules 2–4)', () => {
  const TABS = [
    ['EmployeeContractsTab', EmployeeContractsTab, employeeContractsQuery.queryKey],
    ['OnboardingTab', OnboardingTab, onboardingCasesQuery.queryKey],
  ] as const;

  const failed = (key: readonly unknown[], error: Error) => {
    const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
    client.getQueryCache().build(client, { queryKey: key }).setState({ status: 'error', error, fetchStatus: 'idle' });
    return client;
  };

  it.each(TABS)('%s: pending, refused (403) and a missing permission render alike; another failure adds one message line', (_name, Tab, key) => {
    const pending = render(Tab, new QueryClient());
    expect(pending).not.toContain('ui-empty');
    expect(pending).not.toContain('ui-kpi-note');
    expect(render(Tab, failed(key, new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.', 'r')))).toBe(pending);
    expect(render(Tab, new QueryClient(), [])).toBe(pending);

    const html = render(Tab, failed(key, new Error('network down')));
    expect(html).toBe(pending.replace('</table>', '</table><div class="ui-empty">Something went wrong.</div>'));
  });
});
