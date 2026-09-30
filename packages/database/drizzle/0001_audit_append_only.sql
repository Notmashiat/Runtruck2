-- audit_logs is append-only (architecture §30, docs/03-database.md §9.2).
-- Any UPDATE or DELETE of an audit row raises, whichever role or code path issues it.
CREATE OR REPLACE FUNCTION "public"."audit_logs_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Record a new audit entry instead of changing an existing one.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only_trg"
  BEFORE UPDATE OR DELETE ON "public"."audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "public"."audit_logs_append_only"();
