/*
  Warnings:

  - You are about to drop the column `springType` on the `quotes` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "quotes" DROP COLUMN "springType",
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "springTypeId" TEXT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_springTypeId_fkey" FOREIGN KEY ("springTypeId") REFERENCES "spring_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
