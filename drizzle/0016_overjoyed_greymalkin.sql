CREATE TABLE "platform_request_nonces" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_credit_schedules" (
	"workspace_type" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"anchor_at" text NOT NULL,
	CONSTRAINT "workspace_credit_schedules_workspace_type_workspace_id_user_id_pk" PRIMARY KEY("workspace_type","workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_overrides" (
	"workspace_type" text NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_key" text,
	"access_restriction" text,
	"seat_limit" integer,
	"monthly_ai_credits" integer,
	"source_unit_limit" integer,
	"api_access" boolean,
	"mcp_access" boolean,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"expires_at" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "workspace_overrides_workspace_type_workspace_id_pk" PRIMARY KEY("workspace_type","workspace_id")
);
--> statement-breakpoint
CREATE INDEX "platform_request_nonces_expiry_idx" ON "platform_request_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS member_organization_user_uidx ON member (organization_id, user_id);
--> statement-breakpoint
-- Serialize all membership/invitation writers, including Better Auth's hosted APIs.
CREATE FUNCTION sparkfeed_lock_workspace_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM organization WHERE id=COALESCE(NEW.organization_id,OLD.organization_id) FOR UPDATE;
  RETURN COALESCE(NEW,OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sparkfeed_member_lock BEFORE INSERT OR UPDATE OR DELETE ON member FOR EACH ROW EXECUTE FUNCTION sparkfeed_lock_workspace_membership();
--> statement-breakpoint
CREATE TRIGGER sparkfeed_invitation_lock BEFORE INSERT OR UPDATE OR DELETE ON invitation FOR EACH ROW EXECUTE FUNCTION sparkfeed_lock_workspace_membership();
--> statement-breakpoint
CREATE FUNCTION sparkfeed_check_workspace_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id text; capacity integer; occupied integer;
BEGIN
  org_id := NEW.organization_id;
  SELECT COALESCE(v.seat_limit,CASE WHEN v.plan_key IS NULL OR v.plan_key=s.plan_key THEN s.override_seat_limit END,CASE WHEN COALESCE(v.plan_key,s.plan_key)='pro' THEN s.paid_seat_quantity END)
    INTO capacity FROM workspace_subscriptions s
    LEFT JOIN workspace_overrides v ON v.workspace_type=s.workspace_type AND v.workspace_id=s.workspace_id
      AND (v.expires_at IS NULL OR v.expires_at::timestamptz>now())
    WHERE s.workspace_type='organization' AND s.workspace_id=org_id;
  IF capacity IS NULL THEN RETURN NEW; END IF;
  SELECT (SELECT count(*) FROM member WHERE organization_id=org_id) +
    (SELECT count(DISTINCT lower(i.email)) FROM invitation i WHERE i.organization_id=org_id
      AND i.status='pending' AND i.expires_at>now() AND NOT EXISTS (
        SELECT 1 FROM member m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=org_id AND lower(u.email)=lower(i.email))) INTO occupied;
  IF occupied>capacity THEN RAISE EXCEPTION 'Workspace has no available seats' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sparkfeed_member_capacity AFTER INSERT ON member FOR EACH ROW EXECUTE FUNCTION sparkfeed_check_workspace_capacity();
--> statement-breakpoint
CREATE TRIGGER sparkfeed_invitation_capacity AFTER INSERT OR UPDATE ON invitation FOR EACH ROW EXECUTE FUNCTION sparkfeed_check_workspace_capacity();
--> statement-breakpoint
CREATE FUNCTION sparkfeed_check_workspace_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id text;
BEGIN
  org_id := COALESCE(NEW.organization_id,OLD.organization_id);
  IF EXISTS(SELECT 1 FROM organization WHERE id=org_id) AND
    (SELECT count(*) FROM member WHERE organization_id=org_id AND role='owner')<>1 THEN
    RAISE EXCEPTION 'Workspace must have exactly one owner' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sparkfeed_workspace_owner AFTER INSERT OR UPDATE OR DELETE ON member DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sparkfeed_check_workspace_owner();
--> statement-breakpoint
-- Preserve suspensions made through the legacy admin before this split.
INSERT INTO workspace_overrides(workspace_type,workspace_id,access_restriction,reason,actor_id,revision,created_at,updated_at)
SELECT workspace_type,workspace_id,'suspended','Preserved legacy operator suspension','migration:dashboard-split',1,updated_at,updated_at
FROM workspace_subscriptions WHERE access_state='suspended'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE workspace_subscriptions SET access_state=CASE
  WHEN workspace_type='organization' AND subscription_status='canceled' THEN 'read_only'
  WHEN subscription_status='past_due' AND failed_payment_grace_deadline IS NOT NULL AND failed_payment_grace_deadline::timestamptz<=now() THEN 'read_only'
  ELSE 'active' END
WHERE access_state='suspended';
