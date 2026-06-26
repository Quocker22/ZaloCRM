-- Add external_key for idempotent imports (gmaps:{place_id})
ALTER TABLE "contacts" ADD COLUMN "external_key" TEXT;

-- Partial unique: only enforce when external_key is set (legacy rows stay NULL, allowed)
CREATE UNIQUE INDEX "contacts_org_external_key_key"
  ON "contacts" ("org_id", "external_key")
  WHERE "external_key" IS NOT NULL;
