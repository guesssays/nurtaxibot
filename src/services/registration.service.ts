import {
  CancelReason,
  EmployeeRole,
  RegistrationErrorReason,
  RegistrationSource,
  type Employee,
} from "@prisma/client";

import { evaluateRegistrationAntifraud } from "../lib/antifraud";
import { getTodayBounds } from "../lib/date";
import { ConflictAppError, ForbiddenAppError, NotFoundAppError, ValidationAppError } from "../lib/errors";
import { calculateDurationSeconds } from "../lib/duration";
import { env } from "../lib/env";
import type { Logger } from "../lib/logger";
import { normalizeUzPhone } from "../lib/phone";
import { isPrismaKnownRequestError } from "../lib/prisma-errors";
import { getPrismaClient } from "../lib/prisma";
import { assertAdmin, assertAdminOrSupervisor } from "../lib/rbac";
import { aggregateRegistrations } from "../lib/report-aggregation";
import {
  RegistrationRepository,
  type RegistrationWithEmployeesRecord,
} from "../repositories/registration.repository";
import { AuditService } from "./audit.service";

function toBlockingConflict(registration: RegistrationWithEmployeesRecord): ConflictAppError {
  if (registration.status === "SUCCESS") {
    return new ConflictAppError("РќРѕРјРµСЂ СѓР¶Рµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ.", {
      code: "PHONE_ALREADY_SUCCESS",
      registrationId: registration.id,
      phoneE164: registration.phoneE164,
    });
  }

  return new ConflictAppError("РќРѕРјРµСЂ СѓР¶Рµ РЅР°С…РѕРґРёС‚СЃСЏ РІ РѕР±СЂР°Р±РѕС‚РєРµ.", {
    code: "PHONE_ALREADY_IN_PROGRESS",
    registrationId: registration.id,
    phoneE164: registration.phoneE164,
    startedByEmployeeId: registration.startedByEmployeeId,
  });
}

export class RegistrationService {
  public constructor(
    private readonly registrationRepository: RegistrationRepository,
    private readonly auditService: AuditService,
    private readonly logger?: Logger,
  ) {}

  public async getEmployeeActiveRegistration(employeeId: string) {
    return this.registrationRepository.findActiveByEmployeeId(employeeId);
  }

  public async startRegistration(
    actor: Employee,
    phoneInput: string,
    source: RegistrationSource,
  ): Promise<RegistrationWithEmployeesRecord> {
    if (actor.role !== EmployeeRole.EMPLOYEE) {
      throw new ForbiddenAppError("Р—Р°РїСѓСЃРє СЂРµРіРёСЃС‚СЂР°С†РёРё С‡РµСЂРµР· СЌС‚Рѕ РґРµР№СЃС‚РІРёРµ РґРѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ СЃРѕС‚СЂСѓРґРЅРёРєСѓ.");
    }

    const phoneE164 = normalizeUzPhone(phoneInput);
    const now = new Date();
    const logMeta = {
      employeeId: actor.id,
      employeeRole: actor.role,
      source,
      normalizedPhone: phoneE164,
    };

    this.logger?.info("Registration start requested", logMeta);

    try {
      const activeByEmployee = await this.registrationRepository.findActiveByEmployeeId(actor.id);

      if (activeByEmployee) {
        throw new ConflictAppError("РЎРЅР°С‡Р°Р»Р° Р·Р°РІРµСЂС€РёС‚Рµ С‚РµРєСѓС‰СѓСЋ Р°РєС‚РёРІРЅСѓСЋ СЂРµРіРёСЃС‚СЂР°С†РёСЋ.", {
          code: "EMPLOYEE_ALREADY_HAS_ACTIVE_REGISTRATION",
          registrationId: activeByEmployee.id,
        });
      }

      const blocking = await this.registrationRepository.findBlockingByPhone(phoneE164);

      if (blocking) {
        throw toBlockingConflict(blocking);
      }

      const registration = await this.registrationRepository.createInProgress({
        phoneE164,
        source,
        startedByEmployeeId: actor.id,
        startedAt: now,
      });

      try {
        await this.auditService.log(
          "REGISTRATION_STARTED",
          "REGISTRATION",
          {
            phoneE164,
            source,
          },
          actor.id,
          registration.id,
        );
      } catch (auditError: unknown) {
        this.logger?.error("Registration start audit log failed", {
          ...logMeta,
          registrationId: registration.id,
          error: auditError,
        });
      }

      this.logger?.info("Registration created successfully", {
        ...logMeta,
        registrationId: registration.id,
        registrationStatus: registration.status,
      });

      return registration;
    } catch (error: unknown) {
      if (error instanceof ConflictAppError) {
        this.logger?.warn("Registration creation blocked by business rule", {
          ...logMeta,
          errorCode: error.code,
          error,
        });
        throw error;
      }

      if (isPrismaKnownRequestError(error, "P2002")) {
        const blocking = await this.registrationRepository.findBlockingByPhone(phoneE164);
        if (blocking) {
          const conflict = toBlockingConflict(blocking);
          this.logger?.warn("Registration creation hit unique constraint", {
            ...logMeta,
            errorCode: conflict.code,
            error,
          });
          throw conflict;
        }

        const activeByEmployee = await this.registrationRepository.findActiveByEmployeeId(actor.id);
        if (activeByEmployee) {
          const conflict = new ConflictAppError("РЈ СЃРѕС‚СЂСѓРґРЅРёРєР° СѓР¶Рµ РµСЃС‚СЊ Р°РєС‚РёРІРЅР°СЏ СЂРµРіРёСЃС‚СЂР°С†РёСЏ.", {
            code: "EMPLOYEE_ALREADY_HAS_ACTIVE_REGISTRATION",
            registrationId: activeByEmployee.id,
          });
          this.logger?.warn("Registration creation hit unique constraint", {
            ...logMeta,
            errorCode: conflict.code,
            error,
          });
          throw conflict;
        }
      }

      this.logger?.error("Registration creation failed unexpectedly", {
        ...logMeta,
        errorCode: isPrismaKnownRequestError(error) ? error.code : "UNEXPECTED_ERROR",
        error,
      });
      throw error;
    }
  }

  public async finishOwnActiveRegistration(actor: Employee): Promise<{
    registration: RegistrationWithEmployeesRecord;
    antifraudTriggered: boolean;
  }> {
    if (actor.role !== EmployeeRole.EMPLOYEE) {
      throw new ForbiddenAppError("Р—Р°РІРµСЂС€РµРЅРёРµ СЂРµРіРёСЃС‚СЂР°С†РёРё С‡РµСЂРµР· СЌС‚Рѕ РґРµР№СЃС‚РІРёРµ РґРѕСЃС‚СѓРїРЅРѕ С‚РѕР»СЊРєРѕ СЃРѕС‚СЂСѓРґРЅРёРєСѓ.");
    }

    return this.finishActiveRegistration(actor, actor.id);
  }

  public async markOwnActiveRegistrationError(
    actor: Employee,
    reason: RegistrationErrorReason,
    comment?: string,
  ): Promise<RegistrationWithEmployeesRecord> {
    if (actor.role !== EmployeeRole.EMPLOYEE) {
      throw new ForbiddenAppError("РџРѕРјРµС‚РєР° РѕС€РёР±РєРё РґРѕСЃС‚СѓРїРЅР° С‚РѕР»СЊРєРѕ СЃРѕС‚СЂСѓРґРЅРёРєСѓ.");
    }

    if (reason === RegistrationErrorReason.OTHER && (!comment || comment.trim().length === 0)) {
      throw new ValidationAppError("Р”Р»СЏ РїСЂРёС‡РёРЅС‹ OTHER РєРѕРјРјРµРЅС‚Р°СЂРёР№ РѕР±СЏР·Р°С‚РµР»РµРЅ.");
    }

    const prisma = getPrismaClient();

    return prisma.$transaction(async (tx) => {
      const active = await this.registrationRepository.findActiveByEmployeeId(actor.id, tx);

      if (!active) {
        throw new NotFoundAppError("РЈ РІР°СЃ РЅРµС‚ Р°РєС‚РёРІРЅРѕР№ СЂРµРіРёСЃС‚СЂР°С†РёРё.");
      }

      const errorAt = new Date();
      const durationSeconds = calculateDurationSeconds(active.startedAt, errorAt);
      const updated = await this.registrationRepository.transitionToError(
        {
          registrationId: active.id,
          employeeId: actor.id,
          errorAt,
          durationSeconds,
          errorReason: reason,
          errorComment: comment,
        },
        tx,
      );

      if (!updated) {
        throw new ConflictAppError("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРјРµС‚РёС‚СЊ СЂРµРіРёСЃС‚СЂР°С†РёСЋ РѕС€РёР±РєРѕР№. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.");
      }

      await this.auditService.log(
        "REGISTRATION_ERROR",
        "REGISTRATION",
        {
          reason,
          comment: comment ?? null,
          durationSeconds,
        },
        actor.id,
        updated.id,
        tx,
      );

      return updated;
    });
  }

  public async cancelOwnActiveRegistration(actor: Employee): Promise<RegistrationWithEmployeesRecord> {
    if (actor.role !== EmployeeRole.EMPLOYEE) {
      throw new ForbiddenAppError("РћС‚РјРµРЅР° СЂРµРіРёСЃС‚СЂР°С†РёРё РґРѕСЃС‚СѓРїРЅР° С‚РѕР»СЊРєРѕ СЃРѕС‚СЂСѓРґРЅРёРєСѓ.");
    }

    return this.cancelRegistration(actor, actor.id, CancelReason.EMPLOYEE_CANCELLED);
  }

  public async releaseActiveRegistration(
    actor: Employee,
    registrationId: string,
    reason: string,
  ): Promise<RegistrationWithEmployeesRecord> {
    assertAdmin(actor.role);

    const prisma = getPrismaClient();

    return prisma.$transaction(async (tx) => {
      const registration = await this.registrationRepository.findById(registrationId, tx);

      if (!registration || registration.status !== "IN_PROGRESS") {
        throw new NotFoundAppError("РђРєС‚РёРІРЅР°СЏ СЂРµРіРёСЃС‚СЂР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°.");
      }

      const updated = await this.registrationRepository.transitionToCancelled(
        {
          registrationId: registration.id,
          employeeId: actor.id,
          cancelledAt: new Date(),
          cancelReason: CancelReason.ADMIN_RELEASE,
          cancelComment: reason,
        },
        tx,
      );

      if (!updated) {
        throw new ConflictAppError("РќРµ СѓРґР°Р»РѕСЃСЊ СЃРЅСЏС‚СЊ Р°РєС‚РёРІРЅСѓСЋ СЂРµРіРёСЃС‚СЂР°С†РёСЋ.");
      }

      await this.auditService.log(
        "REGISTRATION_RELEASED_BY_ADMIN",
        "REGISTRATION",
        {
          reason,
        },
        actor.id,
        updated.id,
        tx,
      );

      return updated;
    });
  }

  public async searchHistoryByPhone(actor: Employee, phoneInput: string) {
    assertAdmin(actor.role);
    const phoneE164 = normalizeUzPhone(phoneInput);
    return this.registrationRepository.findHistoryByPhone(phoneE164);
  }

  public async searchWithinOwnActiveRegistration(actor: Employee, phoneInput: string) {
    if (actor.role !== EmployeeRole.EMPLOYEE) {
      throw new ForbiddenAppError("РџРѕРёСЃРє РІ Р°РєС‚РёРІРЅРѕР№ СЂРµРіРёСЃС‚СЂР°С†РёРё РґРѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ СЃРѕС‚СЂСѓРґРЅРёРєСѓ.");
    }

    const phoneE164 = normalizeUzPhone(phoneInput);
    const active = await this.registrationRepository.findActiveByEmployeeId(actor.id);

    if (!active) {
      throw new NotFoundAppError("РЈ РІР°СЃ РЅРµС‚ Р°РєС‚РёРІРЅРѕР№ СЂРµРіРёСЃС‚СЂР°С†РёРё.");
    }

    if (active.phoneE164 !== phoneE164) {
      throw new ForbiddenAppError("Р”РѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ РЅРѕРјРµСЂ РІР°С€РµР№ С‚РµРєСѓС‰РµР№ Р°РєС‚РёРІРЅРѕР№ СЂРµРіРёСЃС‚СЂР°С†РёРё.");
    }

    return [active];
  }

  public async getEmployeeTodayStats(actor: Employee) {
    const bounds = getTodayBounds(env.APP_TIMEZONE);
    const registrations = await this.registrationRepository.listForReport({
      start: bounds.start,
      end: bounds.end,
      employeeId: actor.id,
    });

    return aggregateRegistrations(registrations).totals;
  }

  public async listActiveRegistrations(actor: Employee) {
    assertAdmin(actor.role);
    return this.registrationRepository.listActive();
  }

  public async listAntifraudRegistrations(actor: Employee, start: Date, end: Date) {
    assertAdmin(actor.role);
    return this.registrationRepository.listAntifraud({
      start,
      end,
    });
  }

  public async getRangeRegistrationsForReports(
    actor: Employee,
    start: Date,
    end: Date,
    options?: {
      employeeId?: string;
      source?: RegistrationSource;
      status?: "ERROR";
      antifraudOnly?: boolean;
    },
  ) {
    assertAdminOrSupervisor(actor.role);

    return this.registrationRepository.listForReport({
      start,
      end,
      employeeId: options?.employeeId,
      source: options?.source,
      status: options?.status,
      antifraudOnly: options?.antifraudOnly,
    });
  }

  private async finishActiveRegistration(actor: Employee, activeEmployeeId: string): Promise<{
    registration: RegistrationWithEmployeesRecord;
    antifraudTriggered: boolean;
  }> {
    const prisma = getPrismaClient();

    return prisma.$transaction(async (tx) => {
      const active = await this.registrationRepository.findActiveByEmployeeId(activeEmployeeId, tx);

      if (!active) {
        throw new NotFoundAppError("РЈ РІР°СЃ РЅРµС‚ Р°РєС‚РёРІРЅРѕР№ СЂРµРіРёСЃС‚СЂР°С†РёРё.");
      }

      const finishedAt = new Date();
      const durationSeconds = calculateDurationSeconds(active.startedAt, finishedAt);
      const antifraud = evaluateRegistrationAntifraud(
        durationSeconds,
        env.ANTIFRAUD_FAST_REGISTRATION_SECONDS,
      );

      const updated = await this.registrationRepository.transitionToSuccess(
        {
          registrationId: active.id,
          employeeId: actor.id,
          finishedAt,
          durationSeconds,
          antifraudFlag: antifraud.antifraudFlag,
          antifraudReason: antifraud.antifraudReason,
        },
        tx,
      );

      if (!updated) {
        throw new ConflictAppError("РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РІРµСЂС€РёС‚СЊ СЂРµРіРёСЃС‚СЂР°С†РёСЋ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.");
      }

      await this.auditService.log(
        "REGISTRATION_SUCCESS",
        "REGISTRATION",
        {
          durationSeconds,
          antifraudFlag: antifraud.antifraudFlag,
          antifraudReason: antifraud.antifraudReason,
        },
        actor.id,
        updated.id,
        tx,
      );

      return {
        registration: updated,
        antifraudTriggered: antifraud.antifraudFlag,
      };
    });
  }

  private async cancelRegistration(
    actor: Employee,
    activeEmployeeId: string,
    cancelReason: CancelReason,
    cancelComment?: string,
  ): Promise<RegistrationWithEmployeesRecord> {
    const prisma = getPrismaClient();

    return prisma.$transaction(async (tx) => {
      const active = await this.registrationRepository.findActiveByEmployeeId(activeEmployeeId, tx);

      if (!active) {
        throw new NotFoundAppError("РђРєС‚РёРІРЅР°СЏ СЂРµРіРёСЃС‚СЂР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°.");
      }

      const updated = await this.registrationRepository.transitionToCancelled(
        {
          registrationId: active.id,
          employeeId: actor.id,
          cancelledAt: new Date(),
          cancelReason,
          cancelComment,
        },
        tx,
      );

      if (!updated) {
        throw new ConflictAppError("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ СЂРµРіРёСЃС‚СЂР°С†РёСЋ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.");
      }

      await this.auditService.log(
        cancelReason === CancelReason.ADMIN_RELEASE
          ? "REGISTRATION_RELEASED_BY_ADMIN"
          : "REGISTRATION_CANCELLED",
        "REGISTRATION",
        {
          cancelReason,
          cancelComment: cancelComment ?? null,
        },
        actor.id,
        updated.id,
        tx,
      );

      return updated;
    });
  }
}
