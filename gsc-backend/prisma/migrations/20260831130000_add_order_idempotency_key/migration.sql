-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_customerId_idempotencyKey_key" ON "orders"("customerId", "idempotencyKey");

