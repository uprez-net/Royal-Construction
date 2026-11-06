-- Upload hints on every file: tags to filter by, and the screen it came from.
ALTER TABLE "File" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "File" ADD COLUMN "origin" TEXT;
