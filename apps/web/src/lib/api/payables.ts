import type { BillRow, BillsMeta } from '@runtruck/types';
import { apiQuery } from './query';

// Accounts payable (docs/api/payables.md §4): every bill, one bounded page.
export const billsQuery = apiQuery<BillRow[], BillsMeta>(['bills'], '/bills?limit=500');
