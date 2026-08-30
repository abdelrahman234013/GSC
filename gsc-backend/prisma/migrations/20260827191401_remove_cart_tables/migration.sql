/*
  Warnings:

  - You are about to drop the column `nameSnapshot` on the `order_items` table. All the data in the column will be lost.
  - You are about to drop the `cart_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `carts` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `nameSnapshotAr` to the `order_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nameSnapshotEn` to the `order_items` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_cartId_fkey";

-- DropForeignKey
ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "carts" DROP CONSTRAINT "carts_customerId_fkey";

-- AlterTable
ALTER TABLE "order_items" DROP COLUMN "nameSnapshot",
ADD COLUMN     "nameSnapshotAr" TEXT NOT NULL,
ADD COLUMN     "nameSnapshotEn" TEXT NOT NULL;

-- DropTable
DROP TABLE "cart_items";

-- DropTable
DROP TABLE "carts";
