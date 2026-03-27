import { env } from "../lib/env";
import { createLogger, type Logger } from "../lib/logger";
import { getPrismaClient } from "../lib/prisma";
import { TelegramClient } from "../lib/telegram/client";
import { AuditLogRepository } from "../repositories/audit-log.repository";
import { BroadcastRepository } from "../repositories/broadcast.repository";
import { DailyReportSnapshotRepository } from "../repositories/daily-report-snapshot.repository";
import { EmployeeRepository } from "../repositories/employee.repository";
import { RegistrationRepository } from "../repositories/registration.repository";
import { SessionRepository } from "../repositories/session.repository";
import { AuditService } from "../services/audit.service";
import { AuthService } from "../services/auth.service";
import { BroadcastService } from "../services/broadcast.service";
import { EmployeeService } from "../services/employee.service";
import { ExportService } from "../services/export.service";
import { NotificationService } from "../services/notification.service";
import { RegistrationService } from "../services/registration.service";
import { ReminderService } from "../services/reminder.service";
import { ReportService } from "../services/report.service";
import { SessionService } from "../services/session.service";

export interface AppContext {
  logger: Logger;
  telegramClient: TelegramClient;
  authService: AuthService;
  sessionService: SessionService;
  employeeService: EmployeeService;
  broadcastService: BroadcastService;
  registrationService: RegistrationService;
  reportService: ReportService;
  exportService: ExportService;
  notificationService: NotificationService;
  reminderService: ReminderService;
}

export function createAppContext(requestId: string): AppContext {
  const logger = createLogger({
    requestId,
    service: "wb-taxi-registration-bot",
  });

  const prisma = getPrismaClient();
  const employeeRepository = new EmployeeRepository();
  const broadcastRepository = new BroadcastRepository();
  const registrationRepository = new RegistrationRepository();
  const sessionRepository = new SessionRepository();
  const auditLogRepository = new AuditLogRepository();
  const dailyReportSnapshotRepository = new DailyReportSnapshotRepository();
  const auditService = new AuditService(auditLogRepository);
  const telegramClient = new TelegramClient(env.TELEGRAM_BOT_TOKEN, logger.child({ integration: "telegram" }));
  const notificationService = new NotificationService(
    telegramClient,
    employeeRepository,
    logger.child({ service: "notifications" }),
  );

  void prisma;

  return {
    logger,
    telegramClient,
    authService: new AuthService(employeeRepository),
    sessionService: new SessionService(sessionRepository),
    employeeService: new EmployeeService(employeeRepository, auditService),
    broadcastService: new BroadcastService(
      broadcastRepository,
      employeeRepository,
      auditService,
      telegramClient,
      logger.child({ service: "broadcasts" }),
    ),
    registrationService: new RegistrationService(registrationRepository, auditService),
    reportService: new ReportService(registrationRepository, dailyReportSnapshotRepository),
    exportService: new ExportService(registrationRepository, employeeRepository),
    notificationService,
    reminderService: new ReminderService(registrationRepository, notificationService),
  };
}
