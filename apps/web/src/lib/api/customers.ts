import type { CustomerListItem, CustomerListMeta, CustomerOption, PageMeta } from '@runtruck/types';
import { apiQuery, useApiQuery } from './query';

// Customer reads (docs/api/customers.md §3). Keys start with 'customers', so New Load's
// invalidate(['customers']) refreshes the CRM after a load is created (decision CU5).

// CRM: every account with its aggregates, KPIs and top-account cards (one bounded page).
export const customersQuery = apiQuery<CustomerListItem[], CustomerListMeta>(['customers', 'list'], '/customers?limit=500');

// New Load "Customer" / "Bill to" selects (customers.md §3.2, decision CU4): id, name and
// default terms only; used by the loads group's NewLoadDialog.
export const customerOptionsQuery = apiQuery<CustomerOption[], PageMeta>(['customers', 'options'], '/customers/options?limit=500');

export const useCustomers = (enabled = true) => useApiQuery(customersQuery, { enabled });
export const useCustomerOptions = (enabled = true) => useApiQuery(customerOptionsQuery, { enabled });
