-- Membership hooks run before Better Auth inserts rows. Re-check under the same
-- organization lock used by billing, so a concurrent plan change cannot be missed.
CREATE OR REPLACE FUNCTION sparkfeed_block_pending_billing_seats() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM organization WHERE id = NEW.organization_id FOR UPDATE;
  IF TG_TABLE_NAME = 'invitation' THEN
    IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM team_billing_state WHERE workspace_id = NEW.organization_id AND pending_plan_change IS NOT NULL) THEN
    RAISE EXCEPTION 'A billing change is processing. Refresh billing before inviting new members.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER sparkfeed_member_pending_billing BEFORE INSERT ON member FOR EACH ROW EXECUTE FUNCTION sparkfeed_block_pending_billing_seats();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER sparkfeed_invitation_pending_billing BEFORE INSERT OR UPDATE OF status ON invitation FOR EACH ROW EXECUTE FUNCTION sparkfeed_block_pending_billing_seats();
