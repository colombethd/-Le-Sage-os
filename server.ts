import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { salesRouter } from "./modules/sales/routes";
import { inventoryRouter } from "./modules/inventory/routes";
import { crmRouter } from "./modules/crm/routes";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/v1/sales", salesRouter);
app.use("/api/v1/inventory", inventoryRouter);
app.use("/api/v1/customers", crmRouter);

// TODO (next builds): /api/v1/auth (login), /api/v1/procurement, /api/v1/finance,
// /api/v1/sav, /api/v1/tasks, /api/v1/analytics, /api/v1/ask.

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`LE SAGE OS backend listening on :${port}`);
});
