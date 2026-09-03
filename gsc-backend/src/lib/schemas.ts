import { z } from "zod";

// Request validation at the route boundary.
//
// Everything here exists because unvalidated input was reaching Prisma, which
// rejects bad arguments at the query-building stage — and the controllers' catch
// blocks turned that into a 500. A malformed query string is the caller's
// mistake, so it should come back as a 400 saying what was wrong, not as an
// opaque server error that also pollutes your error monitoring.

/**
 * One query-string value.
 *
 * Express gives `?search=a` as a string but `?search=a&search=b` as an ARRAY,
 * and that array used to flow into Prisma's `contains` and blow up. Last value
 * wins here, which is what most servers do — a duplicated parameter is a
 * malformed link, not something worth failing a customer's page load over.
 */
const singleQueryValue = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (Array.isArray(v) ? v[v.length - 1] : v));

/**
 * A finite number from a query string.
 *
 * `?minDiameter=abc` used to become NaN and reach Prisma, which rejected it as a
 * malformed argument and produced a 500. Now it's a 400 that says so.
 */
const numericQueryValue = singleQueryValue.transform((v, ctx) => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "must be a number" });
    return z.NEVER;
  }
  return n;
});

/**
 * page/limit. These were already junk-tolerant (`Number(x) || 1`), so they stay
 * lenient — nonsense falls back to the default rather than failing the request.
 */
const paginationShape = {
  page: singleQueryValue.transform((v) => Math.max(1, Number(v) || 1)),
  limit: singleQueryValue.transform((v) =>
    Math.min(100, Math.max(1, Number(v) || 20)),
  ),
};

export const ORDER_STATUSES = [
  "PROCESSING",
  "SHIPPING",
  "DELIVERED",
  "CANCELLED",
] as const;
export const QUOTE_STATUSES = ["PENDING", "QUOTED", "CLOSED"] as const;
export const GALLERY_CATEGORIES = [
  "FACTORY_INTERIOR",
  "MACHINES",
  "FINISHED_PRODUCT",
  "MANUFACTURING_PROCESS",
] as const;

export const listOrdersQuerySchema = z.object({
  status: singleQueryValue.pipe(z.enum(ORDER_STATUSES).optional()),
  ...paginationShape,
});

export const listQuotesQuerySchema = z.object({
  status: singleQueryValue.pipe(z.enum(QUOTE_STATUSES).optional()),
  ...paginationShape,
});

export const galleryQuerySchema = z.object({
  category: singleQueryValue.pipe(z.enum(GALLERY_CATEGORIES).optional()),
});

export const listProductsQuerySchema = z.object({
  springType: singleQueryValue,
  search: singleQueryValue,
  minDiameter: numericQueryValue,
  maxDiameter: numericQueryValue,
  ...paginationShape,
});

// --- product bodies -------------------------------------------------------
//
// createProduct previously only checked that price and springTypeId were
// PRESENT, while updateProduct checked that price and stock were non-negative
// numbers. So `price: -500` was refused on update but accepted on create, and a
// negative price flowed straight into checkout totals.
//
// The upper bounds are not arbitrary: the columns are Decimal(6,2) for the
// dimensions and Decimal(10,2) for price, so anything larger is a Postgres
// numeric-overflow error — another 500 from bad input.
const MAX_DIMENSION = 9999.99; // Decimal(6,2)
const MAX_PRICE = 99999999.99; // Decimal(10,2)

const dimension = z.number().finite().positive().max(MAX_DIMENSION);
const optionalDimension = dimension.optional().nullable();

const productFields = {
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  descriptionAr: z.string().max(5000).optional().nullable(),
  descriptionEn: z.string().max(5000).optional().nullable(),
  springTypeId: z.string().min(1),
  wireDiameterMm: dimension,
  outerDiameterMm: optionalDimension,
  innerDiameterMm: optionalDimension,
  lengthMm: optionalDimension,
  materialAr: z.string().trim().min(1).max(200),
  materialEn: z.string().trim().min(1).max(200),
  price: z.number().finite().nonnegative().max(MAX_PRICE),
  stock: z.number().int().nonnegative().max(1_000_000).optional(),
  metaTitleAr: z.string().max(300).optional().nullable(),
  metaTitleEn: z.string().max(300).optional().nullable(),
  metaDescriptionAr: z.string().max(500).optional().nullable(),
  metaDescriptionEn: z.string().max(500).optional().nullable(),
  slug: z.string().max(200).optional(),
};

export const createProductSchema = z.object(productFields);

// Every field optional on update, but each still validated when supplied — so
// the two paths can no longer disagree about what a valid product looks like.
export const updateProductSchema = z
  .object(productFields)
  .partial()
  .extend({
    stockDelta: z.number().int().optional(),
  })
  .refine((v) => !(v.stock !== undefined && v.stockDelta !== undefined), {
    message: "Provide only one of stock or stockDelta, not both",
  });

// --- free-text bodies ----------------------------------------------------
//
// Every Prisma `String` becomes an unbounded Postgres TEXT, and nothing capped
// input length, so the only ceiling was express.json()'s 100 KB body limit — one
// `notes` or `message` field could be ~100 KB, submitted repeatedly. These caps
// are generous for real use and simply stop a single field being used as storage.

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().min(3).max(254), // 254 = the RFC limit for an address
  phone: z.string().trim().max(30).optional().nullable(),
  message: z.string().trim().min(1).max(5000),
});

export const addressSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(30),
  city: z.string().trim().min(1).max(100),
  addressLine: z.string().trim().min(1).max(300),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const addressUpdateSchema = addressSchema.partial();

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
});

export const checkoutNotesSchema = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .nullable();

export const quoteSchema = z.object({
  springTypeId: z.string().max(100).optional().nullable(),
  wireDiameterMm: z.coerce.number().finite().positive().max(9999.99).optional().nullable(),
  outerDiameterMm: z.coerce.number().finite().positive().max(9999.99).optional().nullable(),
  innerDiameterMm: z.coerce.number().finite().positive().max(9999.99).optional().nullable(),
  lengthMm: z.coerce.number().finite().positive().max(9999.99).optional().nullable(),
  coilCount: z.coerce.number().int().positive().max(100000).optional().nullable(),
  material: z.string().trim().max(200).optional().nullable(),
  quantity: z.coerce.number().int().positive().max(1_000_000),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Turns a zod failure into a short, human-readable message.
 *
 * Names the offending field, because "Invalid input" gives whoever is wiring up
 * the frontend nothing to work with.
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.join(".");
      return field ? `${field}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * Validates `data`, or sends a 400 and returns null.
 *
 * Call as:  const q = parseOrFail(schema, req.query, res); if (!q) return;
 */
export function parseOrFail<T extends z.ZodType>(
  schema: T,
  data: unknown,
  res: any,
): z.infer<T> | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(400).json({ error: formatZodError(result.error) });
    return null;
  }
  return result.data;
}
