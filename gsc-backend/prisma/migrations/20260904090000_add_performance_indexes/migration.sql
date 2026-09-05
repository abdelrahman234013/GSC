-- CreateIndex
CREATE INDEX "products_springTypeId_idx" ON "products"("springTypeId");

-- CreateIndex
CREATE INDEX "products_createdAt_idx" ON "products"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "product_images_productId_idx" ON "product_images"("productId");

-- CreateIndex
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "quotes_customerId_createdAt_idx" ON "quotes"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "quotes_status_createdAt_idx" ON "quotes"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "quotes_springTypeId_idx" ON "quotes"("springTypeId");

-- CreateIndex
CREATE INDEX "quote_files_quoteId_idx" ON "quote_files"("quoteId");

