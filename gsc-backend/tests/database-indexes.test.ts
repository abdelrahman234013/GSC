// Proves the 10 indexes added for query performance actually change what
// Postgres's planner does — not just that they exist.
//
// The trap with testing indexes is that Postgres correctly IGNORES an index on
// a small table: a sequential scan over a few hundred rows is genuinely cheaper
// than the random I/O of an index lookup. So this test seeds tens of thousands
// of rows first, matching the skew a real table develops over time (a handful of
// rows matching a specific filter, buried in a much larger table) — then proves
// causation, not correlation, by:
//
//   1. Seeding the data
//   2. DROP-ing each index and confirming the planner falls back to Seq Scan
//   3. Recreating the exact same index and confirming the plan changes
//
// Everything — seed data AND the index drop/recreate experiments — runs inside
// ONE transaction that is ROLLED BACK at the end. The live database is left
// byte-for-byte identical to how it started, whether the test passes, fails, or
// crashes outright: Postgres itself discards an open transaction if the
// connection drops.
//
// Requires a running local Postgres (docker compose up -d db).
// Run with:  npm run test:indexes

import "dotenv/config";
import { Client } from "pg";

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) { pass++; console.log(`  PASS  ${label}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`); }
}

// --- connection resolution -------------------------------------------------

function resolveDatabaseUrl(): string {
  let url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // "db" is only resolvable from inside the docker-compose network. Running
  // this script from the host (as `npm run test:indexes` does) needs the
  // published port instead — the same substitution used by hand throughout
  // this project's manual testing.
  url = url.replace("@db:5432", "@localhost:5433");
  return url;
}

// SAFETY: this test runs DROP INDEX and bulk INSERTs. It must never be
// pointable at a real database by an unrelated env misconfiguration — only
// obviously-local hosts are allowed.
function assertLocalDatabase(url: string) {
  const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname;
  const allowed = ["localhost", "127.0.0.1", "db"];
  if (!allowed.includes(host)) {
    throw new Error(
      `Refusing to run: DATABASE_URL host "${host}" is not a recognised local ` +
        `database. This test drops and recreates indexes and must only ever ` +
        `run against a local dev database.`,
    );
  }
}

// --- plan inspection --------------------------------------------------------

type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  Plans?: PlanNode[];
  "Total Cost"?: number;
};

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

async function explain(
  client: Client,
  sql: string,
): Promise<{ nodes: PlanNode[]; totalCost: number }> {
  const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
  const plan: PlanNode = rows[0]["QUERY PLAN"][0].Plan;
  return { nodes: flatten(plan), totalCost: plan["Total Cost"] ?? 0 };
}

function hasSeqScanOn(nodes: PlanNode[], table: string): boolean {
  return nodes.some(
    (n) => n["Node Type"] === "Seq Scan" && n["Relation Name"] === table,
  );
}

function usesIndex(nodes: PlanNode[], indexName: string): boolean {
  return nodes.some(
    (n) =>
      ["Index Scan", "Index Only Scan", "Bitmap Index Scan"].includes(n["Node Type"]) &&
      n["Index Name"] === indexName,
  );
}

// --- the 10 access patterns, one per index added this session --------------

interface IndexCase {
  index: string;
  table: string;
  describe: string;
  query: (p: Params) => string;
  // Most of these indexes are the ONLY thing standing between the planner and
  // a full table scan, so dropping them should surface a literal Seq Scan.
  // orders_customerId_createdAt_idx is the one exception: the unique
  // constraint added for checkout idempotency, orders_customerId_idempotencyKey_key,
  // happens to have customerId as its LEADING btree column, so Postgres can
  // partially reuse it — filter by customerId via that index, then sort the
  // matches separately for createdAt DESC. That is a real, correct plan
  // choice, and a smarter fallback than a seq scan would be. What the
  // dedicated composite index actually buys here is eliminating that separate
  // sort step, not eliminating a table scan — so the right claim for this one
  // case is "cheaper", not "no longer a seq scan".
  expectSeqScanWithoutIndex?: boolean;
}

interface Params {
  targetCustomerId: string;
  targetOrderId: string;
  targetQuoteId: string;
  targetSpringTypeId: string;
  targetProductId: string;
}

const CASES: IndexCase[] = [
  {
    index: "orders_customerId_createdAt_idx",
    table: "orders",
    describe: "GET /customers/me/orders — WHERE customerId ORDER BY createdAt DESC LIMIT",
    query: (p) =>
      `SELECT id FROM orders WHERE "customerId" = '${p.targetCustomerId}' ORDER BY "createdAt" DESC LIMIT 20`,
    expectSeqScanWithoutIndex: false,
  },
  {
    index: "orders_status_createdAt_idx",
    table: "orders",
    describe: "GET /admin/orders?status=X — WHERE status ORDER BY createdAt DESC LIMIT",
    query: () =>
      `SELECT id FROM orders WHERE status = 'SHIPPING' ORDER BY "createdAt" DESC LIMIT 20`,
  },
  {
    index: "order_items_orderId_idx",
    table: "order_items",
    describe: "loading an order's line items via include: { items: true }",
    query: (p) => `SELECT id FROM order_items WHERE "orderId" = '${p.targetOrderId}'`,
  },
  {
    index: "quotes_customerId_createdAt_idx",
    table: "quotes",
    describe: "GET /customers/me/quotes — WHERE customerId ORDER BY createdAt DESC LIMIT",
    query: (p) =>
      `SELECT id FROM quotes WHERE "customerId" = '${p.targetCustomerId}' ORDER BY "createdAt" DESC LIMIT 20`,
  },
  {
    index: "quotes_status_createdAt_idx",
    table: "quotes",
    describe: "GET /admin/quotes?status=X — WHERE status ORDER BY createdAt DESC LIMIT",
    query: () =>
      `SELECT id FROM quotes WHERE status = 'QUOTED' ORDER BY "createdAt" DESC LIMIT 20`,
  },
  {
    index: "quotes_springTypeId_idx",
    table: "quotes",
    describe: "quotes for one spring type",
    query: (p) => `SELECT id FROM quotes WHERE "springTypeId" = '${p.targetSpringTypeId}'`,
  },
  {
    index: "quote_files_quoteId_idx",
    table: "quote_files",
    describe: "loading a quote's attachments via include: { files: true }",
    query: (p) => `SELECT id FROM quote_files WHERE "quoteId" = '${p.targetQuoteId}'`,
  },
  {
    index: "products_springTypeId_idx",
    table: "products",
    describe: "GET /products?springType=X",
    query: (p) => `SELECT id FROM products WHERE "springTypeId" = '${p.targetSpringTypeId}'`,
  },
  {
    index: "products_createdAt_idx",
    table: "products",
    describe: "GET /products — the unfiltered catalog browse, ORDER BY createdAt DESC LIMIT",
    query: () => `SELECT id FROM products ORDER BY "createdAt" DESC LIMIT 20`,
  },
  {
    index: "product_images_productId_idx",
    table: "product_images",
    describe: "loading one product's images",
    query: (p) => `SELECT id FROM product_images WHERE "productId" = '${p.targetProductId}'`,
  },
];

async function run() {
  const url = resolveDatabaseUrl();
  assertLocalDatabase(url);

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query("BEGIN");

    console.log("\n=== Seeding representative volume (rolled back at the end) ===");

    // 300 dummy customers; index [0] is the "target" used for selective
    // customerId filters (~1 in 300 rows, comfortably past the point where
    // Postgres prefers an index over scanning the whole table).
    await client.query(`
      INSERT INTO customers (id, email, "createdAt", "updatedAt")
      SELECT gen_random_uuid(), 'seed-idx-customer-' || i || '@test.local', now(), now()
      FROM generate_series(1, 300) AS i
    `);
    const { rows: customerRows } = await client.query(
      `SELECT id FROM customers WHERE email LIKE 'seed-idx-customer-%' ORDER BY email`,
    );
    const customerIds: string[] = customerRows.map((r) => r.id);
    const targetCustomerId = customerIds[0];
    check("seeded 300 customers", customerIds.length === 300, `${customerIds.length}`);

    // 5 spring types: 4 "filler" carrying the bulk of rows, 1 "target" that
    // stays small — the skew a real table develops between a common category
    // and a niche one.
    await client.query(`
      INSERT INTO spring_types (id, slug, "nameAr", "nameEn", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), 'seed-idx-type-' || i, 'نوع ' || i, 'Type ' || i, now(), now()
      FROM generate_series(0, 4) AS i
    `);
    const { rows: typeRows } = await client.query(
      `SELECT id, slug FROM spring_types WHERE slug LIKE 'seed-idx-type-%' ORDER BY slug`,
    );
    const fillerTypeIds: string[] = typeRows.filter((r) => r.slug !== "seed-idx-type-4").map((r) => r.id);
    const targetSpringTypeId: string = typeRows.find((r) => r.slug === "seed-idx-type-4")!.id;
    check("seeded 5 spring types (4 filler + 1 target)", typeRows.length === 5);

    // ~4,000 filler products across the 4 filler types, plus 30 under the
    // target type — about 0.75% selectivity for a springTypeId filter.
    for (const typeId of fillerTypeIds) {
      await client.query(`
        INSERT INTO products (
          id, slug, "nameAr", "nameEn", "springTypeId", "wireDiameterMm",
          "materialAr", "materialEn", price, stock, "createdAt", "updatedAt"
        )
        SELECT gen_random_uuid(), 'seed-idx-product-' || gen_random_uuid(), 'منتج', 'Product',
               '${typeId}', 2.5, 'صلب', 'Steel', 10.00, 0,
               now() - (random() * interval '365 days'), now()
        FROM generate_series(1, 1000)
      `);
    }
    await client.query(`
      INSERT INTO products (
        id, slug, "nameAr", "nameEn", "springTypeId", "wireDiameterMm",
        "materialAr", "materialEn", price, stock, "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid(), 'seed-idx-product-' || gen_random_uuid(), 'منتج هدف', 'Target Product',
             '${targetSpringTypeId}', 2.5, 'صلب', 'Steel', 10.00, 0,
             now() - (random() * interval '365 days'), now()
      FROM generate_series(1, 30)
    `);
    const { rows: productCountRows } = await client.query(
      `SELECT count(*)::int AS n FROM products WHERE slug LIKE 'seed-idx-product-%'`,
    );
    const { rows: targetProductRows } = await client.query(
      `SELECT id FROM products WHERE "springTypeId" = '${targetSpringTypeId}' LIMIT 1`,
    );
    const targetProductId: string = targetProductRows[0].id;
    check(
      "seeded ~4,030 products (30 under the target spring type)",
      productCountRows[0].n >= 4000,
      `${productCountRows[0].n} rows`,
    );

    // ~8,000 orders. Status split evenly across the 4 enum values (the real
    // query has ORDER BY + LIMIT, which favours an index regardless of
    // selectivity — this proves that path). customerId is skewed so the
    // target customer holds a small slice of a much larger table.
    const statuses = ["PROCESSING", "SHIPPING", "DELIVERED", "CANCELLED"];
    for (const status of statuses) {
      await client.query(`
        INSERT INTO orders (
          id, "orderNumber", status, "customerId", "contactName", "contactPhone",
          city, "addressLine", "totalAmount", "createdAt", "updatedAt"
        )
        SELECT
          gen_random_uuid(),
          'SEED-IDX-' || '${status}' || '-' || i,
          '${status}'::"OrderStatus",
          CASE WHEN i % 65 = 0 THEN '${targetCustomerId}'
               ELSE (ARRAY[${customerIds.map((id) => `'${id}'`).join(",")}])[1 + (i % 299)]
          END,
          'Seed Customer', '01000000000', 'Cairo', '1 Test St', 50.00,
          now() - (random() * interval '365 days'), now()
        FROM generate_series(1, 2000) AS i
      `);
    }
    const { rows: orderCountRows } = await client.query(
      `SELECT count(*)::int AS n FROM orders WHERE "orderNumber" LIKE 'SEED-IDX-%'`,
    );
    const { rows: targetOrderRows } = await client.query(
      `SELECT id FROM orders WHERE "customerId" = '${targetCustomerId}' LIMIT 1`,
    );
    const targetOrderId: string = targetOrderRows[0].id;
    check(
      "seeded ~8,000 orders across 4 statuses, skewed by customer",
      orderCountRows[0].n >= 7900,
      `${orderCountRows[0].n} rows`,
    );

    // 2 line items per order — the child table order_items always dwarfs its
    // parent, exactly the shape that makes an unindexed FK expensive.
    await client.query(`
      INSERT INTO order_items (id, "orderId", "productId", "nameSnapshotAr", "nameSnapshotEn", "priceSnapshot", quantity)
      SELECT gen_random_uuid(), o.id, '${targetProductId}', 'منتج', 'Product', 10.00, 1
      FROM orders o, generate_series(1, 2)
      WHERE o."orderNumber" LIKE 'SEED-IDX-%'
    `);
    const { rows: itemCountRows } = await client.query(
      `SELECT count(*)::int AS n FROM order_items WHERE "productId" = '${targetProductId}'`,
    );
    check("seeded ~16,000 order_items", itemCountRows[0].n >= 15000, `${itemCountRows[0].n} rows`);

    // ~6,000 quotes, same skew pattern as orders.
    const quoteStatuses = ["PENDING", "QUOTED", "CLOSED"];
    for (const status of quoteStatuses) {
      await client.query(`
        INSERT INTO quotes (
          id, "referenceNumber", status, "customerId", "springTypeId",
          quantity, "contactName", "contactPhone", "createdAt", "updatedAt"
        )
        SELECT
          gen_random_uuid(),
          'SEED-IDX-Q-' || '${status}' || '-' || i,
          '${status}'::"QuoteStatus",
          CASE WHEN i % 65 = 0 THEN '${targetCustomerId}'
               ELSE (ARRAY[${customerIds.map((id) => `'${id}'`).join(",")}])[1 + (i % 299)]
          END,
          CASE WHEN i % 65 = 0 THEN '${targetSpringTypeId}'
               ELSE (ARRAY[${fillerTypeIds.map((id) => `'${id}'`).join(",")}])[1 + (i % 4)]
          END,
          1, 'Seed Customer', '01000000000',
          now() - (random() * interval '365 days'), now()
        FROM generate_series(1, 2000) AS i
      `);
    }
    const { rows: quoteCountRows } = await client.query(
      `SELECT count(*)::int AS n FROM quotes WHERE "referenceNumber" LIKE 'SEED-IDX-Q-%'`,
    );
    const { rows: targetQuoteRows } = await client.query(
      `SELECT id FROM quotes WHERE "customerId" = '${targetCustomerId}' LIMIT 1`,
    );
    const targetQuoteId: string = targetQuoteRows[0].id;
    check("seeded ~6,000 quotes", quoteCountRows[0].n >= 5900, `${quoteCountRows[0].n} rows`);

    // 2 attachments per quote.
    await client.query(`
      INSERT INTO quote_files (id, "quoteId", url, "originalName")
      SELECT gen_random_uuid(), q.id, 'https://example.com/f.pdf', 'f.pdf'
      FROM quotes q, generate_series(1, 2)
      WHERE q."referenceNumber" LIKE 'SEED-IDX-Q-%'
    `);
    const { rows: fileCountRows } = await client.query(
      `SELECT count(*)::int AS n FROM quote_files WHERE "quoteId" = '${targetQuoteId}'`,
    );

    // Images: the target product gets exactly 2, out of a much larger table —
    // as selective as a filter gets.
    await client.query(`
      INSERT INTO product_images (id, "productId", url, position)
      SELECT gen_random_uuid(), p.id, 'https://example.com/i.png', gs
      FROM products p, generate_series(1, 4) gs
      WHERE p.slug LIKE 'seed-idx-product-%' AND p.id != '${targetProductId}'
    `);
    await client.query(`
      INSERT INTO product_images (id, "productId", url, position)
      SELECT gen_random_uuid(), '${targetProductId}', 'https://example.com/i.png', gs
      FROM generate_series(1, 2) gs
    `);
    const { rows: imageCountRows } = await client.query(
      `SELECT count(*)::int AS n FROM product_images`,
    );
    check(
      "seeded product_images with the target product holding just 2 of many",
      imageCountRows[0].n >= 15000,
      `${imageCountRows[0].n} total rows`,
    );

    // The planner needs fresh statistics to make a realistic choice — without
    // this, row-count estimates default to whatever was true before the bulk
    // insert (often near-empty), and the whole demonstration would be invalid.
    for (const t of ["customers", "spring_types", "products", "orders", "order_items", "quotes", "quote_files", "product_images"]) {
      await client.query(`ANALYZE ${t}`);
    }

    const params: Params = {
      targetCustomerId,
      targetOrderId,
      targetQuoteId,
      targetSpringTypeId,
      targetProductId,
    };

    console.log("\n=== Capturing the real index definitions, so DROP/CREATE round-trips exactly ===");
    const { rows: indexDefs } = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ANY($1)
    `, [CASES.map((c) => c.index)]);
    const ddlByName = new Map<string, string>(indexDefs.map((r) => [r.indexname, r.indexdef]));
    check("found all 10 index definitions to restore later", ddlByName.size === CASES.length, `${ddlByName.size}/${CASES.length}`);

    console.log("\n=== Proving each index changes the planner's decision ===");
    for (const c of CASES) {
      const ddl = ddlByName.get(c.index);
      if (!ddl) {
        check(`${c.index}: definition captured`, false);
        continue;
      }

      console.log(`\n  --- ${c.index} (${c.describe}) ---`);
      const sql = c.query(params);

      const expectSeqScan = c.expectSeqScanWithoutIndex !== false;

      await client.query(`DROP INDEX "${c.index}"`);
      const without = await explain(client, sql);
      if (expectSeqScan) {
        check(
          `WITHOUT the index, Postgres falls back to Seq Scan on ${c.table}`,
          hasSeqScanOn(without.nodes, c.table),
          `cost=${without.totalCost.toFixed(1)}`,
        );
      } else {
        check(
          `WITHOUT the index, no Seq Scan — a leading-column match on another ` +
            `index (orders_customerId_idempotencyKey_key) covers the filter, ` +
            `just without the free sort`,
          !hasSeqScanOn(without.nodes, c.table),
          `cost=${without.totalCost.toFixed(1)}`,
        );
      }

      await client.query(ddl); // recreate byte-for-byte identical to the original
      const withIndex = await explain(client, sql);
      if (expectSeqScan) {
        check(
          `WITH the index, Seq Scan on ${c.table} is gone`,
          !hasSeqScanOn(withIndex.nodes, c.table),
        );
      } else {
        check(
          `WITH the index, it is measurably cheaper than the fallback plan`,
          withIndex.totalCost < without.totalCost,
          `${withIndex.totalCost.toFixed(1)} < ${without.totalCost.toFixed(1)}`,
        );
      }
      check(
        `  ...and the planner actually chose ${c.index}`,
        usesIndex(withIndex.nodes, c.index),
        `cost=${withIndex.totalCost.toFixed(1)}`,
      );

      const reduction = without.totalCost > 0
        ? (100 * (1 - withIndex.totalCost / without.totalCost)).toFixed(1)
        : "n/a";
      console.log(`      estimated cost: ${without.totalCost.toFixed(1)} -> ${withIndex.totalCost.toFixed(1)} (${reduction}% lower)`);
    }
  } finally {
    // Whatever happened above — seed data AND every DROP/CREATE INDEX — is
    // undone here. The live database ends exactly as it started.
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${"=".repeat(60)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(60)}`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
