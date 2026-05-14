-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "buildingType" TEXT NOT NULL DEFAULT 'Double Storey 4BR + Study',
ADD COLUMN     "council" TEXT NOT NULL DEFAULT 'Sydney City Council',
ADD COLUMN     "lotSize" DECIMAL(10,2);
