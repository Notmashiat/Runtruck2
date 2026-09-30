import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { addDaysIso, firstUnusedPlannerTone, formatLoadNumber, plannerStopValues } from '@runtruck/calculations';
import type { DbExecutor } from '@runtruck/database';
import { insertPlannerDefaults } from '@runtruck/database/seed';
import { hasPermissions } from '@runtruck/permissions';
import type {
  PageMeta,
  PlannerColorCodeDeleteResultDto,
  PlannerColorCodeDto,
  PlannerColorCodesMeta,
  PlannerEventDeleteResultDto,
  PlannerEventDto,
  PlannerEventsMeta,
  PlannerRelatedLoadDto,
  PlannerResetResultDto,
  PlannerStopValuesDto,
} from '@runtruck/types';
import {
  type PlannerColorCodeCreateInput,
  type PlannerColorCodeUpdateInput,
  type PlannerEventCreateInput,
  plannerEventCreateSchema,
  type PlannerEventsQuery,
  type PlannerEventUpdateInput,
  type PlannerRelatedLoadsQuery,
} from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { Q_SCAN_LIMIT } from '../common/list/list-query.js';
import { EventsService } from '../events/events.service.js';
import { loadEndpoints } from '../loads/load-endpoints.js';
import {
  changedEventFields,
  colorCodeDto,
  concatPage,
  eventColumns,
  fallbackColorCode,
  likeContains,
  mergeEventPatch,
  nextPosition,
  officeEventDto,
  pickFields,
  stopEventDto,
  storedEventFields,
} from './planner.mapper.js';
import {
  colorCodeCreatedAudit,
  colorCodeCreatedEvent,
  colorCodeDeletedAudit,
  colorCodeDeletedEvent,
  colorCodeUpdatedAudit,
  colorCodeUpdatedEvent,
  eventCreatedAudit,
  eventCreatedEvent,
  eventDeletedAudit,
  eventDeletedEvent,
  eventUpdatedAudit,
  eventUpdatedEvent,
  resetAudit,
  resetEvent,
} from './planner.events.js';
import { PlannerRepository } from './planner.repository.js';

// "An organization can have at most 100 color codes" (docs/api/planner.md §3.6, P5).
export const PLANNER_MAX_COLOR_CODES = 100;

// An all-day event spans at most 366 days, so an event overlapping `from` starts at most
// this many days earlier (§3.1).
const MAX_SPAN_DAYS = 366;

const EVENT_NOT_FOUND = () => AppError.notFound('PLANNER_EVENT_NOT_FOUND', 'Event was not found.');
const COLOR_CODE_NOT_FOUND = () => AppError.notFound('PLANNER_COLOR_CODE_NOT_FOUND', 'Color code was not found.');

// The shared organization calendar (docs/01 D8; docs/api/planner.md). Organization, user,
// timezone and permissions come from the session only.
@Injectable()
export class PlannerService {
  constructor(
    private readonly repository: PlannerRepository,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private get db() {
    return this.repository.database;
  }

  // ─── GET /planner/events (§3.1) ─────────────────────────────────────────────────────

  async listEvents(ctx: AuthContext, query: PlannerEventsQuery): Promise<{ data: PlannerEventDto[]; meta: PlannerEventsMeta }> {
    const pattern = query.q ? likeContains(query.q) : undefined;
    const take = query.offset + query.limit;
    const withStops = hasPermissions(ctx.permissions, ['loads.view']);
    const [office, stops] = await Promise.all([
      this.repository.officeEvents(
        ctx.organizationId,
        { from: query.from, to: query.to, earliestStart: addDaysIso(query.from, -MAX_SPAN_DAYS), pattern },
        take,
      ),
      withStops
        ? this.repository.stopEvents(ctx.organizationId, { from: query.from, to: query.to, pattern }, take)
        : Promise.resolve({ rows: [], total: 0 }),
    ]);
    const data = concatPage(
      office.rows.map((r) => officeEventDto(r, ctx.timezone)),
      stops.rows.map(stopEventDto),
      query.offset,
      query.limit,
    );
    return { data, meta: { total: office.total + stops.total, limit: query.limit, offset: query.offset, from: query.from, to: query.to } };
  }

  // ─── POST /planner/events (§3.2) ────────────────────────────────────────────────────

  async createEvent(ctx: AuthContext, body: PlannerEventCreateInput): Promise<PlannerEventDto> {
    if (body.loadId !== null) this.assertMayRelateLoads(ctx);
    return this.db.transaction(async (tx) => {
      await this.checkColorCode(tx, ctx, body.colorCodeId);
      if (body.loadId !== null) await this.checkBoardLoad(tx, ctx, body.loadId);
      const id = await this.repository.insertEvent(tx, {
        organizationId: ctx.organizationId,
        ...eventColumns(body),
        createdByUserId: ctx.userId,
      });
      await this.audit.record(tx, ctx, eventCreatedAudit(id, body));
      await this.events.emit(tx, ctx, eventCreatedEvent(id, body));
      return this.officeEvent(tx, ctx, id);
    });
  }

  // ─── PATCH /planner/events/:id (§3.3) ───────────────────────────────────────────────

  async updateEvent(ctx: AuthContext, id: string, patch: PlannerEventUpdateInput): Promise<PlannerEventDto> {
    return this.db.transaction(async (tx) => {
      const stored = await this.repository.eventForUpdate(tx, ctx.organizationId, id);
      if (!stored) throw EVENT_NOT_FOUND();
      const before = storedEventFields(stored);
      const parsed = plannerEventCreateSchema.safeParse(mergeEventPatch(before, patch));
      if (!parsed.success) throw AppError.validation(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      const after = parsed.data;

      if (after.colorCodeId !== before.colorCodeId) await this.checkColorCode(tx, ctx, after.colorCodeId);
      // An unchanged related load is not re-checked, so a link to a since-archived load stays.
      if (after.loadId !== null && after.loadId !== before.loadId) {
        this.assertMayRelateLoads(ctx);
        await this.checkBoardLoad(tx, ctx, after.loadId);
      }

      const changed = changedEventFields(before, after);
      if (changed.length > 0) {
        await this.repository.updateEvent(tx, ctx.organizationId, id, eventColumns(after));
        await this.audit.record(tx, ctx, eventUpdatedAudit(id, after.title, pickFields(before, changed), pickFields(after, changed)));
        await this.events.emit(tx, ctx, eventUpdatedEvent(id, changed));
      }
      return this.officeEvent(tx, ctx, id);
    });
  }

  // ─── DELETE /planner/events/:id (§3.4) ──────────────────────────────────────────────

  async deleteEvent(ctx: AuthContext, id: string): Promise<PlannerEventDeleteResultDto> {
    return this.db.transaction(async (tx) => {
      const deleted = await this.repository.deleteEvent(tx, ctx.organizationId, id);
      if (!deleted) throw EVENT_NOT_FOUND();
      await this.audit.record(tx, ctx, eventDeletedAudit(id, storedEventFields(deleted)));
      await this.events.emit(tx, ctx, eventDeletedEvent(id));
      return { id };
    });
  }

  // ─── color codes (§3.5–§3.8) ────────────────────────────────────────────────────────

  async listColorCodes(ctx: AuthContext): Promise<{ data: PlannerColorCodeDto[]; meta: PlannerColorCodesMeta }> {
    const rows = await this.repository.colorCodes(this.db, ctx.organizationId);
    return { data: rows.map(colorCodeDto), meta: { total: rows.length } };
  }

  async createColorCode(ctx: AuthContext, body: PlannerColorCodeCreateInput): Promise<PlannerColorCodeDto> {
    return this.db.transaction(async (tx) => {
      const existing = await this.repository.colorCodesForUpdate(tx, ctx.organizationId);
      if (existing.length >= PLANNER_MAX_COLOR_CODES) {
        throw AppError.conflict('PLANNER_COLOR_CODE_LIMIT', `An organization can have at most ${PLANNER_MAX_COLOR_CODES} color codes.`);
      }
      const id = randomUUID();
      const fields = {
        key: `code-${id}`,
        label: body.label ?? 'New color code',
        tone: body.tone ?? firstUnusedPlannerTone(existing.map((c) => c.tone)),
      };
      await this.repository.insertColorCode(tx, {
        id,
        organizationId: ctx.organizationId,
        ...fields,
        isLocked: false,
        position: nextPosition(existing.map((c) => c.position)),
      });
      await this.audit.record(tx, ctx, colorCodeCreatedAudit(id, fields));
      await this.events.emit(tx, ctx, colorCodeCreatedEvent(id));
      return { id, ...fields, locked: false, eventCount: 0 };
    });
  }

  async updateColorCode(ctx: AuthContext, id: string, patch: PlannerColorCodeUpdateInput): Promise<PlannerColorCodeDto> {
    return this.db.transaction(async (tx) => {
      const code = await this.repository.colorCodeForUpdate(tx, ctx.organizationId, id);
      if (!code) throw COLOR_CODE_NOT_FOUND();
      // key and is_locked never change; locked codes may be renamed and recoloured (B16).
      const next = { label: patch.label ?? code.label, tone: patch.tone ?? code.tone };
      const changed = (['label', 'tone'] as const).filter((k) => next[k] !== code[k]);
      if (changed.length > 0) {
        await this.repository.updateColorCode(tx, ctx.organizationId, id, pickFields(next, changed));
        await this.audit.record(tx, ctx, colorCodeUpdatedAudit(id, next.label, pickFields(code, changed), pickFields(next, changed)));
        await this.events.emit(tx, ctx, colorCodeUpdatedEvent(id, changed));
      }
      const [row] = await this.repository.colorCodes(tx, ctx.organizationId, id);
      if (!row) throw COLOR_CODE_NOT_FOUND();
      return colorCodeDto(row);
    });
  }

  async deleteColorCode(ctx: AuthContext, id: string): Promise<PlannerColorCodeDeleteResultDto> {
    return this.db.transaction(async (tx) => {
      // Locks every code, so two concurrent deletes cannot remove the last two unlocked codes.
      const all = await this.repository.colorCodesForUpdate(tx, ctx.organizationId);
      const target = all.find((c) => c.id === id);
      if (!target) throw COLOR_CODE_NOT_FOUND();
      if (target.isLocked) throw AppError.conflict('PLANNER_COLOR_CODE_LOCKED', "Load-board color codes can't be deleted.");
      const fallback = fallbackColorCode(all, id);
      if (!fallback) throw AppError.conflict('PLANNER_LAST_COLOR_CODE', 'Keep at least one color code for your own events.');

      const reassignedEventCount = await this.repository.reassignEvents(tx, ctx.organizationId, id, fallback.id);
      await this.repository.deleteColorCode(tx, ctx.organizationId, id);
      const fields = { key: target.key, label: target.label, tone: target.tone };
      await this.audit.record(tx, ctx, colorCodeDeletedAudit(id, fields, fallback.id, reassignedEventCount));
      await this.events.emit(tx, ctx, colorCodeDeletedEvent(id, fallback.id, reassignedEventCount));
      return { id, reassignedToColorCodeId: fallback.id, reassignedEventCount };
    });
  }

  // ─── GET /planner/stop-values (§3.9) ────────────────────────────────────────────────

  async stopValues(ctx: AuthContext): Promise<PlannerStopValuesDto> {
    if (!hasPermissions(ctx.permissions, ['loads.view'])) {
      return { driver: [], customer: [], truck: [], sampleEvent: await this.firstOfficeEvent(ctx) };
    }
    const [values, pickup] = await Promise.all([
      this.repository.stopValueRows(ctx.organizationId),
      this.repository.stopEvents(ctx.organizationId, { kind: 'pickup' }, 1),
    ]);
    const first = pickup.rows[0];
    return {
      driver: plannerStopValues(values, 'driver'),
      customer: plannerStopValues(values, 'customer'),
      truck: plannerStopValues(values, 'truck'),
      sampleEvent: first ? stopEventDto(first) : await this.firstOfficeEvent(ctx),
    };
  }

  // ─── GET /planner/related-loads (§3.10) ─────────────────────────────────────────────

  async relatedLoads(ctx: AuthContext, query: PlannerRelatedLoadsQuery): Promise<{ data: PlannerRelatedLoadDto[]; meta: PageMeta }> {
    const q = query.q?.trim().toLowerCase() ?? '';
    const page = await this.repository.boardLoads(ctx.organizationId, q ? Q_SCAN_LIMIT : query.limit, q ? 0 : query.offset);
    const routes = await loadEndpoints(
      this.db,
      ctx.organizationId,
      page.rows.map((r) => r.id),
    );
    const rows: PlannerRelatedLoadDto[] = page.rows.map((r) => ({
      id: r.id,
      loadNumber: r.loadNumber,
      route: routes.get(r.id)?.route ?? '—',
    }));
    if (!q) return { data: rows, meta: { total: page.total, limit: query.limit, offset: query.offset } };
    // q over the option's load number and route (§2.6 semantics), within the scan cap.
    const matches = rows.filter((r) => formatLoadNumber(r.loadNumber).toLowerCase().includes(q) || r.route.toLowerCase().includes(q));
    return {
      data: matches.slice(query.offset, query.offset + query.limit),
      meta: { total: matches.length, limit: query.limit, offset: query.offset },
    };
  }

  // ─── POST /planner/reset (§3.11) ────────────────────────────────────────────────────

  async reset(ctx: AuthContext): Promise<PlannerResetResultDto> {
    return this.db.transaction(async (tx) => {
      // A concurrent event create waits on its share lock, then finds its code gone (400).
      await this.repository.colorCodesForUpdate(tx, ctx.organizationId);
      const previous = await this.repository.calendarCounts(tx, ctx.organizationId);
      await this.repository.deleteCalendar(tx, ctx.organizationId);
      // The seed's own function: the organization's defaults per organizations.planner_defaults.
      const written = await insertPlannerDefaults(tx, ctx.organizationId);
      const next = { eventCount: written.eventCount, colorCodeCount: written.colorCodeCount };
      const name = await this.repository.organizationName(tx, ctx.organizationId);
      await this.audit.record(tx, ctx, resetAudit(ctx.organizationId, name, previous, next));
      await this.events.emit(tx, ctx, resetEvent(ctx.organizationId, next));
      return next;
    });
  }

  // ─── helpers ────────────────────────────────────────────────────────────────────────

  // §2.3: setting or changing a related load exposes load data, so it needs loads.view.
  private assertMayRelateLoads(ctx: AuthContext): void {
    if (!hasPermissions(ctx.permissions, ['loads.view'])) throw AppError.forbidden();
  }

  // §3.2 step 1: an unlocked code of the organization, share-locked.
  private async checkColorCode(tx: DbExecutor, ctx: AuthContext, colorCodeId: string): Promise<void> {
    const code = await this.repository.colorCodeForShare(tx, ctx.organizationId, colorCodeId);
    if (!code) throw AppError.validation([{ path: 'colorCodeId', message: 'Choose one of your color codes.' }]);
    if (code.isLocked)
      throw AppError.validation([{ path: 'colorCodeId', message: "Load-board color codes can't be used for your own events." }]);
  }

  // §3.2 step 2: a board (non-archived) load of the organization.
  private async checkBoardLoad(tx: DbExecutor, ctx: AuthContext, loadId: string): Promise<void> {
    const load = await this.repository.boardLoad(tx, ctx.organizationId, loadId);
    if (!load) throw AppError.validation([{ path: 'loadId', message: 'Choose a load from the board.' }]);
  }

  private async officeEvent(tx: DbExecutor, ctx: AuthContext, id: string): Promise<PlannerEventDto> {
    const row = await this.repository.officeEventById(tx, ctx.organizationId, id);
    if (!row) throw EVENT_NOT_FOUND();
    return officeEventDto(row, ctx.timezone);
  }

  private async firstOfficeEvent(ctx: AuthContext): Promise<PlannerEventDto | null> {
    const row = await this.repository.firstOfficeEvent(ctx.organizationId);
    return row ? officeEventDto(row, ctx.timezone) : null;
  }
}
