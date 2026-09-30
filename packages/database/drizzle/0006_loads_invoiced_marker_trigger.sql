-- loads.invoiced_at mirrors invoice_items (docs/03-database.md §6.0.4, docs/01 C86):
-- set when a load gets its first invoice line, cleared when its last line goes (a line
-- removed, moved to another load, or deleted with its invoice). Kept in the database so
-- every write path — API, seed, future invoicing, manual repair — keeps it exact.
CREATE OR REPLACE FUNCTION "public"."loads_sync_invoiced_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.load_id IS NOT NULL THEN
    UPDATE "public"."loads" SET "invoiced_at" = now()
    WHERE "organization_id" = NEW.organization_id AND "id" = NEW.load_id AND "invoiced_at" IS NULL;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.load_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.load_id IS DISTINCT FROM NEW.load_id OR OLD.organization_id <> NEW.organization_id) THEN
    UPDATE "public"."loads" l SET "invoiced_at" = NULL
    WHERE l."organization_id" = OLD.organization_id AND l."id" = OLD.load_id
      AND NOT EXISTS (SELECT 1 FROM "public"."invoice_items" ii
                      WHERE ii."organization_id" = OLD.organization_id AND ii."load_id" = OLD.load_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "invoice_items_sync_loads_invoiced_at_trg"
  AFTER INSERT OR DELETE OR UPDATE OF "load_id", "organization_id" ON "public"."invoice_items"
  FOR EACH ROW EXECUTE FUNCTION "public"."loads_sync_invoiced_at"();
--> statement-breakpoint
-- Backfill: loads invoiced before this migration take their first line's creation time.
UPDATE "public"."loads" l SET "invoiced_at" = x.first_at
FROM (SELECT "organization_id", "load_id", min("created_at") AS first_at
      FROM "public"."invoice_items" WHERE "load_id" IS NOT NULL GROUP BY 1, 2) x
WHERE l."organization_id" = x."organization_id" AND l."id" = x."load_id" AND l."invoiced_at" IS NULL;
