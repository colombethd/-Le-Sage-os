import { Prisma } from "@prisma/client";

/**
 * Writes an audit event using the SAME transaction client as the business
 * operation it documents, so the audit row commits or rolls back atomically
 * with the operation it describes (§60, BR-010).
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  params: {
    actorType: "USER" | "SYSTEM" | "AUTOMATION" | "AI_AGENT" | "INTEGRATION";
    actorId?: string;
    action: string;
    aggregateType: string;
    aggregateId: string;
    correlationId?: string;
    detail?: Record<string, unknown>;
  }
) {
  await tx.auditEvent.create({
    data: {
      actorType: params.actorType,
      actorId: params.actorId,
      action: params.action,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      correlationId: params.correlationId,
      detail: params.detail as any,
    },
  });
}
