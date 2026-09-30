'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { NewLoadDialog } from '@/components/loads/NewLoadDialog';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useUninvoicedCount } from '@/lib/api/billing';
import { usePrefetchNewLoadReferences } from '@/lib/api/reference';
import { useApproveSettlements } from '@/lib/api/settlements';
import { parseAppPath, SECTION_TABS, type ViewKey } from '@/lib/nav';

interface HeadAction {
  label: string;
  primary?: boolean;
  onClick?: () => void;
  // Warms data the action needs (hover/focus); adds no markup.
  onHover?: () => void;
}

// Screens with nothing to filter get no Filters button.
const NO_FILTERS: ViewKey[] = ['dashboard', 'planner', 'facilities'];

// Runtruck1 Header. Buttons without onClick are Runtruck1's stubs and stay inert
// (docs/01-product-requirements.md §7).
export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { query, setQuery } = useShellUi();
  const { can } = useSession();
  const uninvoiced = useUninvoicedCount();
  const approveSettlements = useApproveSettlements();
  const prefetchNewLoadReferences = usePrefetchNewLoadReferences();
  const [newLoadOpen, setNewLoadOpen] = useState(false);
  const navigate = (href: string) => {
    router.push(href, { scroll: false });
  };

  const { view, segments } = parseAppPath(pathname);
  const tab = SECTION_TABS[view] ? segments[3] : undefined;
  const onLoadDetail = view === 'loads' && Boolean(segments[3]);

  // Controls backed by API writes/data are hidden from members who lack the
  // permission (docs/07-roles-permissions.md §5); Admin sees exactly Runtruck1.
  const newLoad: HeadAction[] = can('loads.create')
    ? [
        {
          label: '+ New Load',
          primary: true,
          onClick: () => {
            setNewLoadOpen(true);
          },
          onHover: prefetchNewLoadReferences,
        },
      ]
    : [];

  // Keyed by section, or section/tab for the tabbed sections.
  const actionsFor: Record<string, HeadAction[]> = {
    dashboard: newLoad,
    loads: newLoad,
    loadDetail: [{ label: 'Message driver' }, { label: 'Update status', primary: true }],
    'fleet/drivers': [{ label: '+ Add Driver', primary: true }],
    'fleet/trucks': [{ label: 'Log service' }, { label: '+ Add Unit', primary: true }],
    'fleet/trailers': [{ label: '+ Add Trailer', primary: true }],
    crm: [{ label: '+ Add Customer', primary: true }],
    // Hidden while the count is unknown, so "Invoice  loads" can never render (billing.md §7.1).
    'accounting/uninvoiced':
      uninvoiced === undefined
        ? []
        : [
            {
              label: `Invoice ${uninvoiced} loads`,
              primary: true,
              onClick: () => {
                navigate('/app/accounting/invoiced');
              },
            },
          ],
    'accounting/invoiced': [
      { label: 'Export batch' },
      {
        label: '+ New Batch',
        primary: true,
        onClick: () => {
          navigate('/app/accounting/batches');
        },
      },
    ],
    'accounting/batches': [{ label: '+ New Batch', primary: true }],
    'accounting/past-due': [{ label: 'Send reminders', primary: true }],
    'accounting/paid': [{ label: 'Export' }],
    // Approving needs settlements.view as well as settlements.approve (settlements.md §4).
    'accounting/payroll':
      can('settlements.approve', 'settlements.view')
        ? [
            {
              label: 'Run settlements',
              primary: true,
              onClick: () => {
                approveSettlements();
              },
            },
          ]
        : [],
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
        <button
          onClick={() => {
            navigate('/app/loads');
          }}
          className="ui-btn"
          type="button"
        >
          ← Loads
        </button>
      ) : (
        <input
          className="ui-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search"
          aria-label="Search"
        />
      )}
      <div style={{ flex: 1 }} />
      {showFilters && (
        <button className="ui-btn" type="button">
          Filters
        </button>
      )}
      {headActions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          onMouseEnter={a.onHover}
          onFocus={a.onHover}
          className={`ui-btn${a.primary ? ' ui-btn-primary' : ''}`}
          type="button"
        >
          {a.label}
        </button>
      ))}
      {newLoadOpen && (
        <NewLoadDialog
          onClose={() => {
            setNewLoadOpen(false);
          }}
          onCreated={(loadNumber) => {
            navigate(`/app/loads/${loadNumber}`);
          }}
        />
      )}
    </header>
  );
}
