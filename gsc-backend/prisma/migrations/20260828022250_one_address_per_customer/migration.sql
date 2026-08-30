/*
  Warnings:

  - You are about to drop the column `isDefault` on the `addresses` table. All the data in the column will be lost.
  - You are about to drop the column `label` on the `addresses` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[customerId]` on the table `addresses` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "addresses" DROP COLUMN "isDefault",
DROP COLUMN "label";

-- CreateIndex
CREATE UNIQUE INDEX "addresses_customerId_key" ON "addresses"("customerId");
