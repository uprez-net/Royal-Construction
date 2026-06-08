-- Rename legacy admin identity from Guri Singh to Gurpinder Uppal.
-- If the canonical email already exists, merge FKs into that user and delete the legacy row.
DO $$
DECLARE
  canonical_id TEXT;
  legacy_id TEXT;
BEGIN
  SELECT id
  INTO canonical_id
  FROM "User"
  WHERE email = 'gurpinder@royalconstructions.com.au'
  LIMIT 1;

  FOR legacy_id IN
    SELECT id
    FROM "User"
    WHERE (
      email = 'guri.singh@buildpro.com.au'
      OR name = 'Guri Singh'
      OR "clerkId" = 'seed-admin-guri'
    )
    AND (canonical_id IS NULL OR id <> canonical_id)
  LOOP
    IF canonical_id IS NOT NULL THEN
      UPDATE "Project"
      SET "siteManagerId" = canonical_id
      WHERE "siteManagerId" = legacy_id;

      UPDATE "File"
      SET "uploadedBy" = canonical_id
      WHERE "uploadedBy" = legacy_id;

      UPDATE "SiteUpdate"
      SET "authorId" = canonical_id
      WHERE "authorId" = legacy_id;

      UPDATE "ActivityLog"
      SET "authorId" = canonical_id
      WHERE "authorId" = legacy_id;

      UPDATE "Lead"
      SET "assignedId" = canonical_id
      WHERE "assignedId" = legacy_id;

      UPDATE "Customer"
      SET "userId" = canonical_id
      WHERE "userId" = legacy_id
        AND NOT EXISTS (
          SELECT 1 FROM "Customer" WHERE "userId" = canonical_id
        );

      DELETE FROM "User" WHERE id = legacy_id;
    ELSE
      UPDATE "User"
      SET
        name = 'Gurpinder Uppal',
        email = 'gurpinder@royalconstructions.com.au',
        "clerkId" = CASE
          WHEN "clerkId" = 'seed-admin-guri' THEN 'seed-admin-gurpinder'
          ELSE "clerkId"
        END,
        "updatedAt" = NOW()
      WHERE id = legacy_id;

      SELECT id
      INTO canonical_id
      FROM "User"
      WHERE id = legacy_id;
    END IF;
  END LOOP;

  IF canonical_id IS NOT NULL THEN
    UPDATE "User"
    SET name = 'Gurpinder Uppal', "updatedAt" = NOW()
    WHERE id = canonical_id
      AND name IS DISTINCT FROM 'Gurpinder Uppal';
  END IF;
END $$;
