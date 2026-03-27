import { env } from "../lib/env";
import { createLogger, type Logger } from "../lib/logger";
import { getPrismaClient } from "../lib/prisma";
import { TelegramClient } from "../lib/telegram/client";
import { AuditLogRepository } from "../repositories/audit-log.repository";
import { BroadcastRepository } from "../repositories/broadcast.repository";
import { DailyReportSnapshotRepository } from "../repositories/daily-report-snapshot.repository";
import { EmployeeRepository } from "../repositories/employee.repository";
import { RegistrationRequestRepository } from "../repositories/registration-request.repository";
import { RegistrationRepository } from "../repositories/registration.repository";
import { SessionRepository } from "../repositories/session.repository";
import { AuditService } from "../services/audit.service";
import { AuthService } from "../services/auth.service";
import { BroadcastService } from "../services/broadcast.service";
import { EmployeeService } from "../services/employee.service";
import { ExportService } from "../services/export.service";
import { MessagePrivacyService } from "../services/message-privacy.service";
import { NotificationService } from "../services/notification.service";
import { RegistrationRequestService } from "../services/registration-request.service";
import { RegistrationService } from "../services/registration.service";
import { ReminderService } from "../services/reminder.service";
import { ReportService } from "../services/report.service";
import { SessionService } from "../services/session.service";
import { UserManagementService } from "../services/user-management.service";

export interface AppContext {
  logger: Logger;
  telegramClient: TelegramClient;
  authService: AuthService;
  sessionService: SessionService;
  employeeService: EmployeeService;
  userManagementService: UserManagementService;
  registrationRequestService: RegistrationRequestService;
  broadcastService: BroadcastService;
  registrationService: RegistrationService;
  reportService: ReportService;
  exportService: ExportService;
  notificationService: NotificationService;
  messagePrivacyService: MessagePrivacyService;
  reminderService: ReminderService;
}

export function createAppContext(requestId: string): AppContext {
  const logger = createLogger({
    requestId,
    service: "wb-taxi-registration-bot",
  });

  const prisma = getPrismaClient();
  const employeeRepository = new EmployeeRepository();
  const registrationRequestRepository = new RegistrationRequestRepository();
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
  const messagePrivacyService = new MessagePrivacyService(
    telegramClient,
    logger.child({ service: "message-privacy" }),
  );
  const userManagementService = new UserManagementService(employeeRepository, auditService);

  void prisma;

  return {
    logger,
    telegramClient,
    authService: new AuthService(employeeRepository, logger.child({ service: "auth" })),
    sessionService: new SessionService(sessionRepository),
    employeeService: new EmployeeService(userManagementService),
    userManagementService,
    registrationRequestService: new RegistrationRequestService(
      registrationRequestRepository,
      employeeRepository,
      auditService,
      notificationService,
      env.APP_TIMEZONE,
    ),
    broadcastService: new BroadcastService(
      broadcastRepository,
      employeeRepository,
      auditService,
      telegramClient,
      logger.child({ service: "broadcasts" }),
    ),
    registrationService: new RegistrationService(
      registrationRepository,
      auditService,
      logger.child({ service: "registrations" }),
    ),
    reportService: new ReportService(registrationRepository, dailyReportSnapshotRepository),
    exportService: new ExportService(registrationRepository, employeeRepository),
    notificationService,
    messagePrivacyService,
    reminderService: new ReminderService(registrationRepository, notificationService),
  };
}
