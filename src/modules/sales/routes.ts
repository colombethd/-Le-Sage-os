import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/rbac";
import { completeSale, SaleError } from "./completeSale";

export const salesRouter = Router();

const completeSaleSchema = z.object({
  customerId: z.string().uuid(),
  imei: z.string().min(14).max(17),
  discountPct: z.number().min(0).max(30).default(0),
  payment: z.object({
    method: z.enum(["CASH", "MOBILE_MONEY", "BANK"]),
    amount: z.number().positive(),
    reference: z.string().optional(),
  }),
  correlationId: z.string().uuid(),
});

// POST /api/v1/sales/complete — the Golden Sale command (§51: explicit
// business command, never a raw PATCH of inventory status from the frontend).
salesRouter.post(
  "/complete",
  requireAuth,
  requireRole("SELLER", "COMMERCIAL_MANAGER", "DG"),
  async (req, res) => {
    const parsed = completeSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", detail: parsed.error.flatten() });
    }
    if (!req.auth!.locationId) {
      return res.status(400).json({ error: "NO_LOCATION", detail: "User has no assigned location" });
    }
    try {
      const sale = await completeSale({
        locationId: req.auth!.locationId,
        sellerId: req.auth!.userId,
        ...parsed.data,
      });
      return res.status(201).json(sale);
    } catch (err) {
      if (err instanceof SaleError) {
        // UNIT_UNAVAILABLE is the expected, clean rejection for the "two
        // sellers / same IMEI" concurrency test (Annex A) — not a 500.
        const status = err.code === "UNIT_UNAVAILABLE" ? 409 : 422;
        return res.status(status).json({ error: err.code, message: err.message });
      }
      // eslint-disable-next-line no-console
      console.error("completeSale failed", err);
      return res.status(500).json({ error: "INTERNAL_ERROR" });
    }
  }
);
