import { expect, type Page, test } from '@playwright/test';
import { resetDemoData } from '../demo-data.js';
import { expectKpis, signIn } from './helpers.js';

// Every sidebar section and tab, reached by clicking (client navigation, so each screen
// fetches its own data after the first paint), shows its Runtruck1 KPI tiles with the
// seeded demo figures (docs/api/<domain>.md seed values, docs/20 §4-§5).

type Kpi = readonly [label: string, value: string, note?: string];

interface Screen {
  tab?: string;
  url: RegExp;
  kpis: Kpi[];
  card?: string;
}

const TABS = {
  fleet: ['Drivers', 'Trucks', 'Trailers'],
  accounting: ['Uninvoiced', 'Invoiced', 'Batches', 'Past Due', 'Paid', 'Payroll', 'Bills'],
  hr: ['Employee Contracts', 'Onboarding'],
  safety: ['Maintenance', 'Driver Documents', 'Violations', 'Settlements'],
} as const;

async function openSection(page: Page, label: string): Promise<void> {
  await page.locator('.ui-nav').getByRole('link', { name: label, exact: true }).click();
  await expect(page.locator('.ui-nav .ui-nav-item.is-active')).toHaveText(label);
}

async function checkTabs(page: Page, tabs: readonly string[], screens: Screen[]): Promise<void> {
  await expect(page.locator('.ui-tabs .ui-tab')).toHaveText([...tabs]);
  for (const screen of screens) {
    if (screen.tab) await page.locator('.ui-tabs').getByRole('link', { name: screen.tab, exact: true }).click();
    await expect(page).toHaveURL(screen.url);
    if (screen.tab) await expect(page.locator('.ui-tab.is-active')).toHaveText(screen.tab);
    await expectKpis(page, screen.kpis);
    if (screen.card) await expect(page.locator('.ui-card-title').first()).toHaveText(screen.card);
  }
}

test.describe('navigation and KPIs (every section and tab)', () => {
  test.beforeAll(async () => {
    await resetDemoData();
  });

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('Dashboard, Loads, load detail, Planner and Facilities', async ({ page }) => {
    // First paint of the dashboard is server-rendered with its data.
    await expectKpis(page, [
      ['Active loads', '5', '+2 vs. last week'],
      ['Revenue this week', '$25K', '+37.4%'],
      ['Deadhead miles', '7.8%', '1.4 pts better'],
      ['Unbilled loads', '11', '$34,900 waiting'],
    ]);
    await expect(page.locator('.ui-card-title')).toHaveText(['Active loads', 'Revenue, last 7 days', 'Drivers']);
    await expect(page.locator('.ui-table tbody tr').first()).toContainText('L-40218');

    await openSection(page, 'Loads');
    await expect(page).toHaveURL(/\/app\/loads$/);
    await expectKpis(page, [
      ['Undispatched', '1'],
      ['In transit', '1'],
      ['Delivered', '2'],
      ['Needs POD', '1'],
    ]);
    await expect(page.locator('.ui-card-title')).toHaveText('5 loads');
    await page.getByRole('link', { name: 'Open load →' }).click();
    await expect(page).toHaveURL(/\/app\/loads\/L-40218$/);
    await expectKpis(page, [
      ['Miles', '478'],
      ['Line haul', '$2,450', '$5.13 / mi'],
      ['Driver pay', '$612'],
      ['Margin', '$1,214'],
    ]);
    await expect(page.locator('.ui-card-title')).toHaveText(['Stops', 'Freight & pay', 'Carrier', 'Documents', 'Activity']);

    await openSection(page, 'Planner');
    await expect(page).toHaveURL(/\/app\/planner$/);
    await expect(page.getByText('Mon, Aug 31 – Sun, Sep 6')).toBeVisible();
    await expect(page.locator('.cal-ev', { hasText: 'Payroll review — week of Sep 1' })).toBeVisible();
    await expect(page.locator('.cal-ev', { hasText: 'L-40218' }).first()).toBeVisible();

    await openSection(page, 'Facilities');
    await expect(page).toHaveURL(/\/app\/facilities$/);
    await expect(page.getByText('Every yard, shop and dock in one register')).toBeVisible();
  });

  test('Fleet tabs', async ({ page }) => {
    await openSection(page, 'Fleet');
    await checkTabs(page, TABS.fleet, [
      {
        url: /\/app\/fleet\/drivers$/,
        kpis: [
          ['On the roster', '6', '3 on duty · 1 home time'],
          ['Available now', '2', 'Both reset today'],
          ['Hours at risk', '1', 'Nakamura · 1h 45m'],
          ['Docs to renew', '4', 'On the watchlist below'],
        ],
        card: 'Roster',
      },
      {
        tab: 'Trucks',
        url: /\/app\/fleet\/trucks$/,
        kpis: [
          ['Power units', '6', 'Avg 380K mi'],
          ['In service', '4', 'Of 6 units'],
          ['In shop', '1', 'T-118 · turbo'],
          ['Service due', '1', 'T-114 in 900 mi'],
        ],
        card: 'Power units',
      },
      {
        tab: 'Trailers',
        url: /\/app\/fleet\/trailers$/,
        kpis: [
          ['Trailers', '8', '3 reefer · 3 dry van · 2 flatbed'],
          ['Loaded', '4', '1 rolling · 3 at shippers'],
          ['Empty', '3', '2 at the Modesto yard'],
          ['Inspection', '1', 'FB-12 · annual DOT'],
        ],
        card: 'Trailers',
      },
    ]);
    await expect(page.locator('.ui-card-title')).toHaveCount(1);
  });

  test('CRM', async ({ page }) => {
    await openSection(page, 'CRM');
    await expect(page).toHaveURL(/\/app\/crm$/);
    await expectKpis(page, [
      ['Accounts', '6', '2 key accounts'],
      ['Revenue YTD', '$0.1M', 'Top 3 accounts = 60%'],
      ['On time', '97%', 'Weighted by loads'],
      ['Open AR', '$26.2K', '1 account at risk'],
    ]);
    await expect(page.locator('.ui-table tbody tr')).toHaveCount(6);
  });

  test('Accounting tabs', async ({ page }) => {
    await openSection(page, 'Accounting');
    await expect(page.getByRole('button', { name: 'Invoice 11 loads' })).toBeVisible();
    await checkTabs(page, TABS.accounting, [
      {
        url: /\/app\/accounting\/uninvoiced$/,
        kpis: [
          ['Loads', '11', 'Delivered, not yet invoiced'],
          ['Amount waiting', '$34,900', 'Across 6 customers'],
          ['Missing POD', '3', 'Cannot invoice until attached'],
          ['Oldest (days)', '7', 'L-40199 · delivered Aug 27'],
        ],
        card: 'Delivered, not yet invoiced',
      },
      {
        tab: 'Invoiced',
        url: /\/app\/accounting\/invoiced$/,
        kpis: [
          ['Current', '$11,520', '5 invoices'],
          ['1–30 days', '$13,070', '4 invoices'],
          ['31–60 days', '$1,590', '1 invoices'],
          ['60+ days', '$0', '0 invoices · collections'],
        ],
        card: 'Open invoices',
      },
      {
        tab: 'Batches',
        url: /\/app\/accounting\/batches$/,
        kpis: [
          ['Batches', '7', '12 invoices'],
          ['Ready to send', '2', '$12,980 to go out'],
          ['Sent this week', '2', 'Last 7 days'],
          ['Total batched', '$30,780', 'Ready, sent and settled'],
        ],
        card: 'Invoice batches',
      },
      {
        tab: 'Past Due',
        url: /\/app\/accounting\/past-due$/,
        kpis: [
          ['Overdue invoices', '5', 'Past terms'],
          ['Amount overdue', '$14,660', '2 in collections (60+ days)'],
          ['Oldest', '67 d', 'INV-8811 · Sierra Ag Partners'],
          ['Accounts affected', '4', 'of 6 accounts'],
        ],
        card: 'Past due',
      },
      {
        tab: 'Paid',
        url: /\/app\/accounting\/paid$/,
        kpis: [
          ['Paid this month', '5', 'September'],
          ['Amount', '$13,980', 'Collected this month'],
          ['Avg days to pay', '15', 'Issued to paid'],
          ['Paid via factoring', '2', 'TriPoint Capital · $4,940'],
        ],
        card: 'Paid invoices',
      },
      {
        tab: 'Payroll',
        url: /\/app\/accounting\/payroll$/,
        kpis: [
          ['Drivers', '5', '3 ready to approve'],
          ['Gross', '$5,477', 'Week of Sep 1'],
          ['Deductions', '$512', 'Fuel advances and escrow'],
          ['Net payable', '$4,965', 'Awaiting approval'],
        ],
        card: 'Driver settlements · week of Sep 1',
      },
      {
        tab: 'Bills',
        url: /\/app\/accounting\/bills$/,
        kpis: [
          ['Due this week', '3', '$15,000'],
          ['Overdue', '1', '$486'],
          ['Scheduled', '2', '$10,360 · auto-pay'],
          ['Paid this month', '2', '$4,115'],
        ],
        card: 'Bills',
      },
    ]);
  });

  test('HR tabs', async ({ page }) => {
    await openSection(page, 'HR');
    await checkTabs(page, TABS.hr, [
      {
        url: /\/app\/hr\/employee-contracts$/,
        kpis: [
          ['Active contracts', '6', '10 on file'],
          ['Renewals due (30 d)', '2', 'Raman Sep 20 · Nakamura Oct 1'],
          ['Owner-operators', '1', 'Frey · lease-purchase ends Nov 15'],
          ['Drafts', '1', 'Reed · starts Sep 8'],
        ],
        card: 'Employee contracts',
      },
      {
        tab: 'Onboarding',
        url: /\/app\/hr\/onboarding$/,
        kpis: [
          ['In progress', '5', '1 in orientation'],
          ['Starting this week', '2', 'Opened since Mon Aug 31'],
          ['Awaiting documents', '2', 'MVR consent · medical card'],
          ['Completed this quarter', '1', 'Since Jul 1'],
        ],
        card: 'Onboarding',
      },
    ]);
  });

  test('Safety tabs', async ({ page }) => {
    await openSection(page, 'Safety');
    await checkTabs(page, TABS.safety, [
      {
        url: /\/app\/safety\/maintenance$/,
        kpis: [
          ['Open work orders', '7', '1 done · last 30 d'],
          ['In shop', '2', 'Sunridge shop · Modesto'],
          ['Overdue', '1', 'T-121 · Brake adjustment'],
          ['Est. cost open', '$7,115', 'Parts & labor, open orders'],
        ],
        card: 'Work orders',
      },
      {
        tab: 'Driver Documents',
        url: /\/app\/safety\/driver-documents$/,
        kpis: [
          ['Documents', '15', '6 drivers on file'],
          ['Expiring (60 d)', '4', 'Renew before Nov 2'],
          ['Expired', '1', 'Priya Raman · CDL'],
          ['Missing', '1', 'Tobias Frey · Drug test'],
        ],
        card: 'Driver qualification files',
      },
      {
        tab: 'Violations',
        url: /\/app\/safety\/violations$/,
        kpis: [
          ['Open', '2', 'Corrective action pending'],
          ['Points (12 mo)', '29', 'CSA severity · 7 violations'],
          ['Contested', '1', 'DataQ challenge filed'],
          ['Closed', '4', 'Resolved, on file'],
        ],
        card: 'Roadside inspections & violations',
      },
      {
        tab: 'Settlements',
        url: /\/app\/safety\/settlements$/,
        kpis: [
          ['Open claims', '2', '1 under review'],
          ['Reserved', '$11,000', 'On open claims'],
          ['Paid YTD', '$24,025', '3 settlements'],
          ['Settled', '3', '1 denied'],
        ],
        card: 'Claims',
      },
    ]);
  });

  test('a full page load of a tab is server-rendered with its figures', async ({ page }) => {
    await page.goto('/app/safety/violations');
    await expectKpis(page, [
      ['Open', '2'],
      ['Points (12 mo)', '29'],
      ['Contested', '1'],
      ['Closed', '4'],
    ]);
    await expect(page.locator('.ui-table tbody tr')).toHaveCount(7);
  });
});
