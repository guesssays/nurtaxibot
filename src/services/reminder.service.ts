import type { Employee } from "@prisma/client";

import { env } from "../lib/env";
import { assertAdmin } from "../lib/rbac";
import { RegistrationRepository } from "../repositories/registration.repository";
import { NotificationService } from "./notification.service";

export class ReminderService {
  public constructor(
    private readonly registrationRepository: RegistrationRepository,
    private readonly notificationService: NotificationService,
  ) {}

  public async sendPendingRegistrationReminders(): Promise<{
    totalCandidates: number;
    remindersSent: number;
  }> {
    const olderThan = new Date(Date.now() - env.REMINDER_THRESHOLD_MINUTES * 60 * 1000);
    const remindAgainBefore = new Date(Date.now() - env.REMINDER_REPEAT_MINUTES * 60 * 1000);
    const registrations = await this.registrationRepository.listStuckForReminder(
      olderThan,
      remindAgainBefore,
    );

    let remindersSent = 0;

    for (const registration of registrations) {
      await this.notificationService.notifyRegistrationReminder(registration);
      await this.registrationRepository.markReminderSent(registration.id, new Date());
      remindersSent += 1;
    }

    return {
      totalCandidates: registrations.length,
      remindersSent,
    };
  }

  public async listStuckRegistrations(actor: Employee) {
    assertAdmin(actor.role);

    const olderThan = new Date(Date.now() - env.REMINDER_THRESHOLD_MINUTES * 60 * 1000);
    const remindAgainBefore = new Date(Date.now() - env.REMINDER_REPEAT_MINUTES * 60 * 1000);
    return this.registrationRepository.listStuckForReminder(olderThan, remindAgainBefore);
  }
}
