'use client';

import { customerKpis, toCustomerRow, toTopAccount } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useCustomers } from '@/lib/api/customers';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// CRM, ported verbatim from Runtruck1 pages/app/CustomersPage.tsx
// (docs/reference/runtruck1/core-pages.md §5). Data: GET /customers (docs/api/customers.md
// §3.1); KPIs and top-account cards from meta.summary, computed from records (D5).

export function CustomersPage() {
  const { query } = useShellUi();
  const { can } = useSession();
  const customers = useCustomers(can('customers.view'));

  const CUSTOMERS = useMemo(() => customers.data?.data.map(toCustomerRow) ?? [], [customers.data]);
  const TOP_ACCOUNTS = useMemo(() => customers.data?.meta.summary.topAccounts.map(toTopAccount) ?? [], [customers.data]);
  const KPIS = customerKpis(customers.data?.meta.summary);
  const error = customers.data ? null : queryErrorLine(customers.error);

  const rows = CUSTOMERS.filter((c) => matchesQuery(c, query));

  return (
    <>
      <Kpis items={KPIS} />

      <div className="ui-grid-3">
        {TOP_ACCOUNTS.map((a) => (
          <Card key={a.ref.id}>
            <div className="ui-label" style={{ color: 'var(--ui-primary)' }}>
              {a.tier}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{a.name}</div>
            <div style={{ fontSize: 13, color: 'var(--ui-muted)', marginTop: 2 }}>{a.contact}</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
                gap: 12,
                marginTop: 18,
                paddingTop: 14,
                borderTop: '1px solid var(--ui-border)',
              }}
            >
              {[
                ['Loads', a.loads],
                ['Revenue', a.revenue],
                ['On time', a.onTime],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="ui-label">{k}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card title="All accounts" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Primary contact</th>
              <th className="num">Loads YTD</th>
              <th className="num">Revenue</th>
              <th className="num">On time</th>
              <th className="num">Terms</th>
              <th className="num">AR balance</th>
              <th className="num">Standing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.ref.id}>
                <td className="strong">{c.name}</td>
                <td className="muted">{c.contact}</td>
                <td className="num">{c.loads}</td>
                <td className="num">{c.revenue}</td>
                <td className="num">{c.onTime}</td>
                <td className="num">{c.terms}</td>
                <td className="num">{c.ar}</td>
                <td className="num">
                  <Tag label={c.tier} tone={c.ref.tone} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {error && <div className="ui-empty">{error}</div>}
      </Card>
    </>
  );
}
