'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { NewLoadDialog } from '@/components/loads/NewLoadDialog';
import { useShellUi } from '@/context/ShellUiContext';
import { useUninvoicedCount } from '@/lib/api/billing';
import { useApproveSettlements } from '@/lib/api/settlements';
import { parseAppPath, SECTION_TABS, type ViewKey } from '@/lib/nav';

interface HeadAction {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}

// Screens with nothing to filter get no Filters button.
const NO_FILTERS: ViewKey[] = ['dashboard', 'planner', 'facilities'];

// Runtruck1 Header. Buttons without onClick are Runtruck1's stubs and stay inert
// (docs/01-product-requirements.md §7).
export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { query, setQuery } = useShellUi();
  const uninvoiced = useUninvoicedCount();
  const approveSettlements = useApproveSettlements();
  const [newLoadOpen, setNewLoadOpen] = useState(false);
  const navigate = (href: string) => router.push(href, { scroll: false });

  const { view, segments } = parseAppPath(pathname);
  const tab = SECTION_TABS[view] ? segments[3] : undefined;
  const onLoadDetail = view === 'loads' && Boolean(segments[3]);

  // Keyed by section, or section/tab for the tabbed sections.
  const actionsFor: Record<string, HeadAction[]> = {
    dashboard: [{ label: '+ New Load', primary: true, onClick: () => setNewLoadOpen(true) }],
    loads: [{ label: '+ New Load', primary: true, onClick: () => setNewLoadOpen(true) }],
    loadDetail: [{ label: 'Message driver' }, { label: 'Update status', primary: true }],
    'fleet/drivers': [{ label: '+ Add Driver', primary: true }],
    'fleet/trucks': [{ label: 'Log service' }, { label: '+ Add Unit', primary: true }],
    'fleet/trailers': [{ label: '+ Add Trailer', primary: true }],
    crm: [{ label: '+ Add Customer', primary: true }],
    'accounting/uninvoiced': [
      { label: `Invoice ${uninvoiced ?? ''} loads`, primary: true, onClick: () => navigate('/app/accounting/invoiced') },
    ],
    'accounting/invoiced': [{ label: 'Export batch' }, { label: '+ New Batch', primary: true, onClick: () => navigate('/app/accounting/batches') }],
    'accounting/batches': [{ label: '+ New Batch', primary: true }],
    'accounting/past-due': [{ label: 'Send reminders', primary: true }],
    'accounting/paid': [{ label: 'Export' }],
    'accounting/payroll': [{ label: 'Run settlements', primary: true, onClick: () => approveSettlements() }],
    'accounting/bills': [{ label: '+ Add Bill', primary: true }],
    'hr/employee-contracts': [{ label: '+ New Contract', primary: true }],
    'hr/onboarding': [{ label: '+ Start Onboarding', primary: true }],
    'safety/maintenance': [{ label: '+ Log Service', primary: true }],
    'safety/driver-documents': [{ label: 'Request document', primary: true }],
    'safety/violations': [{ label: '+ Log Violation', primary: true }],
    'safety/settlements': [{ label: '+ New Claim', primary: true }],
  };
  const headActions = actionsFor[onLoadDetail ? 'loadDetail' : tab ? `${view}/${tab}` : view] ?? [];
  const showFilters = !onLoadDetail && !NO_FILTERS.includes(view);

  return (
    <header className="ui-topbar">
      {onLoadDetail ? (
        <button onClick={() => navigate('/app/loads')} className="ui-btn" type="button">
          ← Loads
        </button>
      ) : (
        <input className="ui-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search" />
      )}
      <div style={{ flex: 1 }} />
      {showFilters && (
        <button className="ui-btn" type="button">
          Filters
        </button>
      )}
      {headActions.map((a) => (
        <button key={a.label} onClick={a.onClick} className={`ui-btn${a.primary ? ' ui-btn-primary' : ''}`} type="button">
          {a.label}
        </button>
      ))}
      {newLoadOpen && (
        <NewLoadDialog onClose={() => setNewLoadOpen(false)} onCreated={(loadNumber) => navigate(`/app/loads/${loadNumber}`)} />
      )}
    </header>
  );
}
