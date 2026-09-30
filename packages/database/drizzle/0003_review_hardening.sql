CREATE TYPE "public"."planner_default_set" AS ENUM('standard', 'runtruck1_demo');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "planner_defaults" "planner_default_set" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
CREATE INDEX "load_stops_org_completed_idx" ON "load_stops" USING btree ("organization_id","completed_at") WHERE "load_stops"."completed_at" is not null;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_total_ck" CHECK ("loads"."line_haul_cents"::bigint + "loads"."fuel_surcharge_cents" + "loads"."accessorial_cents" <= 2147483647);--> statement-breakpoint
ALTER TABLE "planner_events" ADD CONSTRAINT "planner_events_span_ck" CHECK ("planner_events"."end_date" is null or "planner_events"."end_date" - "planner_events"."start_date" <= 366);