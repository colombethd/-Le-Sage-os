import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/rbac";

export const inventoryRouter = Router();

// GET /api/v1/inventory/units?status=AVAILABLE
inventoryRouter.get("/units", requireAuth, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const units = await prisma.inventoryUnit.findMany({
    where: {
      locationId: req.auth!.locationId ?? undefined,
      ...(status ? { status: status as any } : {}),
    },
    include: { variant: { include: { product: { include: { brand: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  // Data classification (§59): cost price is CONFIDENTIAL — SELLER never sees it.
  const canSeeCost = ["STOCK_MANAGER", "FINANCE_MANAGER", "DG", "SYSTEM_ADMIN", "AUDITOR"].includes(
    req.auth!.role
  );

  return res.json(
    units.map((u) => ({
      imei: u.imei,
      status: u.status,
      brand: u.variant.product.brand.name,
      model: u.variant.product.name,
      capacity: u.variant.capacity,
      color: u.variant.color,
      condition: u.variant.condition,
      price: u.variant.currentPrice,
      ...(canSeeCost ? { cost: u.costPrice } : {}),
    }))
  );
});
