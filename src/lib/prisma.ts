import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance (avoids exhausting Postgres connections in dev with hot reload).
export const prisma = new PrismaClient();
