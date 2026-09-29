CREATE TYPE "public"."member_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."customer_standing" AS ENUM('key_account', 'growing', 'at_risk');--> statement-breakpoint
CREATE TYPE "public"."payment_terms" AS ENUM('net_15', 'net_30', 'net_45', 'net_60', 'quick_pay');--> statement-breakpoint
CREATE TYPE "public"."facility_kind" AS ENUM('shipper', 'consignee', 'crossdock', 'port', 'yard', 'shop');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('active', 'renewal_due', 'expiring', 'draft');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('w2', 'form_1099', 'lease_purchase');--> statement-breakpoint
CREATE TYPE "public"."employee_role" AS ENUM('company_driver', 'owner_operator', 'dispatcher', 'mechanic');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'onboarding');--> statement-breakpoint
CREATE TYPE "public"."onboarding_request_status" AS ENUM('pending', 'received');--> statement-breakpoint
CREATE TYPE "public"."onboarding_stage" AS ENUM('application', 'background_check', 'road_test', 'orientation', 'complete');--> statement-breakpoint
CREATE TYPE "public"."pay_basis" AS ENUM('per_mile', 'percent_of_line_haul', 'annual_salary', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."driver_duty_status" AS ENUM('on_duty', 'available', 'home_time');--> statement-breakpoint
CREATE TYPE "public"."trailer_location_kind" AS ENUM('yard', 'en_route', 'city');--> statement-breakpoint
CREATE TYPE "public"."trailer_status" AS ENUM('loaded', 'empty', 'inspection');--> statement-breakpoint
CREATE TYPE "public"."trailer_type" AS ENUM('reefer', 'dry_van', 'flatbed');--> statement-breakpoint
CREATE TYPE "public"."truck_status" AS ENUM('in_service', 'service_due', 'in_shop');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('assigned', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."equipment_type" AS ENUM('dry_van_53', 'reefer_53', 'flatbed_48', 'flatbed_tarped', 'step_deck_48', 'power_only', 'box_truck_26');--> statement-breakpoint
CREATE TYPE "public"."load_activity_kind" AS ENUM('created', 'driver_instructions', 'driver_accepted', 'arrived', 'document_uploaded', 'invoice_queued', 'consignee_notified');--> statement-breakpoint
CREATE TYPE "public"."load_mode" AS ENUM('ftl', 'ltl', 'partial');--> statement-breakpoint
CREATE TYPE "public"."load_status" AS ENUM('needs_driver', 'dispatched', 'at_pickup', 'in_transit', 'delayed', 'needs_pod', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."ltl_service" AS ENUM('liftgate_pickup', 'liftgate_delivery', 'residential_delivery', 'inside_delivery', 'delivery_appointment', 'limited_access');--> statement-breakpoint
CREATE TYPE "public"."packaging" AS ENUM('pallets', 'skids', 'crates', 'boxes', 'drums', 'totes', 'loose');--> statement-breakpoint
CREATE TYPE "public"."stop_kind" AS ENUM('pickup', 'delivery', 'fuel');--> statement-breakpoint
CREATE TYPE "public"."stop_status" AS ENUM('pending', 'arrived', 'completed');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'attached');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('rate_confirmation', 'customer_load_tender', 'bill_of_lading', 'proof_of_delivery', 'lumper_receipt');--> statement-breakpoint
CREATE TYPE "public"."invoice_batch_status" AS ENUM('ready', 'sent', 'settled');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'overdue', 'paid');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('ach', 'check', 'factoring');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('due', 'overdue', 'scheduled', 'paid');--> statement-breakpoint
CREATE TYPE "public"."settlement_item_kind" AS ENUM('line_pay', 'deduction');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('ready', 'approved', 'on_hold', 'paid');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('open', 'under_review', 'settled', 'denied');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('cargo_damage', 'property_damage', 'bodily_injury', 'cargo_shortage');--> statement-breakpoint
CREATE TYPE "public"."claimant_kind" AS ENUM('customer', 'facility', 'third_party');--> statement-breakpoint
CREATE TYPE "public"."date_precision" AS ENUM('day', 'month');--> statement-breakpoint
CREATE TYPE "public"."driver_document_status" AS ENUM('valid', 'expiring', 'expired', 'missing');--> statement-breakpoint
CREATE TYPE "public"."driver_document_type" AS ENUM('cdl', 'medical_card', 'mvr', 'annual_review', 'drug_test', 'clearinghouse_query');--> statement-breakpoint
CREATE TYPE "public"."violation_status" AS ENUM('open', 'contested', 'closed');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('scheduled', 'due', 'overdue', 'in_shop', 'done');--> statement-breakpoint
CREATE TYPE "public"."planner_tone" AS ENUM('amber', 'green', 'red', 'purple', 'blue', 'teal', 'pink', 'orange', 'indigo', 'slate');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_label" text,
	"previous" jsonb,
	"next" jsonb,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_user_id" uuid,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"publish_attempts" bigint DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "organization_counters" (
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"next_value" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_counters_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"member_number" text NOT NULL,
	"title" text NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"company_number" text NOT NULL,
	"timezone" text NOT NULL,
	"mc_number" text,
	"dot_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_contacts_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"standing" "customer_standing" NOT NULL,
	"payment_terms" "payment_terms" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mc_number" text,
	"dot_number" text,
	"is_own_fleet" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carriers_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "facility_kind" NOT NULL,
	"address_line1" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text,
	"timezone" text NOT NULL,
	"market_city" text,
	"market_state" text,
	"market_short" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facilities_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "employee_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"role" "employee_role" NOT NULL,
	"contract_type" "contract_type" NOT NULL,
	"status" "contract_status" NOT NULL,
	"starts_on" date NOT NULL,
	"renews_on" date NOT NULL,
	"pay_basis" "pay_basis" NOT NULL,
	"pay_rate_cents" integer,
	"pay_percent_bp" integer,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_contracts_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "employee_contracts_dates_ck" CHECK ("employee_contracts"."renews_on" >= "employee_contracts"."starts_on"),
	CONSTRAINT "employee_contracts_pay_ck" CHECK (("employee_contracts"."pay_basis" = 'percent_of_line_haul' and "employee_contracts"."pay_percent_bp" is not null and "employee_contracts"."pay_percent_bp" between 1 and 10000 and "employee_contracts"."pay_rate_cents" is null)
      or ("employee_contracts"."pay_basis" <> 'percent_of_line_haul' and "employee_contracts"."pay_rate_cents" is not null and "employee_contracts"."pay_rate_cents" > 0 and "employee_contracts"."pay_percent_bp" is null))
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"status" "employee_status" NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "onboarding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_name" text NOT NULL,
	"employee_id" uuid,
	"role" "employee_role" NOT NULL,
	"stage" "onboarding_stage" NOT NULL,
	"started_on" date NOT NULL,
	"owner_employee_id" uuid NOT NULL,
	"progress_percent" smallint NOT NULL,
	"next_step" text NOT NULL,
	"next_step_on" date,
	"completed_on" date,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_cases_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "onboarding_cases_progress_ck" CHECK ("onboarding_cases"."progress_percent" between 0 and 100),
	CONSTRAINT "onboarding_cases_completed_ck" CHECK (("onboarding_cases"."stage" = 'complete') = ("onboarding_cases"."completed_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "onboarding_document_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"onboarding_case_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" "onboarding_request_status" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_document_requests_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "driver_mileage_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"recorded_on" date NOT NULL,
	"miles" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_mileage_entries_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "driver_mileage_entries_miles_ck" CHECK ("driver_mileage_entries"."miles" >= 0)
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"duty_status" "driver_duty_status" NOT NULL,
	"hos_remaining_minutes" integer,
	"hos_as_of" timestamp with time zone,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "drivers_hos_ck" CHECK ("drivers"."hos_remaining_minutes" is null or "drivers"."hos_remaining_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trailers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_number" text NOT NULL,
	"trailer_type" "trailer_type" NOT NULL,
	"length_ft" smallint NOT NULL,
	"status" "trailer_status" NOT NULL,
	"location_kind" "trailer_location_kind" NOT NULL,
	"location_facility_id" uuid,
	"location_route" text,
	"location_city" text,
	"location_state" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trailers_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "trailers_length_ck" CHECK ("trailers"."length_ft" > 0),
	CONSTRAINT "trailers_location_ck" CHECK (("trailers"."location_kind" = 'yard' and "trailers"."location_facility_id" is not null)
        or ("trailers"."location_kind" = 'en_route' and "trailers"."location_route" is not null)
        or ("trailers"."location_kind" = 'city' and "trailers"."location_city" is not null and "trailers"."location_state" is not null))
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_number" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"model_year" smallint NOT NULL,
	"plate_state" text NOT NULL,
	"plate_number" text NOT NULL,
	"assigned_driver_id" uuid,
	"odometer_miles" integer NOT NULL,
	"next_service_miles" integer,
	"status" "truck_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trucks_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "trucks_odometer_ck" CHECK ("trucks"."odometer_miles" >= 0 and ("trucks"."next_service_miles" is null or "trucks"."next_service_miles" >= 0))
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"driver_id" uuid,
	"truck_id" uuid,
	"trailer_id" uuid,
	"driver_name" text,
	"truck_number" text,
	"trailer_number" text,
	"status" "dispatch_status" DEFAULT 'assigned' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatches_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "dispatches_party_ck" CHECK (("dispatches"."driver_id" is null or "dispatches"."driver_name" is null) and ("dispatches"."truck_id" is null or "dispatches"."truck_number" is null)
        and ("dispatches"."trailer_id" is null or "dispatches"."trailer_number" is null)),
	CONSTRAINT "dispatches_not_empty_ck" CHECK (coalesce("dispatches"."driver_id"::text, "dispatches"."driver_name", "dispatches"."truck_id"::text, "dispatches"."truck_number", "dispatches"."trailer_id"::text, "dispatches"."trailer_number") is not null)
);
--> statement-breakpoint
CREATE TABLE "load_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" "load_activity_kind" NOT NULL,
	"message" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "load_activity_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "load_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"sequence" smallint NOT NULL,
	"kind" "stop_kind" NOT NULL,
	"status" "stop_status" DEFAULT 'pending' NOT NULL,
	"facility_id" uuid,
	"facility_name" text NOT NULL,
	"address_line1" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"timezone" text NOT NULL,
	"appointment_date" date NOT NULL,
	"window_open" time,
	"window_close" time,
	"planned_start" time,
	"planned_end" time,
	"reference_number" text,
	"site_contact" text,
	"arrived_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "load_stops_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "load_stops_sequence_ck" CHECK ("load_stops"."sequence" >= 1),
	CONSTRAINT "load_stops_place_ck" CHECK ("load_stops"."kind" = 'fuel' or ("load_stops"."city" is not null and "load_stops"."state" is not null)),
	CONSTRAINT "load_stops_planned_ck" CHECK (("load_stops"."planned_start" is null and "load_stops"."planned_end" is null)
        or ("load_stops"."planned_start" is not null and "load_stops"."planned_end" is not null and "load_stops"."planned_end" > "load_stops"."planned_start")),
	CONSTRAINT "load_stops_arrived_ck" CHECK ("load_stops"."arrived_at" is null or "load_stops"."status" in ('arrived', 'completed')),
	CONSTRAINT "load_stops_completed_ck" CHECK ("load_stops"."completed_at" is null or "load_stops"."status" = 'completed')
);
--> statement-breakpoint
CREATE TABLE "loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"load_number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"bill_to_customer_id" uuid,
	"tender_ref" text,
	"customer_po" text,
	"mode" "load_mode",
	"equipment_type" "equipment_type",
	"dispatcher_name" text,
	"commodity" text,
	"weight_lb" integer,
	"pieces" integer,
	"packaging" "packaging",
	"declared_value_cents" integer,
	"temperature_f" numeric(4, 1),
	"hazmat" boolean DEFAULT false NOT NULL,
	"un_number" text,
	"freight_class" text,
	"nmfc" text,
	"handling_units" integer,
	"length_in" integer,
	"width_in" integer,
	"height_in" integer,
	"stackable" boolean DEFAULT false NOT NULL,
	"ltl_services" "ltl_service"[] DEFAULT '{}'::ltl_service[] NOT NULL,
	"carrier_id" uuid,
	"carrier_contact_name" text,
	"carrier_phone" text,
	"carrier_rate_cents" integer,
	"line_haul_cents" integer NOT NULL,
	"fuel_surcharge_cents" integer DEFAULT 0 NOT NULL,
	"accessorial_cents" integer DEFAULT 0 NOT NULL,
	"loaded_miles" integer,
	"empty_miles" integer,
	"driver_pay_cents" integer,
	"operating_cost_cents" integer,
	"payment_terms" "payment_terms" NOT NULL,
	"status" "load_status" NOT NULL,
	"driver_instructions" text,
	"internal_notes" text,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loads_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "loads_number_ck" CHECK ("loads"."load_number" > 0),
	CONSTRAINT "loads_money_ck" CHECK ("loads"."line_haul_cents" >= 0 and "loads"."fuel_surcharge_cents" >= 0 and "loads"."accessorial_cents" >= 0
        and ("loads"."declared_value_cents" is null or "loads"."declared_value_cents" >= 0)
        and ("loads"."operating_cost_cents" is null or "loads"."operating_cost_cents" >= 0)),
	CONSTRAINT "loads_pay_ck" CHECK (("loads"."driver_pay_cents" is null or "loads"."driver_pay_cents" > 0)
        and ("loads"."carrier_rate_cents" is null or "loads"."carrier_rate_cents" > 0)
        and ("loads"."driver_pay_cents" is null or "loads"."carrier_rate_cents" is null)),
	CONSTRAINT "loads_quantities_ck" CHECK (("loads"."loaded_miles" is null or "loads"."loaded_miles" >= 0) and ("loads"."empty_miles" is null or "loads"."empty_miles" >= 0)
        and ("loads"."weight_lb" is null or "loads"."weight_lb" > 0) and ("loads"."pieces" is null or "loads"."pieces" >= 0)
        and ("loads"."handling_units" is null or "loads"."handling_units" > 0)
        and ("loads"."length_in" is null or "loads"."length_in" >= 0) and ("loads"."width_in" is null or "loads"."width_in" >= 0)
        and ("loads"."height_in" is null or "loads"."height_in" >= 0)),
	CONSTRAINT "loads_hazmat_ck" CHECK (not "loads"."hazmat" or "loads"."un_number" is not null),
	CONSTRAINT "loads_ltl_ck" CHECK ("loads"."mode" is distinct from 'ltl' or ("loads"."freight_class" is not null and "loads"."handling_units" is not null)),
	CONSTRAINT "loads_freight_class_ck" CHECK ("loads"."freight_class" is null or "loads"."freight_class" in ('50', '55', '60', '65', '70', '77.5', '85', '92.5', '100', '110', '125', '150', '175', '200', '250', '300', '400', '500')),
	CONSTRAINT "loads_complete_ck" CHECK ("loads"."archived_at" is not null
        or ("loads"."equipment_type" is not null and "loads"."commodity" is not null and "loads"."weight_lb" is not null))
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text,
	"uploaded_by_user_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "document_versions_number_ck" CHECK ("document_versions"."version_number" >= 1 and "document_versions"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"position" smallint NOT NULL,
	"attached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "documents_attached_ck" CHECK (("documents"."status" = 'attached') = ("documents"."attached_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "factoring_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "factoring_companies_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoice_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_batch_items_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoice_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_number" integer NOT NULL,
	"created_on" date NOT NULL,
	"customer_id" uuid,
	"factoring_company_id" uuid,
	"status" "invoice_batch_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_batches_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "invoice_batches_number_ck" CHECK ("invoice_batches"."batch_number" > 0),
	CONSTRAINT "invoice_batches_recipient_ck" CHECK (("invoice_batches"."customer_id" is null) <> ("invoice_batches"."factoring_company_id" is null))
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"load_id" uuid,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_items_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "invoice_items_amount_ck" CHECK ("invoice_items"."amount_cents" >= 0 and "invoice_items"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "invoice_status" NOT NULL,
	"payment_terms" "payment_terms" NOT NULL,
	"issued_on" date,
	"due_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "invoices_number_ck" CHECK ("invoices"."invoice_number" > 0),
	CONSTRAINT "invoices_issued_ck" CHECK (("invoices"."status" = 'draft') = ("invoices"."issued_on" is null)),
	CONSTRAINT "invoices_due_ck" CHECK (("invoices"."issued_on" is null) = ("invoices"."due_on" is null) and ("invoices"."due_on" is null or "invoices"."due_on" >= "invoices"."issued_on"))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"method" "payment_method" NOT NULL,
	"factoring_company_id" uuid,
	"amount_cents" integer NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_factoring_ck" CHECK (("payments"."method" = 'factoring') = ("payments"."factoring_company_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"due_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "bill_status" NOT NULL,
	"scheduled_on" date,
	"paid_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "bills_amount_ck" CHECK ("bills"."amount_cents" > 0),
	CONSTRAINT "bills_paid_ck" CHECK (("bills"."status" = 'paid') = ("bills"."paid_on" is not null)),
	CONSTRAINT "bills_scheduled_ck" CHECK ("bills"."status" <> 'scheduled' or "bills"."scheduled_on" is not null)
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "settlement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "settlement_item_kind" NOT NULL,
	"load_id" uuid,
	"miles" integer,
	"description" text,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_items_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "settlement_items_amount_ck" CHECK (("settlement_items"."kind" = 'line_pay' and "settlement_items"."amount_cents" >= 0 and ("settlement_items"."miles" is null or "settlement_items"."miles" >= 0))
        or ("settlement_items"."kind" = 'deduction' and "settlement_items"."amount_cents" <= 0 and "settlement_items"."miles" is null and "settlement_items"."load_id" is null))
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_basis" "pay_basis" NOT NULL,
	"pay_rate_cents" integer,
	"pay_percent_bp" integer,
	"status" "settlement_status" NOT NULL,
	"hold_reason" text,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "settlements_period_ck" CHECK ("settlements"."period_end" >= "settlements"."period_start"),
	CONSTRAINT "settlements_hold_ck" CHECK (("settlements"."status" = 'on_hold') = ("settlements"."hold_reason" is not null)),
	CONSTRAINT "settlements_approved_ck" CHECK ("settlements"."status" <> 'approved' or "settlements"."approved_at" is not null),
	CONSTRAINT "settlements_pay_ck" CHECK (("settlements"."pay_basis" = 'percent_of_line_haul' and "settlements"."pay_percent_bp" is not null and "settlements"."pay_percent_bp" between 1 and 10000 and "settlements"."pay_rate_cents" is null)
      or ("settlements"."pay_basis" <> 'percent_of_line_haul' and "settlements"."pay_rate_cents" is not null and "settlements"."pay_rate_cents" > 0 and "settlements"."pay_percent_bp" is null))
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"claim_number" integer NOT NULL,
	"occurred_on" date NOT NULL,
	"driver_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"trailer_id" uuid,
	"load_id" uuid,
	"claim_type" "claim_type" NOT NULL,
	"claimant_kind" "claimant_kind" NOT NULL,
	"claimant_customer_id" uuid,
	"claimant_facility_id" uuid,
	"claimant_name" text,
	"reserved_cents" integer NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"status" "claim_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "claims_number_ck" CHECK ("claims"."claim_number" > 0),
	CONSTRAINT "claims_money_ck" CHECK ("claims"."reserved_cents" >= 0 and "claims"."paid_cents" >= 0),
	CONSTRAINT "claims_claimant_ck" CHECK (("claims"."claimant_kind" = 'customer' and "claims"."claimant_customer_id" is not null and "claims"."claimant_facility_id" is null and "claims"."claimant_name" is null)
        or ("claims"."claimant_kind" = 'facility' and "claims"."claimant_facility_id" is not null and "claims"."claimant_customer_id" is null and "claims"."claimant_name" is null)
        or ("claims"."claimant_kind" = 'third_party' and "claims"."claimant_name" is not null and "claims"."claimant_customer_id" is null and "claims"."claimant_facility_id" is null))
);
--> statement-breakpoint
CREATE TABLE "compliance_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"item_label" text NOT NULL,
	"due_on" date NOT NULL,
	"due_precision" date_precision NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_reminders_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "driver_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"document_type" "driver_document_type" NOT NULL,
	"expires_on" date,
	"expires_precision" date_precision DEFAULT 'month' NOT NULL,
	"status" "driver_document_status" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_documents_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "driver_documents_missing_ck" CHECK (("driver_documents"."status" = 'missing') = ("driver_documents"."expires_on" is null))
);
--> statement-breakpoint
CREATE TABLE "violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"driver_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"violation_type" text NOT NULL,
	"severity_points" smallint NOT NULL,
	"location" text NOT NULL,
	"status" "violation_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "violations_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "violations_points_ck" CHECK ("violations"."severity_points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"truck_id" uuid,
	"trailer_id" uuid,
	"item" text NOT NULL,
	"due_on" date,
	"due_odometer" integer,
	"shop_facility_id" uuid NOT NULL,
	"estimate_cents" integer NOT NULL,
	"status" "work_order_status" NOT NULL,
	"completed_on" date,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "work_orders_unit_ck" CHECK (("work_orders"."truck_id" is null) <> ("work_orders"."trailer_id" is null)),
	CONSTRAINT "work_orders_due_ck" CHECK (("work_orders"."due_on" is null) <> ("work_orders"."due_odometer" is null)),
	CONSTRAINT "work_orders_estimate_ck" CHECK ("work_orders"."estimate_cents" >= 0),
	CONSTRAINT "work_orders_done_ck" CHECK (("work_orders"."status" = 'done') = ("work_orders"."completed_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "planner_color_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"tone" "planner_tone" NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planner_color_codes_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "planner_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"color_code_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"start_time" time,
	"end_time" time,
	"place" text,
	"notes" text,
	"people" text[] DEFAULT '{}'::text[] NOT NULL,
	"load_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planner_events_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "planner_events_time_ck" CHECK (("planner_events"."start_time" is null and "planner_events"."end_time" is null)
        or ("planner_events"."start_time" is not null and "planner_events"."end_time" is not null and "planner_events"."end_time" > "planner_events"."start_time" and "planner_events"."end_date" is null)),
	CONSTRAINT "planner_events_end_date_ck" CHECK ("planner_events"."end_date" is null or "planner_events"."end_date" > "planner_events"."start_date")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_counters" ADD CONSTRAINT "organization_counters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_employee_fk" FOREIGN KEY ("organization_id","employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_employee_fk" FOREIGN KEY ("organization_id","employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_owner_fk" FOREIGN KEY ("organization_id","owner_employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_document_requests" ADD CONSTRAINT "onboarding_document_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_document_requests" ADD CONSTRAINT "onboarding_document_requests_case_fk" FOREIGN KEY ("organization_id","onboarding_case_id") REFERENCES "public"."onboarding_cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_mileage_entries" ADD CONSTRAINT "driver_mileage_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_mileage_entries" ADD CONSTRAINT "driver_mileage_entries_driver_fk" FOREIGN KEY ("organization_id","driver_id") REFERENCES "public"."drivers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_employee_fk" FOREIGN KEY ("organization_id","employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailers" ADD CONSTRAINT "trailers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailers" ADD CONSTRAINT "trailers_location_facility_fk" FOREIGN KEY ("organization_id","location_facility_id") REFERENCES "public"."facilities"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_assigned_driver_fk" FOREIGN KEY ("organization_id","assigned_driver_id") REFERENCES "public"."drivers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_load_fk" FOREIGN KEY ("organization_id","load_id") REFERENCES "public"."loads"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_driver_fk" FOREIGN KEY ("organization_id","driver_id") REFERENCES "public"."drivers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_truck_fk" FOREIGN KEY ("organization_id","truck_id") REFERENCES "public"."trucks"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_trailer_fk" FOREIGN KEY ("organization_id","trailer_id") REFERENCES "public"."trailers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_activity" ADD CONSTRAINT "load_activity_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_activity" ADD CONSTRAINT "load_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_activity" ADD CONSTRAINT "load_activity_load_fk" FOREIGN KEY ("organization_id","load_id") REFERENCES "public"."loads"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_stops" ADD CONSTRAINT "load_stops_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_stops" ADD CONSTRAINT "load_stops_load_fk" FOREIGN KEY ("organization_id","load_id") REFERENCES "public"."loads"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_stops" ADD CONSTRAINT "load_stops_facility_fk" FOREIGN KEY ("organization_id","facility_id") REFERENCES "public"."facilities"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_bill_to_customer_fk" FOREIGN KEY ("organization_id","bill_to_customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_carrier_fk" FOREIGN KEY ("organization_id","carrier_id") REFERENCES "public"."carriers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_fk" FOREIGN KEY ("organization_id","document_id") REFERENCES "public"."documents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_load_fk" FOREIGN KEY ("organization_id","load_id") REFERENCES "public"."loads"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factoring_companies" ADD CONSTRAINT "factoring_companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_batch_items" ADD CONSTRAINT "invoice_batch_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_batch_items" ADD CONSTRAINT "invoice_batch_items_batch_fk" FOREIGN KEY ("organization_id","batch_id") REFERENCES "public"."invoice_batches"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_batch_items" ADD CONSTRAINT "invoice_batch_items_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_batches" ADD CONSTRAINT "invoice_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_batches" ADD CONSTRAINT "invoice_batches_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_batches" ADD CONSTRAINT "invoice_batches_factoring_company_fk" FOREIGN KEY ("organization_id","factoring_company_id") REFERENCES "public"."factoring_companies"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_load_fk" FOREIGN KEY ("organization_id","load_id") REFERENCES "public"."loads"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_factoring_company_fk" FOREIGN KEY ("organization_id","factoring_company_id") REFERENCES "public"."factoring_companies"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendor_fk" FOREIGN KEY ("organization_id","vendor_id") REFERENCES "public"."vendors"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_fk" FOREIGN KEY ("organization_id","settlement_id") REFERENCES "public"."settlements"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_load_fk" FOREIGN KEY ("organization_id","load_id") REFERENCES "public"."loads"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_driver_fk" FOREIGN KEY ("organization_id","driver_id") REFERENCES "public"."drivers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_driver_fk" FOREIGN KEY ("organization_id","driver_id") REFERENCES "public"."drivers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_truck_fk" FOREIGN KEY ("organization_id","truck_id") REFERENCES "public"."trucks"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_trailer_fk" FOREIGN KEY ("organization_id","trailer_id") REFERENCES "public"."trailers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_load_fk" FOREIGN KEY ("organization_id","load_id") REFERENCES "public"."loads"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_customer_fk" FOREIGN KEY ("organization_id","claimant_customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_facility_fk" FOREIGN KEY ("organization_id","claimant_facility_id") REFERENCES "public"."facilities"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reminders" ADD CONSTRAINT "compliance_reminders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reminders" ADD CONSTRAINT "compliance_reminders_driver_fk" FOREIGN KEY ("organization_id","driver_id") REFERENCES "public"."drivers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_fk" FOREIGN KEY ("organization_id","driver_id") REFERENCES "public"."drivers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_driver_fk" FOREIGN KEY ("organization_id","driver_id") REFERENCES "public"."drivers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_truck_fk" FOREIGN KEY ("organization_id","truck_id") REFERENCES "public"."trucks"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_truck_fk" FOREIGN KEY ("organization_id","truck_id") REFERENCES "public"."trucks"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_trailer_fk" FOREIGN KEY ("organization_id","trailer_id") REFERENCES "public"."trailers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_shop_fk" FOREIGN KEY ("organization_id","shop_facility_id") REFERENCES "public"."facilities"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_color_codes" ADD CONSTRAINT "planner_color_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_events" ADD CONSTRAINT "planner_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_events" ADD CONSTRAINT "planner_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_events" ADD CONSTRAINT "planner_events_color_code_fk" FOREIGN KEY ("organization_id","color_code_id") REFERENCES "public"."planner_color_codes"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_events" ADD CONSTRAINT "planner_events_load_fk" FOREIGN KEY ("organization_id","load_id") REFERENCES "public"."loads"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_entity_idx" ON "audit_logs" USING btree ("organization_id","entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_occurred_idx" ON "audit_logs" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_unpublished_idx" ON "events" USING btree ("occurred_at") WHERE "events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "events_org_aggregate_idx" ON "events" USING btree ("organization_id","aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_uq" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_member_number_uq" ON "organization_members" USING btree ("member_number");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_company_number_uq" ON "organizations" USING btree ("company_number");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_uq" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_key_uq" ON "roles" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_org_user_role_uq" ON "user_roles" USING btree ("organization_id","user_id","role_id");--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contacts_primary_uq" ON "customer_contacts" USING btree ("organization_id","customer_id") WHERE "customer_contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "customer_contacts_org_customer_idx" ON "customer_contacts" USING btree ("organization_id","customer_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_name_uq" ON "customers" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "customers_org_position_idx" ON "customers" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_org_name_uq" ON "carriers" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_own_fleet_uq" ON "carriers" USING btree ("organization_id") WHERE "carriers"."is_own_fleet";--> statement-breakpoint
CREATE INDEX "carriers_org_position_idx" ON "carriers" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_org_name_uq" ON "facilities" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "facilities_org_kind_idx" ON "facilities" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "employee_contracts_org_position_idx" ON "employee_contracts" USING btree ("organization_id","position");--> statement-breakpoint
CREATE INDEX "employee_contracts_org_employee_idx" ON "employee_contracts" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_user_uq" ON "employees" USING btree ("organization_id","user_id") WHERE "employees"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "employees_org_name_idx" ON "employees" USING btree ("organization_id","last_name","first_name");--> statement-breakpoint
CREATE INDEX "onboarding_cases_org_position_idx" ON "onboarding_cases" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_document_requests_case_position_uq" ON "onboarding_document_requests" USING btree ("onboarding_case_id","position");--> statement-breakpoint
CREATE INDEX "onboarding_document_requests_org_case_idx" ON "onboarding_document_requests" USING btree ("organization_id","onboarding_case_id");--> statement-breakpoint
CREATE INDEX "driver_mileage_entries_org_recorded_idx" ON "driver_mileage_entries" USING btree ("organization_id","recorded_on");--> statement-breakpoint
CREATE INDEX "driver_mileage_entries_org_driver_idx" ON "driver_mileage_entries" USING btree ("organization_id","driver_id","recorded_on");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_org_employee_uq" ON "drivers" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "drivers_org_position_idx" ON "drivers" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "trailers_org_unit_uq" ON "trailers" USING btree ("organization_id","unit_number");--> statement-breakpoint
CREATE INDEX "trailers_org_position_idx" ON "trailers" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_org_unit_uq" ON "trucks" USING btree ("organization_id","unit_number");--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_org_assigned_driver_uq" ON "trucks" USING btree ("organization_id","assigned_driver_id") WHERE "trucks"."assigned_driver_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatches_org_load_active_uq" ON "dispatches" USING btree ("organization_id","load_id") WHERE "dispatches"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "dispatches_org_driver_idx" ON "dispatches" USING btree ("organization_id","driver_id");--> statement-breakpoint
CREATE INDEX "dispatches_org_truck_idx" ON "dispatches" USING btree ("organization_id","truck_id");--> statement-breakpoint
CREATE INDEX "dispatches_org_trailer_idx" ON "dispatches" USING btree ("organization_id","trailer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "load_activity_load_sequence_uq" ON "load_activity" USING btree ("load_id","sequence");--> statement-breakpoint
CREATE INDEX "load_activity_org_load_idx" ON "load_activity" USING btree ("organization_id","load_id");--> statement-breakpoint
CREATE UNIQUE INDEX "load_stops_load_sequence_uq" ON "load_stops" USING btree ("load_id","sequence");--> statement-breakpoint
CREATE INDEX "load_stops_org_load_idx" ON "load_stops" USING btree ("organization_id","load_id");--> statement-breakpoint
CREATE INDEX "load_stops_org_date_idx" ON "load_stops" USING btree ("organization_id","appointment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "loads_org_number_uq" ON "loads" USING btree ("organization_id","load_number");--> statement-breakpoint
CREATE INDEX "loads_org_board_idx" ON "loads" USING btree ("organization_id","created_at" DESC NULLS LAST) WHERE "loads"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "loads_org_status_idx" ON "loads" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "loads_org_customer_idx" ON "loads" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "loads_org_carrier_idx" ON "loads" USING btree ("organization_id","carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_version_uq" ON "document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_storage_key_uq" ON "document_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "document_versions_org_document_idx" ON "document_versions" USING btree ("organization_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_org_load_type_uq" ON "documents" USING btree ("organization_id","load_id","document_type");--> statement-breakpoint
CREATE INDEX "documents_org_type_status_idx" ON "documents" USING btree ("organization_id","document_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "factoring_companies_org_name_uq" ON "factoring_companies" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_batch_items_org_invoice_uq" ON "invoice_batch_items" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_batch_items_org_batch_idx" ON "invoice_batch_items" USING btree ("organization_id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_batches_org_number_uq" ON "invoice_batches" USING btree ("organization_id","batch_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_items_invoice_position_uq" ON "invoice_items" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoice_items_org_invoice_idx" ON "invoice_items" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_items_org_load_idx" ON "invoice_items" USING btree ("organization_id","load_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_uq" ON "invoices" USING btree ("organization_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_org_status_issued_idx" ON "invoices" USING btree ("organization_id","status","issued_on");--> statement-breakpoint
CREATE INDEX "invoices_org_customer_idx" ON "invoices" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "payments_org_invoice_idx" ON "payments" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_org_received_idx" ON "payments" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "bills_org_due_idx" ON "bills" USING btree ("organization_id","due_on");--> statement-breakpoint
CREATE INDEX "bills_org_status_idx" ON "bills" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_org_name_uq" ON "vendors" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_items_settlement_position_uq" ON "settlement_items" USING btree ("settlement_id","position");--> statement-breakpoint
CREATE INDEX "settlement_items_org_settlement_idx" ON "settlement_items" USING btree ("organization_id","settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_org_driver_period_uq" ON "settlements" USING btree ("organization_id","driver_id","period_start");--> statement-breakpoint
CREATE INDEX "settlements_org_period_idx" ON "settlements" USING btree ("organization_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_org_number_uq" ON "claims" USING btree ("organization_id","claim_number");--> statement-breakpoint
CREATE INDEX "compliance_reminders_org_position_idx" ON "compliance_reminders" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_documents_org_driver_type_uq" ON "driver_documents" USING btree ("organization_id","driver_id","document_type");--> statement-breakpoint
CREATE INDEX "driver_documents_org_position_idx" ON "driver_documents" USING btree ("organization_id","position");--> statement-breakpoint
CREATE INDEX "violations_org_occurred_idx" ON "violations" USING btree ("organization_id","occurred_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_orders_org_position_idx" ON "work_orders" USING btree ("organization_id","position");--> statement-breakpoint
CREATE INDEX "work_orders_org_status_idx" ON "work_orders" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "planner_color_codes_org_key_uq" ON "planner_color_codes" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "planner_color_codes_org_position_idx" ON "planner_color_codes" USING btree ("organization_id","position");--> statement-breakpoint
CREATE INDEX "planner_events_org_start_idx" ON "planner_events" USING btree ("organization_id","start_date");--> statement-breakpoint
CREATE INDEX "planner_events_org_color_code_idx" ON "planner_events" USING btree ("organization_id","color_code_id");