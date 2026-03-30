import { PrismaClient, EmployeeRole } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const fullName = process.env.SEED_ADMIN_FULL_NAME;
  const employeeCode = process.env.SEED_ADMIN_EMPLOYEE_CODE;
  const telegramIdRaw = process.env.SEED_ADMIN_TELEGRAM_ID;

  if (!fullName || !employeeCode || !telegramIdRaw) {
    throw new Error(
      "SEED_ADMIN_FULL_NAME, SEED_ADMIN_EMPLOYEE_CODE and SEED_ADMIN_TELEGRAM_ID are required for seed.",
    );
  }

  const telegramId = BigInt(telegramIdRaw);

  const existing = await prisma.employee.findFirst({
    where: {
      employeeCode,
      deletedAt: null,
    },
  });

  if (existing) {
    await prisma.employee.update({
      where: {
        id: existing.id,
      },
      data: {
        fullName,
        telegramId,
        role: EmployeeRole.ADMIN,
        isActive: true,
      },
    });
    return;
  }

  const deletedExisting = await prisma.employee.findFirst({
    where: {
      employeeCode,
      deletedAt: {
        not: null,
      },
    },
  });

  if (deletedExisting) {
    await prisma.employee.update({
      where: {
        id: deletedExisting.id,
      },
      data: {
        fullName,
        telegramId,
        role: EmployeeRole.ADMIN,
        isActive: true,
        deletedAt: null,
      },
    });
    return;
  }

  await prisma.employee.create({
    data: {
      fullName,
      telegramId,
      employeeCode,
      role: EmployeeRole.ADMIN,
      isActive: true,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
