import { Injectable } from '@nestjs/common';
import { formatLoadNumber, loadRowMatches, toLoadSearchRow } from '@runtruck/calculations';
import type { Transaction } from '@runtruck/database';
import { hasPermissions } from '@runtruck/permissions';
import type { LoadDetail, LoadListItem, LoadListMeta } from '@runtruck/types';
import { type CreateLoadBody, LOAD_BOARD_VIEW_STATUSES, LOAD_DOCUMENT_TYPES, type ListLoadsQuery } from '@runtruck/validation';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { AppError, type ErrorIssue } from '../common/errors/app-error.js';
import { Q_SCAN_LIMIT } from '../common/list/list-query.js';
import { dispatchValues, haulAssigns, payColumns } from '../dispatch/dispatch-rules.js';
import { DispatchService, type HaulResolution } from '../dispatch/dispatch.service.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import { EventsService } from '../events/events.service.js';
import { groupStopsByLoad, queryLoadStopRows } from './load-endpoints.js';
import { initialLoadStatus } from './load-status.js';
import { boardSummary, toDetail, toListItem, type LoadListRow } from './loads.mapper.js';
import { LoadsRepository, type NewLoadStopRow } from './loads.repository.js';

const loadNotFound = () => AppError.notFound('LOAD_NOT_FOUND', 'Load was not found.');

// A value the create schema's Runtruck1 rules guarantee (they refuse a body without it).
function required<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined) throw new Error(`createLoadSchema let ${field} through empty`);
  return value;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const pg = e as Error & { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === constraint) return true;
  }
  return false;
}

@Injectable()
export class LoadsService {
  constructor(
    private readonly repo: LoadsRepository,
    private readonly documents: DocumentsRepository,
    private readonly dispatch: DispatchService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly clock: ClockService,
  ) {}

  // GET /loads (docs/api/loads.md §3).
  async list(ctx: AuthContext, query: ListLoadsQuery): Promise<{ data: LoadListItem[]; meta: LoadListMeta }> {
    const org = ctx.organizationId;
    const statuses = query.view === 'all' ? null : LOAD_BOARD_VIEW_STATUSES[query.view];
    const q = query.q ?? '';

    if (q === '') {
      const [counts, rows] = await Promise.all([this.repo.boardStatusCounts(org), this.repo.boardPage(org, statuses, query.limit, query.offset)]);
      const summary = boardSummary(counts);
      // The view's row count is its summary count: the same filter (board loads of the
      // view's statuses), so no window count over the whole view is needed.
      const total = summary.views[query.view];
      return { data: await this.hydrate(org, rows), meta: { total, limit: query.limit, offset: query.offset, summary } };
    }

    // With q: the newest Q_SCAN_LIMIT rows of the view, matched over the shared view-model
    // rows (the web's search), then paged.
    const [counts, scan] = await Promise.all([this.repo.boardStatusCounts(org), this.repo.boardPage(org, statuses, Q_SCAN_LIMIT, 0)]);
    const summary = boardSummary(counts);
    const context = { timeZone: ctx.timezone, today: this.clock.today(ctx.timezone) };
    const matches = (await this.hydrate(org, scan)).filter((item) => loadRowMatches(toLoadSearchRow(item, context), q));
    return {
      data: matches.slice(query.offset, query.offset + query.limit),
      meta: { total: matches.length, limit: query.limit, offset: query.offset, summary },
    };
  }

  // Stops and live dispatches for the page's loads: two statements, whatever the page size.
  private async hydrate(org: string, rows: readonly LoadListRow[]): Promise<LoadListItem[]> {
    const ids = rows.map((r) => r.id);
    const [stops, dispatches] = await Promise.all([queryLoadStopRows(this.repo.database, org, ids), this.repo.liveDispatches(org, ids)]);
    const stopsByLoad = groupStopsByLoad(stops);
    return rows.map((row) => toListItem(row, stopsByLoad.get(row.id) ?? [], dispatches.get(row.id) ?? null));
  }

  // GET /loads/by-number/:n and GET /loads/:id (§4): board and archived loads both resolve.
  async detail(ctx: AuthContext, by: { id: string } | { loadNumber: number }): Promise<LoadDetail> {
    const org = ctx.organizationId;
    const row = await this.repo.detail(org, by);
    if (!row) throw loadNotFound();
    const canSeeDocuments = hasPermissions(ctx.permissions, ['documents.view']);
    const [stops, dispatches, documents, activity] = await Promise.all([
      queryLoadStopRows(this.repo.database, org, [row.id]),
      this.repo.liveDispatches(org, [row.id]),
      canSeeDocuments ? this.documents.list(org, row.id) : Promise.resolve(null),
      this.repo.activity(org, row.id),
    ]);
    return toDetail(row, stops, dispatches.get(row.id) ?? null, documents, activity);
  }

  // POST /loads — New Load (§6).
  async create(ctx: AuthContext, body: CreateLoadBody): Promise<LoadDetail> {
    const org = ctx.organizationId;

    // S1 (E1): an assignment also needs loads.assign.
    const assigns = haulAssigns(body.haul);
    if (assigns && !hasPermissions(ctx.permissions, ['loads.assign'])) throw AppError.forbidden();

    // S2–S4: every body reference resolves inside the organization (unknown and foreign
    // ids answer alike, L7); the issues land in their New Load sections.
    const issues: ErrorIssue[] = [];
    const customerIds = [body.customerId, body.billToCustomerId].filter((id): id is string => id !== null);
    const known = await this.repo.existingCustomerIds(org, customerIds);
    if (body.customerId !== null && !known.has(body.customerId)) issues.push({ path: 'customerId', message: 'Customer was not found.' });
    if (body.billToCustomerId !== null && !known.has(body.billToCustomerId)) issues.push({ path: 'billToCustomerId', message: 'Customer was not found.' });
    const haul = await this.dispatch.resolveHaul(ctx, body.haul);
    issues.push(...haul.issues);
    if (issues.length > 0) throw AppError.validation(issues);

    const creatorName = (await this.repo.userFullName(ctx.userId)) ?? '';
    const now = this.clock.now(ctx.timezone);

    let loadId: string;
    try {
      loadId = await this.repo.database.transaction((tx) => this.insertLoad(tx, ctx, body, haul, assigns, creatorName, now));
    } catch (err) {
      if (isUniqueViolation(err, 'loads_org_number_uq')) throw AppError.conflict('LOAD_NUMBER_CONFLICT', 'Another load took this number. Try again.');
      throw err;
    }
    return this.detail(ctx, { id: loadId });
  }

  // §6.4, one transaction: number, load, stops, dispatch, document slots, activity, audit, events.
  private async insertLoad(
    tx: Transaction,
    ctx: AuthContext,
    body: CreateLoadBody,
    haul: HaulResolution,
    assigns: boolean,
    creatorName: string,
    now: Date,
  ): Promise<string> {
    const org = ctx.organizationId;
    const status = initialLoadStatus(body.haul);
    const loadNumber = await this.repo.allocateLoadNumber(tx, org);
    const partner = body.haul.hauledBy === 'partner_carrier' ? body.haul : null;
    const ltl = body.mode === 'ltl' ? body.ltl : null;

    const loadId = await this.repo.insertLoad(tx, {
      organizationId: org,
      loadNumber,
      customerId: required(body.customerId, 'customerId'),
      billToCustomerId: body.billToCustomerId,
      tenderRef: body.tenderRef,
      customerPo: body.customerPo,
      mode: body.mode,
      equipmentType: body.equipmentType,
      dispatcherName: body.dispatcherName,
      commodity: body.commodity,
      weightLb: body.weightLb,
      pieces: body.pieces,
      packaging: body.packaging,
      declaredValueCents: body.declaredValueCents,
      temperatureF: body.temperatureF === null ? null : String(body.temperatureF),
      hazmat: body.hazmat,
      unNumber: body.hazmat ? body.unNumber : null,
      freightClass: ltl?.freightClass ?? null,
      nmfc: ltl?.nmfc ?? null,
      handlingUnits: ltl?.handlingUnits ?? null,
      lengthIn: ltl?.lengthIn ?? null,
      widthIn: ltl?.widthIn ?? null,
      heightIn: ltl?.heightIn ?? null,
      stackable: ltl?.stackable ?? false,
      ltlServices: ltl?.services ?? [],
      carrierId: haul.carrierId,
      carrierContactName: partner?.carrierContactName ?? null,
      carrierPhone: partner?.carrierPhone ?? null,
      ...payColumns(body.haul),
      lineHaulCents: body.lineHaulCents,
      fuelSurchargeCents: body.fuelSurchargeCents,
      accessorialCents: body.accessorialCents,
      loadedMiles: body.loadedMiles,
      emptyMiles: null,
      operatingCostCents: null,
      paymentTerms: body.paymentTerms,
      status,
      driverInstructions: body.driverInstructions,
      internalNotes: body.internalNotes,
      archivedAt: null,
      createdByUserId: ctx.userId,
    });

    // Free-text stops in the organization's timezone (L11), all pending.
    await this.repo.insertStops(
      tx,
      body.stops.map(
        (s, i): NewLoadStopRow => ({
          organizationId: org,
          loadId,
          sequence: i + 1,
          kind: s.kind,
          status: 'pending',
          facilityId: null,
          facilityName: required(s.facilityName, `stops.${i}.facilityName`),
          addressLine1: s.addressLine1,
          city: s.city,
          state: s.state,
          postalCode: s.postalCode,
          timezone: ctx.timezone,
          appointmentDate: required(s.appointmentDate, `stops.${i}.appointmentDate`),
          windowOpen: s.windowOpen,
          windowClose: s.windowClose,
          referenceNumber: s.referenceNumber,
          siteContact: s.siteContact,
        }),
      ),
    );

    const dispatchId = await this.dispatch.assign(tx, ctx, loadId, body.haul, now);
    await this.repo.insertDocumentSlots(tx, org, loadId, LOAD_DOCUMENT_TYPES);
    await this.repo.insertActivity(tx, org, loadId, [
      { kind: 'created', message: `Load created by ${creatorName}`, occurredAt: now, actorUserId: ctx.userId },
      ...(body.driverInstructions !== null
        ? [{ kind: 'driver_instructions' as const, message: `Driver instructions: ${body.driverInstructions}`, occurredAt: now, actorUserId: ctx.userId }]
        : []),
    ]);

    // Audit (architecture §30) and events (§23), in the same transaction.
    const label = formatLoadNumber(loadNumber);
    const compliance = haul.complianceWarnings === null ? {} : { complianceWarnings: haul.complianceWarnings };
    await this.audit.record(tx, ctx, {
      action: 'LOAD_CREATED',
      entityType: 'load',
      entityId: loadId,
      entityLabel: label,
      next: {
        loadNumber,
        status,
        customerId: body.customerId,
        billToCustomerId: body.billToCustomerId,
        carrierId: haul.carrierId,
        lineHaulCents: body.lineHaulCents,
        fuelSurchargeCents: body.fuelSurchargeCents,
        accessorialCents: body.accessorialCents,
        stopCount: body.stops.length,
        ...compliance,
      },
    });
    await this.events.emit(tx, ctx, { type: 'LoadCreated', aggregateType: 'load', aggregateId: loadId, payload: { loadId, loadNumber, status } });

    if (assigns) {
      const d = dispatchValues(body.haul);
      const refs = {
        carrierId: haul.carrierId,
        dispatchId,
        driverId: d?.driverId ?? null,
        truckId: d?.truckId ?? null,
        trailerId: d?.trailerId ?? null,
      };
      await this.audit.record(tx, ctx, {
        action: 'LOAD_ASSIGNED',
        entityType: 'load',
        entityId: loadId,
        entityLabel: label,
        previous: null,
        next: { ...refs, driverName: d?.driverName ?? null, truckNumber: d?.truckNumber ?? null, trailerNumber: d?.trailerNumber ?? null, ...compliance },
      });
      await this.events.emit(tx, ctx, {
        type: 'LoadAssigned',
        aggregateType: 'load',
        aggregateId: loadId,
        payload: { loadId, dispatchId, carrierId: refs.carrierId, driverId: refs.driverId, truckId: refs.truckId, trailerId: refs.trailerId },
      });
    }
    if (status === 'dispatched') {
      await this.events.emit(tx, ctx, { type: 'LoadDispatched', aggregateType: 'load', aggregateId: loadId, payload: { loadId, loadNumber } });
    }
    return loadId;
  }
}
