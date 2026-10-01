-- Some clients give no phone number, and a customer is created for every owner
-- on a contract. The phone stays unique when present: Postgres lets any number
-- of rows hold NULL under a unique index.
-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "phone" DROP NOT NULL;

-- A blank phone was the only way to record "no phone" before, and the unique
-- index lets only one row hold "". Blank is NULL from here on.
UPDATE "Customer" SET "phone" = NULL WHERE btrim("phone") = '';
