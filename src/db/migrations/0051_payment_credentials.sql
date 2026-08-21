-- A workspace's own Stripe keys (US-SET-08), one row per mode.
--
-- A row per mode rather than six columns on `payment_settings`, because the kit's
-- Test/Live toggle swaps between two independent pairs: an organizer keeps test
-- keys while they build the event and adds live keys when they open sales, and
-- neither should overwrite the other. Mode is data, not schema.
--
-- The secret key and the webhook signing secret are stored ENCRYPTED (bytea,
-- `iv | authTag | ciphertext`, AES-256-GCM under SECRET_ENCRYPTION_KEY) by the
-- same cipher that already protects TOTP seeds. They are write-only from the
-- API's point of view: nothing reads them back to a response, only to Stripe.
-- The publishable key is not encrypted — it is designed to be public.
--
-- `webhook_token` is the unguessable path segment of this workspace's own
-- webhook URL. It is not a credential and authorises nothing on its own: every
-- callback still has to carry a valid Stripe signature over the raw bytes. It
-- exists because a signature cannot be verified until you know WHICH secret to
-- verify it with, and one shared endpoint cannot tell one tenant from another.
CREATE TABLE IF NOT EXISTS "payment_credentials" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "organization_id" bigint NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "mode" "payment_mode" NOT NULL,
  "publishable_key" text,
  "secret_key_cipher" bytea,
  "webhook_secret_cipher" bytea,
  "saved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_payment_credentials_org_mode" UNIQUE ("organization_id", "mode")
);

-- One token per workspace, not per mode: Stripe's test and live dashboards are
-- separate, so the organizer registers the same URL twice and gets a different
-- signing secret each time. The URL itself need not differ.
ALTER TABLE "payment_settings"
  ADD COLUMN IF NOT EXISTS "webhook_token" text;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_settings_webhook_token"
  ON "payment_settings" ("webhook_token")
  WHERE "webhook_token" IS NOT NULL;

-- Tenant isolation, matching every other tenant table. Defence in depth: the app
-- connects as the schema owner and still scopes every query by organization_id,
-- so this is the second line, not the only one. It matters more here than most —
-- one workspace reading another's ciphertext is the worst read in the database.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_credentials']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (organization_id = current_setting(''app.current_org'', true)::bigint) '
      'WITH CHECK (organization_id = current_setting(''app.current_org'', true)::bigint)',
      t
    );
  END LOOP;
END $$;
