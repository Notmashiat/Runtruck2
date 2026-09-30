import type { CarrierListItem, PageMeta } from '@runtruck/types';
import { apiQuery, useApiQuery } from './query';

// Carrier reads (docs/api/carriers.md §3): the New Load "Carrier" section (loads group)
// reads the list once, own authority first. Build its strings with toCarrierVm,
// carrierOwnFleetNote and carrierOptionText from @runtruck/calculations.
export const carriersQuery = apiQuery<CarrierListItem[], PageMeta>(['carriers', 'list'], '/carriers?limit=500');

export const useCarriers = (enabled = true) => useApiQuery(carriersQuery, { enabled });
