import { Request, Response, NextFunction } from "express";
import { RoleName } from "@prisma/client";
import { verifyToken, AuthTokenPayload } from "../modules/auth/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

/**
 * Every route is authenticated; there is no implicit trust of the frontend
 * (§51: "Le frontend n'est jamais l'autorité métier"). Permissions are
 * re-verified here on every request, never inferred from client state.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  try {
    req.auth = verifyToken(header.slice("Bearer ".length));
    next();
  } catch {
    return res.status(401).json({ error: "TOKEN_INVALID" });
  }
}

/**
 * Coarse role gate. Fine-grained field-level classification (§59: PUBLIC /
 * INTERNAL / CONFIDENTIAL / RESTRICTED — e.g. hiding supplier cost from
 * SELLER) is applied per-serializer in each module, not here.
 */
export function requireRole(...allowed: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "UNAUTHENTICATED" });
    if (!allowed.includes(req.auth.role)) {
      return res.status(403).json({ error: "FORBIDDEN", detail: `Role ${req.auth.role} not permitted` });
    }
    next();
  };
}
