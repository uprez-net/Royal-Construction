-- Scheduled work becomes rows instead of two columns on Lead.
--
-- Lead carried one followupDate and one meetingDate. Setting a new one
-- overwrote the last, and production has logged 54 "New Followup Stage Created"
-- against 41 leads, so that overwrite has been discarding history for as long
-- as the feature has existed.
--
-- The type and the presets are not invented. They are what people typed into
-- followupNotes on production because no field existed: "Organise a Meeting"
-- four times, "Send an Email/Text" twice, and nine separate notes expressing a
-- due date in prose ("Follow-up in 7 days", "in 1 day", "in 1 month",
-- "in 3 months", "in 6 months"), including the same interval written with two
-- different capitalisations.

CREATE TYPE "LeadTaskType"   AS ENUM ('CALL', 'EMAIL', 'MEETING', 'WAITING');
CREATE TYPE "LeadTaskStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE');

CREATE TABLE "LeadTask" (
    "id"             SERIAL PRIMARY KEY,
    "leadId"         INTEGER NOT NULL,
    "type"           "LeadTaskType" NOT NULL,
    "status"         "LeadTaskStatus" NOT NULL DEFAULT 'NEW',
    "dueDate"        TIMESTAMP(3),
    "dueTime"        TEXT,
    "notes"          TEXT,
    "assignedId"     TEXT,
    "completedAt"    TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeadTask_leadId_fkey" FOREIGN KEY ("leadId")
        REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadTask_assignedId_fkey" FOREIGN KEY ("assignedId")
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "LeadTask_leadId_idx"     ON "LeadTask"("leadId");
CREATE INDEX "LeadTask_assignedId_idx" ON "LeadTask"("assignedId");
CREATE INDEX "LeadTask_status_idx"     ON "LeadTask"("status");
-- Both reminder crons and the Follow-ups tab scan open work by date.
CREATE INDEX "LeadTask_dueDate_completedAt_idx" ON "LeadTask"("dueDate", "completedAt");

-- Carry the existing follow-ups across. Type CALL because that is what a
-- follow-up has always been in practice; where the note says otherwise the
-- classification below corrects it.
INSERT INTO "LeadTask" ("leadId", "type", "status", "dueDate", "dueTime", "notes", "assignedId", "completedAt", "reminderSentAt", "updatedAt")
SELECT
    l."id",
    CASE
        WHEN l."followupNotes" ILIKE '%meeting%' THEN 'MEETING'::"LeadTaskType"
        WHEN l."followupNotes" ILIKE '%email%' OR l."followupNotes" ILIKE '%text%' THEN 'EMAIL'::"LeadTaskType"
        WHEN l."followupNotes" ILIKE '%waiting%' THEN 'WAITING'::"LeadTaskType"
        ELSE 'CALL'::"LeadTaskType"
    END,
    CASE WHEN l."followupCompletedAt" IS NOT NULL THEN 'DONE'::"LeadTaskStatus"
         ELSE 'NEW'::"LeadTaskStatus" END,
    l."followupDate",
    l."followupTime",
    NULLIF(btrim(COALESCE(l."followupNotes", '')), ''),
    l."assignedId",
    l."followupCompletedAt",
    l."followupReminderSentAt",
    CURRENT_TIMESTAMP
FROM "Lead" l
WHERE l."followupDate" IS NOT NULL;

-- And the meetings. Only one production lead has ever had a meetingDate, and it
-- was written by the website booking route; nothing in the UI could set one.
INSERT INTO "LeadTask" ("leadId", "type", "status", "dueDate", "dueTime", "assignedId", "completedAt", "reminderSentAt", "updatedAt")
SELECT
    l."id",
    'MEETING'::"LeadTaskType",
    CASE WHEN l."meetingCompletedAt" IS NOT NULL THEN 'DONE'::"LeadTaskStatus"
         ELSE 'NEW'::"LeadTaskStatus" END,
    l."meetingDate",
    l."meetingTime",
    l."assignedId",
    l."meetingCompletedAt",
    l."meetingReminderSentAt",
    CURRENT_TIMESTAMP
FROM "Lead" l
WHERE l."meetingDate" IS NOT NULL;
