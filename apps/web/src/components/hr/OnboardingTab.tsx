'use client';

import { onboardingKpis, toOnboardingRow } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useOnboardingCases } from '@/lib/api/hr';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// HR › Onboarding, ported verbatim from Runtruck1 pages/app/hr/OnboardingTab.tsx
// (docs/reference/runtruck1/fleet-hr-safety.md §7). Data: GET /hr/onboarding (docs/api/hr.md
// §4.2); KPIs from meta.summary (the org week and quarter come from the API's clock).

export function OnboardingTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const cases = useOnboardingCases(can('hr.view'));

  const ONBOARDING = useMemo(() => cases.data?.data.map(toOnboardingRow) ?? [], [cases.data]);
  const KPIS = onboardingKpis(cases.data?.meta.summary);
  const error = cases.data ? null : queryErrorLine(cases.error);

  const rows = ONBOARDING.filter((o) => matchesQuery(o, query));

  return (
    <>
      <Kpis items={KPIS} />

      <Card title="Onboarding" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Candidate</th><th>Role</th><th>Stage</th><th>Started</th><th>Owner</th><th>Progress</th><th>Next step</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.ref.id}>
                <td className="strong">{o.candidate}</td>
                <td>{o.role}</td>
                <td><Tag label={o.stage} tone={o.ref.tone} /></td>
                <td>{o.started}</td>
                <td>{o.owner}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="ui-bar-track" style={{ width: 120, flex: 'none' }}>
                      <div className="ui-bar-fill" style={{ width: `${o.progress}%` }} />
                    </div>
                    <span style={{ fontSize: 13, color: 'var(--ui-muted)', fontVariantNumeric: 'tabular-nums' }}>{o.progress}%</span>
                  </div>
                </td>
                <td className="muted">{o.nextStep}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cases.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {error && <div className="ui-empty">{error}</div>}
      </Card>
    </>
  );
}
