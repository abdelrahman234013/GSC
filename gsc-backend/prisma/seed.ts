import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";

// Seeds the minimum a fresh deployment needs: one ADMIN account, the spring
// types, and a few products so the catalogue is not empty.
//
// Safe to re-run - every write is an upsert keyed on a unique column, so a
// second run updates rather than duplicating.
//
// The admin password comes from the environment, never from this file. A
// default password committed to a repository is a default password that ends
// up in production, so the script refuses to run without one.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SPRING_TYPES = [
  { slug: "compression", nameAr: "سوستة ضاغطة", nameEn: "Compression Spring" },
  { slug: "tension", nameAr: "سوستة شد", nameEn: "Tension Spring" },
  { slug: "torsional", nameAr: "سوستة لولبية", nameEn: "Torsional Spring" },
  { slug: "car-spring", nameAr: "سوستة سيارات", nameEn: "Car Spring" },
];

const PRODUCTS = [
  {
    slug: "compression-spring-cnc-standard",
    springTypeSlug: "compression",
    nameAr: "سوستة ضاغطة CNC قياسية",
    nameEn: "CNC Compression Spring - Standard",
    materialAr: "صلب كربوني",
    materialEn: "Carbon Steel",
    wireDiameterMm: "2.50",
    outerDiameterMm: "18.00",
    innerDiameterMm: "13.00",
    lengthMm: "50.00",
    price: "45.00",
    stock: 120,
  },
  {
    slug: "car-spring-front-coil-warranty",
    springTypeSlug: "car-spring",
    nameAr: "سوستة أمامية للسيارات",
    nameEn: "Front Coil Car Spring - Warrantied",
    materialAr: "صلب سوست مجلفن",
    materialEn: "Galvanized Spring Steel",
    wireDiameterMm: "12.00",
    outerDiameterMm: "120.00",
    innerDiameterMm: "96.00",
    lengthMm: "350.00",
    price: "850.00",
    stock: 30,
  },
  {
    slug: "torsional-spring-custom",
    springTypeSlug: "torsional",
    nameAr: "سوستة لولبية",
    nameEn: "Torsional Spring",
    materialAr: "صلب مقاوم للصدأ",
    materialEn: "Stainless Steel",
    wireDiameterMm: "3.00",
    outerDiameterMm: "22.00",
    lengthMm: "40.00",
    price: "60.00",
    stock: 75,
  },
];

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set. Example: " +
        "SEED_ADMIN_EMAIL=you@yourdomain.com " +
        "SEED_ADMIN_PASSWORD=a-strong-password npm run prisma:seed",
    );
  }
  if (adminPassword.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
  }

  // Hashed through the app's own helper so the stored format matches exactly
  // what login expects, including the SHA-256 pre-hash that removes bcrypt's
  // 72-byte ceiling.
  const passwordHash = await hashPassword(adminPassword);
  const admin = await prisma.admin.upsert({
    where: { email: adminEmail },
    update: { passwordHash, role: "ADMIN" },
    create: {
      email: adminEmail,
      name: process.env.SEED_ADMIN_NAME ?? "Administrator",
      role: "ADMIN",
      passwordHash,
    },
  });
  console.log(`Admin ready: ${admin.email} (role ${admin.role})`);

  const typeIdBySlug = new Map<string, string>();
  for (const t of SPRING_TYPES) {
    const row = await prisma.springType.upsert({
      where: { slug: t.slug },
      update: { nameAr: t.nameAr, nameEn: t.nameEn },
      create: t,
    });
    typeIdBySlug.set(t.slug, row.id);
  }
  console.log(`Spring types ready: ${SPRING_TYPES.length}`);

  for (const { springTypeSlug, ...p } of PRODUCTS) {
    const springTypeId = typeIdBySlug.get(springTypeSlug)!;
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: { ...p, springTypeId },
      create: { ...p, springTypeId },
    });
  }
  console.log(`Products ready: ${PRODUCTS.length}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err.message ?? err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
