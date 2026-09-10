-- Template content remains available as the version referenced by signed evidence.
-- Publishing a replacement may only change the active flag on a prior version.
CREATE FUNCTION reject_waiver_template_content_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.id,NEW.version,NEW.title,NEW.body,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.version,OLD.title,OLD.body,OLD.created_at) THEN
    RAISE EXCEPTION 'waiver template content is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER waiver_template_content_immutable
  BEFORE UPDATE ON waiver_templates
  FOR EACH ROW EXECUTE FUNCTION reject_waiver_template_content_change();
CREATE TRIGGER waiver_signatures_append_only
  BEFORE UPDATE OR DELETE ON waiver_signatures
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
