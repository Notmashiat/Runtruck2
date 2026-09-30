import type { Type } from '@nestjs/common';
import { CarriersModule } from '../carriers/carriers.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { TrailersModule } from '../trailers/trailers.module.js';
import { TrucksModule } from '../trucks/trucks.module.js';

// NestJS modules owned by the fleet-crm domain group (architecture §6). Add each module
// class here; app.module.ts picks them up through domain-modules.ts.
export const MODULES: Type[] = [DriversModule, TrucksModule, TrailersModule, CustomersModule, CarriersModule, LocationsModule];
