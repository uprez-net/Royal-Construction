-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'GUEST';

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "userId" DROP NOT NULL;
