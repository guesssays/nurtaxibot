import {
  EmployeeRole,
  UserRegistrationRequestStatus,
  type Employee,
} from "@prisma/client";

import { getPrismaClient } from "../lib/prisma";
import { toPrismaJsonValue } from "../lib/json";
import {
  ConflictAppError,
  ForbiddenAppError,
  NotFoundAppError,
  ValidationAppError,
} from "../lib/errors";
import { assertAdmin } from "../lib/rbac";
import {
  buildRegistrationRequestNotificationKeyboard,
} from "../lib/telegram/keyboards";
import {
  formatAdminRegistrationNotification,
  formatRegistrationApprovedMessage,
  formatRegistrationRejectedMessage,
} from "../lib/telegram/user-management-formatters";
import {
  registrationRequestApprovalSchema,
  registrationRequestCreateSchema,
  registrationRequestRejectSchema,
} from "../lib/validators";
import { EmployeeRepository } from "../repositories/employee.repository";
import {
  RegistrationRequestRepository,
  type CreateRegistrationRequestInput,
  type RegistrationRequestRecord,
} from "../repositories/registration-request.repository";
import { AuditService } from "./audit.service";
import { NotificationService } from "./notification.service";

export interface CreateRegistrationRequestResult {
  request: RegistrationRequestRecord;
  created: boolean;
}

export interface ApproveRegistrationRequestInput {
  role: EmployeeRole;
  employeeCode: string;
  fullName: string;
  isActive?: boolean;
  reviewComment?: string | null;
}

function serializeRequestForAudit(request: RegistrationRequestRecord) {
  return {
    id: request.id,
    telegramId: request.telegramId.toString(),
    username: request.username,
    fullName: request.fullName,
    employeeCode: request.employeeCode,
    requestedRole: request.requestedRole,
    status: request.status,
  };
}

export class RegistrationRequestService {
  public constructor(
    private readonly registrationRequestRepository: RegistrationRequestRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly auditService: AuditService,
    private readonly notificationService: NotificationService,
    private readonly timezoneName: string,
  ) {}

  public async createRegistrationRequest(
    input: CreateRegistrationRequestInput,
  ): Promise<CreateRegistrationRequestResult> {
    const parsedInput = registrationRequestCreateSchema.parse(input);
    const existingEmployee = await this.employeeRepository.findByTelegramId(parsedInput.telegramId);

    if (existingEmployee?.isActive) {
      throw new ConflictAppError("Пользователь уже зарегистрирован и активирован.");
    }

    const pending = await this.registrationRequestRepository.findPendingByTelegramId(parsedInput.telegramId);

    if (pending) {
      return {
        request: pending,
        created: false,
      };
    }

    const request = await this.registrationRequestRepository.create(parsedInput);
    await this.auditService.log(
      "registration_request_created",
      "USER_REGISTRATION_REQUEST",
      toPrismaJsonValue(serializeRequestForAudit(request)),
      null,
      request.id,
    );

    await this.notifyAdminsAboutRegistrationRequest(request);

    return {
      request,
      created: true,
    };
  }

  public async getPendingRegistrationRequestByTelegramId(telegramId: bigint): Promise<RegistrationRequestRecord | null> {
    return this.registrationRequestRepository.findPendingByTelegramId(telegramId);
  }

  public async getLatestRegistrationRequestByTelegramId(telegramId: bigint): Promise<RegistrationRequestRecord | null> {
    return this.registrationRequestRepository.findLatestByTelegramId(telegramId);
  }

  public async listPendingRegistrationRequests(actor: Employee, limit: number = 20): Promise<RegistrationRequestRecord[]> {
    assertAdmin(actor.role);
    return this.registrationRequestRepository.listPending(limit);
  }

  public async getRegistrationRequestDetails(actor: Employee, requestId: string): Promise<RegistrationRequestRecord> {
    assertAdmin(actor.role);
    const request = await this.registrationRequestRepository.findById(requestId);

    if (!request) {
      throw new NotFoundAppError("Заявка не найдена.");
    }

    await this.auditService.log(
      "registration_request_viewed",
      "USER_REGISTRATION_REQUEST",
      toPrismaJsonValue({
        status: request.status,
      }),
      actor.id,
      request.id,
    );

    return request;
  }

  public async approveRegistrationRequest(
    actor: Employee,
    requestId: string,
    input: ApproveRegistrationRequestInput,
  ): Promise<RegistrationRequestRecord> {
    assertAdmin(actor.role);
    const parsedInput = registrationRequestApprovalSchema.parse(input);
    const prisma = getPrismaClient();

    const { reviewedRequest, approvedRole } = await prisma.$transaction(async (tx) => {
      const request = await this.registrationRequestRepository.findById(requestId, tx);

      if (!request) {
        throw new NotFoundAppError("Заявка не найдена.");
      }

      if (request.status !== UserRegistrationRequestStatus.PENDING) {
        throw new ConflictAppError("Эта заявка уже была обработана.");
      }

      const existingEmployee = await this.employeeRepository.findByTelegramId(request.telegramId, tx);
      let approvedEmployeeId: string;

      if (existingEmployee) {
        const updatedEmployee = await this.employeeRepository.update(existingEmployee.id, {
          telegramId: request.telegramId,
          employeeCode: parsedInput.employeeCode,
          fullName: parsedInput.fullName,
          role: parsedInput.role,
          isActive: parsedInput.isActive,
        }, tx);
        approvedEmployeeId = updatedEmployee.id;
      } else {
        const createdEmployee = await this.employeeRepository.create({
          telegramId: request.telegramId,
          employeeCode: parsedInput.employeeCode,
          fullName: parsedInput.fullName,
          role: parsedInput.role,
          isActive: parsedInput.isActive,
        }, tx);
        approvedEmployeeId = createdEmployee.id;
      }

      const reviewedRequest = await this.registrationRequestRepository.updateReview(
        request.id,
        {
          status: UserRegistrationRequestStatus.APPROVED,
          reviewedByEmployeeId: actor.id,
          reviewComment: parsedInput.reviewComment ?? null,
          approvedEmployeeId,
          reviewedAt: new Date(),
        },
        tx,
      );

      await this.auditService.log(
        "registration_request_approved",
        "USER_REGISTRATION_REQUEST",
        toPrismaJsonValue({
          requestId: request.id,
          employeeId: approvedEmployeeId,
          role: parsedInput.role,
          employeeCode: parsedInput.employeeCode,
          fullName: parsedInput.fullName,
        }),
        actor.id,
        request.id,
        tx,
      );

      return {
        reviewedRequest,
        approvedRole: parsedInput.role,
      };
    });

    await this.notifyUserRegistrationApproved(reviewedRequest, approvedRole);
    return reviewedRequest;
  }

  public async rejectRegistrationRequest(
    actor: Employee,
    requestId: string,
    reviewComment?: string | null,
  ): Promise<RegistrationRequestRecord> {
    assertAdmin(actor.role);
    const parsedInput = registrationRequestRejectSchema.parse({
      reviewComment: reviewComment ?? null,
    });

    const request = await this.registrationRequestRepository.findById(requestId);

    if (!request) {
      throw new NotFoundAppError("Заявка не найдена.");
    }

    if (request.status !== UserRegistrationRequestStatus.PENDING) {
      throw new ConflictAppError("Эта заявка уже была обработана.");
    }

    const reviewedRequest = await this.registrationRequestRepository.updateReview(request.id, {
      status: UserRegistrationRequestStatus.REJECTED,
      reviewedByEmployeeId: actor.id,
      reviewComment: parsedInput.reviewComment ?? null,
      reviewedAt: new Date(),
    });

    await this.auditService.log(
      "registration_request_rejected",
      "USER_REGISTRATION_REQUEST",
      toPrismaJsonValue({
        requestId: request.id,
        reviewComment: parsedInput.reviewComment ?? null,
      }),
      actor.id,
      request.id,
    );

    await this.notifyUserRegistrationRejected(reviewedRequest);
    return reviewedRequest;
  }

  public async notifyAdminsAboutRegistrationRequest(request: RegistrationRequestRecord): Promise<void> {
    await this.notificationService.notifyAdmins(
      formatAdminRegistrationNotification(request, this.timezoneName),
      buildRegistrationRequestNotificationKeyboard(request.id),
    );
  }

  public async notifyUserRegistrationApproved(
    request: RegistrationRequestRecord,
    role: EmployeeRole,
  ): Promise<void> {
    await this.notificationService.notifyUserByTelegramId(
      request.telegramId,
      formatRegistrationApprovedMessage(role),
    );
  }

  public async notifyUserRegistrationRejected(request: RegistrationRequestRecord): Promise<void> {
    await this.notificationService.notifyUserByTelegramId(
      request.telegramId,
      formatRegistrationRejectedMessage(request.reviewComment),
    );
  }

  public async assertAdminCanManageRequests(employee: Employee): Promise<void> {
    if (employee.role !== EmployeeRole.ADMIN) {
      throw new ForbiddenAppError("Управление заявками доступно только администратору.");
    }
  }
}
