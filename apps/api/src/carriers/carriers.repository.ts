import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@runtruck/database';
import type { CarrierListItem } from '@runtruck/types';
import { eq } from 'drizzle-orm';
import { type Database, DB } from '../database/database.module.js';

const { carriers } = schema;

@Injectable()
export class CarriersRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Every carrier of the organization, own authority first by position
  // (docs/api/carriers.md §2.4).
  async listAll(organizationId: string): Promise<CarrierListItem[]> {
    return this.db
      .select({
        id: carriers.id,
        name: carriers.name,
        mcNumber: carriers.mcNumber,
        dotNumber: carriers.dotNumber,
        isOwnFleet: carriers.isOwnFleet,
      })
      .from(carriers)
      .where(eq(carriers.organizationId, organizationId))
      .orderBy(carriers.position, carriers.id);
  }
}
