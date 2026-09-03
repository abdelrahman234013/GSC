import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const products = [
    {
      slug: "compression-spring-cnc-standard",
      nameAr: "سوستة ضاغطة CNC قياسية",
      nameEn: "CNC Compression Spring — Standard",
      descriptionAr:
        "سوستة ضاغطة مصنعة بدقة على ماكينات CNC، مناسبة للتطبيقات الصناعية العامة.",
      descriptionEn:
        "Precision CNC-machined compression spring, suited for general industrial applications.",
      springType: "COMPRESSION" as const,
      wireDiameterMm: 2.5,
      outerDiameterMm: 18,
      innerDiameterMm: 13,
      lengthMm: 50,
      material: "Carbon Steel",
      price: 45.0,
      stock: 120,
    },
    {
      slug: "car-spring-front-coil-warranty",
      nameAr: "سوستة أمامية للسيارات — بضمان",
      nameEn: "Front Coil Car Spring — Warrantied",
      descriptionAr:
        "سوستة أمامية للسيارات مصنعة محلياً بضمان موثق، بديل موثوق للمستورد.",
      descriptionEn:
        "Locally manufactured front car spring with documented warranty — a trusted alternative to imports.",
      springType: "CAR_SPRING" as const,
      wireDiameterMm: 12,
      outerDiameterMm: 120,
      innerDiameterMm: 96,
      lengthMm: 350,
      material: "Galvanized Spring Steel",
      price: 850.0,
      stock: 30,
    },
    {
      slug: "torsional-spring-custom",
      nameAr: "سوستة لولبية (فتيل)",
      nameEn: "Torsional Spring",
      descriptionAr:
        "سوستة لولبية مصنعة حسب مواصفات العميل باستخدام تشكيل الأسلاك.",
      descriptionEn:
        "Custom torsional spring made to customer spec via wire forming.",
      springType: "TORSIONAL" as const,
      wireDiameterMm: 3,
      outerDiameterMm: 22,
      lengthMm: 40,
      material: "Stainless Steel",
      price: 60.0,
      stock: 75,
    },
  ];

  for (const p of products) {
    const { springType, ...productData } = p;

    await prisma.product.upsert({
      where: { slug: p.slug },
      update: productData as any,
      create: productData as any,
    });
  }

  console.log(`Seeded ${products.length} products.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
