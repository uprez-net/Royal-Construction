-- Migrate legacy accepted offers to the new AGREED lifecycle state (ADR 0002).
-- Separate migration so 'AGREED' (added in the previous migration) is already
-- committed and therefore usable here.
UPDATE "Offer" SET "offerStatus" = 'AGREED' WHERE "offerStatus" = 'ACCEPTED';
