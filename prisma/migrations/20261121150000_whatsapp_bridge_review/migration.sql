-- Follow-ups from the WhatsApp bridge review. Additive only.

-- When a group started belonging to its project: messages sent before it are
-- not imported. Existing live groups count from now.
ALTER TABLE "ProjectWhatsAppGroup"
  ADD COLUMN "linkedAt" TIMESTAMP(3),
  ADD COLUMN "needsReconciliation" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ProjectWhatsAppGroup"
  SET "linkedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
  WHERE "status" = 'ACTIVE';

-- Each file records who issued its id, so it is fetched from the right place:
-- a project row that still holds a Meta id must not go to the bridge.
CREATE TYPE "WhatsAppMediaSource" AS ENUM ('META', 'BRIDGE');
ALTER TABLE "WhatsAppMedia"
  ADD COLUMN "source" "WhatsAppMediaSource" NOT NULL DEFAULT 'META';
