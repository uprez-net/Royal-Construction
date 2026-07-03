/*
  Warnings:

  - Added the required column `projectStage` to the `Milestone` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('Deposit', 'Slab', 'Frame', 'Lockup', 'Interior_Fit_Out', 'Final');

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "projectStage" "ProjectStage" NOT NULL;
