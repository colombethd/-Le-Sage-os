import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { RoleName } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail fast: never run with a default/guessable secret (§58).
  throw new Error("JWT_SECRET env var is required");
}

export interface AuthTokenPayload {
  userId: string;
  organizationId: string;
  locationId: string | null;
  role: RoleName;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: "12h" });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET as string) as AuthTokenPayload;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
