import { Prisma } from "@prisma/client";

export function isPrismaKnownRequestError(
  error: unknown,
  code?: string,
): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return code ? error.code === code : true;
}
