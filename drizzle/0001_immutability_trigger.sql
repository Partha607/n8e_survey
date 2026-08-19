-- Published instrument versions are immutable (CLAUDE.md rule 3).
-- Never remove this trigger.
CREATE OR REPLACE FUNCTION reject_instrument_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'instrument_versions rows are immutable (published versions cannot be modified or deleted)'
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER instrument_versions_immutable
BEFORE UPDATE OR DELETE ON "instrument_versions"
FOR EACH ROW EXECUTE FUNCTION reject_instrument_version_mutation();
--> statement-breakpoint
-- response_items uniqueness: option_key is NULL for non-choice answers, so
-- uniqueness uses COALESCE(option_key,'') (BUILD-PLAN §3.1).
CREATE UNIQUE INDEX "response_items_response_question_option_uq"
  ON "response_items" ("response_id", "question_key", COALESCE("option_key", ''));
