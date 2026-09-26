import { Prisma, UnitStatus, ReceivableStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../../lib/audit";
import { nextReference } from "../../lib/reference";

export class SaleError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

interface CompleteSaleInput {
  locationId: string;
  customerId: string;
  sellerId: string;
  imei: string;
  discountPct: number; // 0-100
  payment: { method: "CASH" | "MOBILE_MONEY" | "BANK"; amount: number; reference?: string };
  correlationId: string; // idempotency key for the whole checkout request
}

const MAX_SELLER_DISCOUNT_PCT = 10; // beyond this: requires Approval (BUILD 7) — not yet wired in V1 skeleton

/**
 * GOLDEN SALE (§16 / BUILD 3 / Release Gate A).
 *
 * Runs the full chain — validate → sell → pay → move stock → warranty →
 * receivable → audit — inside ONE Postgres transaction with SERIALIZABLE
 * isolation, so that under concurrent requests for the SAME IMEI:
 *   - exactly one transaction succeeds,
 *   - the other fails cleanly with SaleError('UNIT_UNAVAILABLE'),
 *   - no double sale, no double warranty, no stock corruption (Annex A test).
 *
 * `SELECT ... FOR UPDATE` on the InventoryUnit row is the primary guard
 * (works even without SERIALIZABLE); SERIALIZABLE is a defense-in-depth
 * second layer against write-skew across the whole transaction.
 *
 * Idempotency: the caller must pass a stable `correlationId` per checkout
 * attempt (e.g. a client-generated UUID persisted in the browser for that
 * checkout). A retried request with the same correlationId that already
 * produced a Sale returns the existing Sale rather than creating a second one.
 */
export async function completeSale(input: CompleteSaleInput) {
  return prisma.$transaction(
    async (tx) => {
      // --- Idempotency check -------------------------------------------------
      const existingAudit = await tx.auditEvent.findFirst({
        where: { correlationId: input.correlationId, action: "SALE_COMPLETED" },
      });
      if (existingAudit) {
        const existingSale = await tx.sale.findUnique({
          where: { id: existingAudit.aggregateId },
          include: { lines: true, payments: true, receivable: true },
        });
        if (existingSale) return existingSale;
      }

      // --- 1. Lock and validate the inventory unit (BR-001) ------------------
      const unitRows = await tx.$queryRaw<
        { id: string; status: UnitStatus; version: number }[]
      >(Prisma.sql`
        SELECT id, status, version FROM "InventoryUnit"
        WHERE imei = ${input.imei} AND "locationId" = ${input.locationId}
        FOR UPDATE
      `);
      const unitRow = unitRows[0];
      if (!unitRow) throw new SaleError("UNIT_NOT_FOUND", "IMEI introuvable à cet emplacement");
      if (unitRow.status !== "AVAILABLE") {
        throw new SaleError(
          "UNIT_UNAVAILABLE",
          `Appareil non disponible (statut actuel: ${unitRow.status}) — probablement déjà vendu`
        );
      }
      const unit = await tx.inventoryUnit.findUniqueOrThrow({
        where: { id: unitRow.id },
        include: { variant: true },
      });

      // --- 2. Validate customer & seller --------------------------------------
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw new SaleError("CUSTOMER_NOT_FOUND", "Client introuvable");
      const seller = await tx.user.findUnique({ where: { id: input.sellerId } });
      if (!seller || !seller.active) throw new SaleError("SELLER_INVALID", "Vendeur invalide ou inactif");

      // --- 3. Price & discount authority (BR-008) -----------------------------
      const price = Number(unit.variant.currentPrice);
      if (input.discountPct < 0 || input.discountPct > 30) {
        throw new SaleError("DISCOUNT_INVALID", "Remise hors bornes autorisées");
      }
      if (input.discountPct > MAX_SELLER_DISCOUNT_PCT) {
        // V1 skeleton: block outright. Full Approval Engine flow is BUILD 7.
        throw new SaleError(
          "DISCOUNT_NEEDS_APPROVAL",
          `Remise > ${MAX_SELLER_DISCOUNT_PCT}% nécessite une approbation manager (non encore implémentée)`
        );
      }
      const total = Math.round(price * (1 - input.discountPct / 100));
      if (unit.variant.minAllowedPrice && total < Number(unit.variant.minAllowedPrice)) {
        throw new SaleError("PRICE_BELOW_MIN", "Prix final sous le minimum autorisé pour cette variante");
      }

      // --- 4. Payment validation (BR-003, BR-019) -----------------------------
      if (input.payment.amount <= 0) throw new SaleError("PAYMENT_INVALID", "Montant de paiement invalide");
      if (input.payment.reference) {
        const dup = await tx.payment.findFirst({
          where: { method: input.payment.method, reference: input.payment.reference },
        });
        if (dup) throw new SaleError("PAYMENT_DUPLICATE", "Référence de paiement déjà utilisée");
      }

      // --- 5. Create the Sale --------------------------------------------------
      const reference = await nextReference(tx, "SALE");
      const sale = await tx.sale.create({
        data: {
          reference,
          locationId: input.locationId,
          customerId: input.customerId,
          sellerId: input.sellerId,
          status: "COMPLETED",
          subtotal: price,
          discountPct: input.discountPct,
          total,
          completedAt: new Date(),
          lines: { create: [{ unitId: unit.id, price: total }] },
          payments: {
            create: [
              {
                method: input.payment.method,
                amount: input.payment.amount,
                reference: input.payment.reference,
              },
            ],
          },
        },
        include: { lines: true, payments: true },
      });

      // --- 6. Receivable if partially paid (BR-003) -----------------------------
      const remaining = total - input.payment.amount;
      let receivable = null;
      if (remaining > 0) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30); // V1 default term; configurable later
        receivable = await tx.receivable.create({
          data: {
            saleId: sale.id,
            initialAmount: remaining,
            paidAmount: 0,
            dueDate,
            status: ReceivableStatus.DUE,
          },
        });
      }

      // --- 7. Stock movement + unit → SOLD (BR-005) -----------------------------
      await tx.inventoryUnit.update({
        where: { id: unit.id },
        data: { status: UnitStatus.SOLD, version: { increment: 1 } },
      });
      await tx.inventoryMovement.create({
        data: { unitId: unit.id, type: "SALE", reference: sale.reference },
      });

      // --- 8. Warranty (policy version pinned at issue time — §31) -------------
      if (unit.variant.warrantyPolicyId) {
        const policy = await tx.warrantyPolicy.findUniqueOrThrow({
          where: { id: unit.variant.warrantyPolicyId },
        });
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + policy.durationDays);
        await tx.warranty.create({
          data: {
            unitId: unit.id,
            customerId: customer.id,
            policyId: policy.id,
            policyTermsVersion: policy.termsVersion,
            expiresAt,
          },
        });
      }

      // --- 9. Audit (§60) --------------------------------------------------------
      await writeAudit(tx, {
        actorType: "USER",
        actorId: seller.id,
        action: "SALE_COMPLETED",
        aggregateType: "Sale",
        aggregateId: sale.id,
        correlationId: input.correlationId,
        detail: { reference: sale.reference, imei: input.imei, total, remaining },
      });

      // Commission base, finance ledger entry, analytics projection and
      // customer-facing notification are secondary effects: in the full
      // build they go through the transactional outbox AFTER this commit
      // (§55) so a notification failure can never roll back a committed sale
      // (BR-018). Not wired in this V1 skeleton — see README "Next steps".

      return { ...sale, receivable };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
