import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as { __asfPrisma?: PrismaClient };

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const adapter = new PrismaPg({ connectionString: url, max: Number(process.env.DB_POOL_SIZE ?? 10) });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.__asfPrisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.__asfPrisma = prisma;

export * from "../generated/prisma/client";
