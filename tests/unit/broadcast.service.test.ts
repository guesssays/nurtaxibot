import {
  BroadcastContentType,
  BroadcastStatus,
  BroadcastTargetType,
  EmployeeRole,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenAppError, ValidationAppError } from "../../src/lib/errors";
import { BroadcastService } from "../../src/services/broadcast.service";
import {
  InMemoryBroadcastRepository,
  InMemoryEmployeeRepository,
  InMemoryTelegramClient,
  createAdmin,
  createSilentLogger,
} from "../helpers/broadcast-harness";
import {
  InMemoryAuditService,
  createEmployee,
  installMockPrismaTransaction,
  resetMockPrismaTransaction,
} from "../helpers/registration-harness";

describe("BroadcastService", () => {
  beforeEach(() => {
    installMockPrismaTransaction();
  });

  afterEach(() => {
    resetMockPrismaTransaction();
  });

  function createService(employees: ReturnType<typeof createEmployee>[]) {
    const employeeRepository = new InMemoryEmployeeRepository(employees);
    const broadcastRepository = new InMemoryBroadcastRepository(employeeRepository);
    const auditService = new InMemoryAuditService();
    const telegramClient = new InMemoryTelegramClient();
    const service = new BroadcastService(
      broadcastRepository as never,
      employeeRepository as never,
      auditService as never,
      telegramClient as never,
      createSilentLogger(),
    );

    return {
      service,
      employeeRepository,
      broadcastRepository,
      auditService,
      telegramClient,
    };
  }

  it("allows only admin to create draft", async () => {
    const employee = createEmployee({ role: EmployeeRole.EMPLOYEE });
    const { service } = createService([employee]);

    await expect(
      service.createDraft(employee, {
        contentType: BroadcastContentType.TEXT,
      }),
    ).rejects.toBeInstanceOf(ForbiddenAppError);
  });

  it("does not allow sending empty draft", async () => {
    const admin = createAdmin();
    const recipient = createEmployee({ id: "emp_2", telegramId: BigInt(2002) });
    const { service } = createService([admin, recipient]);

    const draft = await service.createDraft(admin, {
      contentType: BroadcastContentType.TEXT,
    });

    await expect(service.sendBroadcast(admin, draft.id)).rejects.toBeInstanceOf(ValidationAppError);
  });

  it("deduplicates recipients by telegram id", async () => {
    const admin = createAdmin();
    const employeeA = createEmployee({ id: "emp_a", telegramId: BigInt(3001), role: EmployeeRole.EMPLOYEE });
    const employeeB = createEmployee({ id: "emp_b", telegramId: BigInt(3001), role: EmployeeRole.EMPLOYEE });
    const { service } = createService([admin, employeeA, employeeB]);

    const recipients = await service.getRecipients(admin, BroadcastTargetType.ALL_ACTIVE_USERS);

    expect(recipients).toHaveLength(2);
    expect(new Set(recipients.map((item) => item.telegramId.toString()))).toEqual(
      new Set([admin.telegramId!.toString(), "3001"]),
    );
  });

  it("sends text broadcast via sendMessage", async () => {
    const admin = createAdmin();
    const recipient = createEmployee({ id: "emp_2", telegramId: BigInt(2002) });
    const { service, telegramClient } = createService([admin, recipient]);

    const draft = await service.createDraft(admin, {
      contentType: BroadcastContentType.TEXT,
    });
    await service.attachText(admin, draft.id, "Important update");
    const result = await service.sendBroadcast(admin, draft.id);

    expect(result.status).toBe(BroadcastStatus.COMPLETED);
    expect(telegramClient.sent.map((item) => item.method)).toEqual(["sendMessage", "sendMessage"]);
  });

  it("uses sendPhoto for photo broadcasts", async () => {
    const admin = createAdmin();
    const recipient = createEmployee({ id: "emp_2", telegramId: BigInt(2002) });
    const { service, telegramClient } = createService([admin, recipient]);

    const draft = await service.createDraft(admin, {
      contentType: BroadcastContentType.PHOTO,
    });
    await service.attachPhoto(admin, draft.id, {
      fileId: "photo_123",
      fileUniqueId: "photo_unique_123",
      caption: "Promo image",
    });
    await service.sendBroadcast(admin, draft.id);

    expect(telegramClient.sent[0]?.method).toBe("sendPhoto");
  });

  it("uses sendVideo for video broadcasts", async () => {
    const admin = createAdmin();
    const recipient = createEmployee({ id: "emp_2", telegramId: BigInt(2002) });
    const { service, telegramClient } = createService([admin, recipient]);

    const draft = await service.createDraft(admin, {
      contentType: BroadcastContentType.VIDEO,
    });
    await service.attachVideo(admin, draft.id, {
      fileId: "video_123",
      fileUniqueId: "video_unique_123",
      caption: "Promo video",
    });
    await service.sendBroadcast(admin, draft.id);

    expect(telegramClient.sent[0]?.method).toBe("sendVideo");
  });

  it("uses sendDocument for document broadcasts", async () => {
    const admin = createAdmin();
    const recipient = createEmployee({ id: "emp_2", telegramId: BigInt(2002) });
    const { service, telegramClient } = createService([admin, recipient]);

    const draft = await service.createDraft(admin, {
      contentType: BroadcastContentType.DOCUMENT,
    });
    await service.attachDocument(admin, draft.id, {
      fileId: "doc_123",
      fileUniqueId: "doc_unique_123",
      fileName: "file.pdf",
      caption: "Read carefully",
    });
    await service.sendBroadcast(admin, draft.id);

    expect(telegramClient.sent[0]?.method).toBe("sendDocument");
  });

  it("keeps sending when one recipient fails and marks partial failed", async () => {
    const admin = createAdmin();
    const recipientA = createEmployee({ id: "emp_2", telegramId: BigInt(2002) });
    const recipientB = createEmployee({ id: "emp_3", telegramId: BigInt(2003) });
    const { service, telegramClient, broadcastRepository } = createService([admin, recipientA, recipientB]);
    telegramClient.failChat("2003", {
      telegramErrorCode: 403,
      telegramDescription: "Forbidden: bot was blocked by the user",
      status: 403,
    });

    const draft = await service.createDraft(admin, {
      contentType: BroadcastContentType.TEXT,
    });
    await service.attachText(admin, draft.id, "System notice");
    const result = await service.sendBroadcast(admin, draft.id);

    expect(result.status).toBe(BroadcastStatus.PARTIAL_FAILED);
    expect(result.sentCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(broadcastRepository.broadcasts[0]?.deliveries.some((delivery) => delivery.status === "FAILED")).toBe(true);
  });

  it("marks failed status when no deliveries succeed", async () => {
    const admin = createAdmin();
    const recipient = createEmployee({ id: "emp_2", telegramId: BigInt(2002) });
    const { service, telegramClient } = createService([admin, recipient]);
    telegramClient.failChat(admin.telegramId!.toString(), {
      telegramErrorCode: 403,
      telegramDescription: "Forbidden",
      status: 403,
    });
    telegramClient.failChat("2002", {
      telegramErrorCode: 403,
      telegramDescription: "Forbidden",
      status: 403,
    });

    const draft = await service.createDraft(admin, {
      contentType: BroadcastContentType.TEXT,
    });
    await service.attachText(admin, draft.id, "Outage notification");
    const result = await service.sendBroadcast(admin, draft.id);

    expect(result.status).toBe(BroadcastStatus.FAILED);
    expect(result.sentCount).toBe(0);
    expect(result.failedCount).toBe(2);
  });

  it("returns broadcast history in reverse chronological order", async () => {
    const admin = createAdmin();
    const recipient = createEmployee({ id: "emp_2", telegramId: BigInt(2002) });
    const { service } = createService([admin, recipient]);

    const first = await service.createDraft(admin, {
      contentType: BroadcastContentType.TEXT,
    });
    await service.attachText(admin, first.id, "First");
    await service.sendBroadcast(admin, first.id);

    const second = await service.createDraft(admin, {
      contentType: BroadcastContentType.TEXT,
    });
    await service.attachText(admin, second.id, "Second");
    await service.cancelDraft(admin, second.id);

    const history = await service.getBroadcastHistory(admin, 10);

    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe(second.id);
    expect(history[1]?.id).toBe(first.id);
  });
});
