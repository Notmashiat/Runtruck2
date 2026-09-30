import { Injectable } from '@nestjs/common';
import type { DbExecutor } from '@runtruck/database';
import type { AuthContext } from '../auth/auth-context.js';
import type { ErrorIssue } from '../common/errors/app-error.js';
import { ClockService } from '../common/clock/clock.service.js';
import { evaluateDriverCompliance, type ComplianceWarning } from './compliance.js';
import { dispatchValues, type Haul } from './dispatch-rules.js';
import { DispatchRepository } from './dispatch.repository.js';

export interface HaulResolution {
  // Field issues of 09 §3.1 E2, E4, E5 (loads.md §6.3 S3, S4); empty when the haul is valid.
  issues: ErrorIssue[];
  // loads.carrier_id: the partner, or the organization's own-fleet carrier (null if none).
  carrierId: string | null;
  // C27: problems in the assigned own-fleet driver's file; null when no driver is assigned.
  complianceWarnings: ComplianceWarning[] | null;
}

// Dispatch assignment happens only through backend logic (architecture §19). New Load is
// the only path in this release; D1–D8 availability rules are deferred (09 §3.2).
@Injectable()
export class DispatchService {
  constructor(
    private readonly repo: DispatchRepository,
    private readonly clock: ClockService,
  ) {}

  async resolveHaul(ctx: AuthContext, haul: Haul): Promise<HaulResolution> {
    const org = ctx.organizationId;
    const issues: ErrorIssue[] = [];

    if (haul.hauledBy === 'partner_carrier') {
      // S4 / E2 + E4: a carrier of the organization, and not its own authority.
      if (haul.carrierId !== null) {
        const carrier = await this.repo.findCarrier(org, haul.carrierId);
        if (!carrier) issues.push({ path: 'haul.carrierId', message: 'Carrier was not found.' });
        else if (carrier.isOwnFleet) issues.push({ path: 'haul.carrierId', message: 'Choose a partner carrier.' });
      }
      return { issues, carrierId: haul.carrierId, complianceWarnings: null };
    }

    // S3 / E2 + E5: own-fleet references exist in the organization; the driver is active.
    let complianceWarnings: ComplianceWarning[] | null = null;
    if (haul.driverId !== null) {
      const driver = await this.repo.findDriver(org, haul.driverId);
      if (!driver) issues.push({ path: 'haul.driverId', message: 'Driver was not found.' });
      else if (!driver.employeeActive) issues.push({ path: 'haul.driverId', message: 'This driver is not active.' });
      else complianceWarnings = evaluateDriverCompliance(driver.id, await this.repo.driverDocuments(org, driver.id), this.clock.today(ctx.timezone));
    }
    if (haul.truckId !== null && !(await this.repo.truckExists(org, haul.truckId))) issues.push({ path: 'haul.truckId', message: 'Truck was not found.' });
    if (haul.trailerId !== null && !(await this.repo.trailerExists(org, haul.trailerId))) issues.push({ path: 'haul.trailerId', message: 'Trailer was not found.' });

    return { issues, carrierId: await this.repo.ownFleetCarrierId(org), complianceWarnings };
  }

  // Writes the live dispatch (status assigned, assigned now by the caller); null when the
  // haul assigns nothing concrete yet.
  async assign(tx: DbExecutor, ctx: AuthContext, loadId: string, haul: Haul, assignedAt: Date): Promise<string | null> {
    const values = dispatchValues(haul);
    if (!values) return null;
    return this.repo.insertDispatch(tx, ctx.organizationId, loadId, values, assignedAt, ctx.userId);
  }
}
