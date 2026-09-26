import { Prisma } from "@prisma/client";

/**
 * Generates a safe, atomic, human-readable reference (e.g. SALE-0001) inside
 * an existing transaction, using Postgres advisory locking on the prefix so
 * two concurrent transactions can never receive the same number (§11).
 *
 * NOTE: for V1 volumes (single pilot store) this COUNT-based approach is
 * sufficient and simple. If throughput grows, replace with a dedicated
 * `sequence` table (prefix, next_value) updated via `SELECT ... FOR UPDATE`.
 */
export async function nextReference(
  tx: Prisma.TransactionClient,
  prefix: "SALE" | "SAV" | "PO" | "PR"
): Promise<string> {
  // Advisory lock keyed by prefix hash — serializes reference generation
  // across concurrent transactions without locking an entire table.
  const lockKey = hashPrefix(prefix);
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

  let count: number;
  switch (prefix) {
    case "SALE":
      count = await tx.sale.count();
      break;
    default:
      throw new Error(`Reference prefix not yet wired: ${prefix}`);
  }
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

function hashPrefix(prefix: string): number {
  let h = 0;
  for (const c of prefix) h = (h * 31 + c.charCodeAt(0)) % 2147483647;
  return h;
}
