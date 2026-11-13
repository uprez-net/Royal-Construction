-- Needs Attention is derived from a project's live records now (issue #452),
-- and nothing writes it to "Project"."status" any more. It used to be written
-- at creation when the readiness check warned, which replaced the project's
-- lifecycle stage: such a project could not show as drafting, in compliance or
-- under way.
--
-- Put each one back on the stage its records say it is at. The order mirrors
-- the ladder: work started on site wins, then a completed compliance file,
-- then a started one, then DRAFT. The enum value itself stays (the enum is
-- append-only), so an old link to ?status=NEEDS_ATTENTION still parses and
-- now lists the derived set.
--
-- The PCA / HBCF-number warnings these projects were flagged for are not lost
-- by moving them to a pre-start stage: the project header, the compliance
-- alert and the derived Needs Attention conditions all show them on every
-- project that is not completed (`readinessWarningsApply`).
UPDATE "Project" p
SET "status" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "Milestone" m
    WHERE m."projectId" = p."id" AND m."status" IN ('ACTIVE', 'DONE')
  ) THEN 'ACTIVE'::"ProjectStatus"
  WHEN EXISTS (
    SELECT 1 FROM "CertifierEngagement" e
    WHERE e."projectId" = p."id" AND e."status" = 'COMPLETED'
  ) THEN 'COMPLIANCE_COMPLETED'::"ProjectStatus"
  WHEN EXISTS (
    SELECT 1 FROM "CertifierEngagement" e WHERE e."projectId" = p."id"
  ) THEN 'COMPLIANCE_STARTED'::"ProjectStatus"
  ELSE 'DRAFT'::"ProjectStatus"
END
WHERE p."status" = 'NEEDS_ATTENTION';
