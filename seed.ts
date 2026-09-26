import { PrismaClient, RoleName } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/jwt";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.create({ data: { name: "LE SAGE" } });
  const location = await prisma.location.create({
    data: { organizationId: org.id, name: "Boutique R38 — Mfoundi Mall, Yaoundé" },
  });

  const dg = await prisma.user.create({
    data: {
      organizationId: org.id,
      locationId: location.id,
      fullName: "Herris Tchantchou",
      email: "herris@lesage.cm",
      passwordHash: await hashPassword("ChangeMe123!"),
      role: RoleName.DG,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      locationId: location.id,
      fullName: "Vendeur Pilote",
      email: "vendeur@lesage.cm",
      passwordHash: await hashPassword("ChangeMe123!"),
      role: RoleName.SELLER,
    },
  });

  const brand = await prisma.brand.create({ data: { name: "Apple" } });
  const product = await prisma.product.create({ data: { brandId: brand.id, name: "iPhone 13" } });
  const policy = await prisma.warrantyPolicy.create({
    data: { name: "Garantie standard 6 mois", durationDays: 180 },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      sku: "IPH13-128-MIDNIGHT-NEUF",
      capacity: "128GB",
      color: "Minuit",
      condition: "Neuf",
      currentPrice: 420000,
      warrantyPolicyId: policy.id,
    },
  });
  await prisma.inventoryUnit.create({
    data: {
      variantId: variant.id,
      locationId: location.id,
      imei: "352093081234561",
      costPrice: 340000,
      status: "AVAILABLE",
    },
  });

  // eslint-disable-next-line no-console
  console.log("Seed complete. DG login: herris@lesage.cm / ChangeMe123!  (CHANGE THIS PASSWORD IMMEDIATELY)");
}

main().finally(() => prisma.$disconnect());
