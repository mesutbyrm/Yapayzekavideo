import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as { __asfPrisma?: PrismaClient };

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const adapter = new PrismaPg({ connectionString: url, max: Number(process.env.DB_POOL_SIZE ?? 10) });
  return new PrismaClient({ adapter });
}

function client(): PrismaClient {
  // Tembel oluşturma: modül içe aktarılırken (ör. derleme sırasında) veritabanı bağlantısı gerekmez
  globalForPrisma.__asfPrisma ??= create();
  return globalForPrisma.__asfPrisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const c = client();
    const v = Reflect.get(c, prop, c);
    return typeof v === "function" ? v.bind(c) : v;
  },
});

export * from "../generated/prisma/client";
