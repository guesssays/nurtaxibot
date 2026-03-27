import { PrismaClient } from "@prisma/client";

declare global {
  var __wbTaxiPrisma__: PrismaClient | undefined;
}

export type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export function getPrismaClient(): PrismaClient {
  if (!global.__wbTaxiPrisma__) {
    global.__wbTaxiPrisma__ = new PrismaClient();
  }

  return global.__wbTaxiPrisma__;
}
