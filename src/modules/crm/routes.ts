import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/rbac";

export const crmRouter = Router();

function normalizePhone(raw: string): string {
  // Minimal normalizer for Cameroon numbers: strip spaces/dashes, force +237
  // prefix. Replace with a proper libphonenumber-based normalizer before
  // production migration (§12: "normalisation téléphone").
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+237")) return digits;
  if (digits.startsWith("237")) return `+${digits}`;
  if (digits.length === 9) return `+237${digits}`;
  return digits;
}

const createCustomerSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(6),
  whatsapp: z.string().optional(),
  notes: z.string().optional(),
});

// POST /api/v1/customers — duplicate detection by normalized phone (§12, §68).
crmRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_ERROR", detail: parsed.error.flatten() });
  }
  const phoneNormalized = normalizePhone(parsed.data.phone);

  const existing = await prisma.customer.findUnique({ where: { phoneNormalized } });
  if (existing) {
    return res.status(200).json({ match: "AUTO_MATCH", customer: existing });
  }

  if (!req.auth!.locationId) {
    return res.status(400).json({ error: "NO_LOCATION" });
  }
  const customer = await prisma.customer.create({
    data: {
      locationId: req.auth!.locationId,
      fullName: parsed.data.fullName,
      phoneNormalized,
      whatsapp: parsed.data.whatsapp,
      notes: parsed.data.notes,
      ownerUserId: req.auth!.userId,
    },
  });
  return res.status(201).json({ match: "CREATED", customer });
});

// GET /api/v1/customers/:id — Customer 360 core payload (relations expanded
// as other modules come online: sales, warranties, SAV).
crmRouter.get("/:id", requireAuth, async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: { sales: true, warranties: true },
  });
  if (!customer) return res.status(404).json({ error: "NOT_FOUND" });
  return res.json(customer);
});
