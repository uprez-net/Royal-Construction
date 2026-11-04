-- The attempt counter behind a project group's create outbox key: each create
-- request is its own intent, so a replayed workflow step never asks Meta for
-- a second group. Additive; existing rows start at 0.

ALTER TABLE "ProjectWhatsAppGroup" ADD COLUMN "createAttempt" INTEGER NOT NULL DEFAULT 0;
