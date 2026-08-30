/*
  Warnings:

  - You are about to drop the column `material` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `springType` on the `products` table. All the data in the column will be lost.
  - Added the required column `materialAr` to the `products` table without a default value. This is not possible if the table is not empty.
  - Added the required column `materialEn` to the `products` table without a default value. This is not possible if the table is not empty.
  - Added the required column `springTypeId` to the `products` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "products" DROP COLUMN "material",
DROP COLUMN "springType",
ADD COLUMN     "materialAr" TEXT NOT NULL,
ADD COLUMN     "materialEn" TEXT NOT NULL,
ADD COLUMN     "springTypeId" TEXT NOT NULL;

-- DropEnum
DROP TYPE "SpringType";

-- CreateTable
CREATE TABLE "spring_types" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spring_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spring_types_slug_key" ON "spring_types"("slug");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_springTypeId_fkey" FOREIGN KEY ("springTypeId") REFERENCES "spring_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
