import type { RegistrationSource, RegistrationStatus } from "@prisma/client";

import type { RegistrationWithEmployeesRecord } from "../repositories/registration.repository";

export interface AggregatedTotals {
  started: number;
  success: number;
  errors: number;
  cancelled: number;
  inProgress: number;
  fastRegistrations: number;
}

export interface AggregatedBySource extends AggregatedTotals {
  source: RegistrationSource;
}

export interface AggregatedByEmployee {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  started: number;
  success: number;
  errors: number;
  fastRegistrations: number;
  conversion: number;
}

export interface AggregatedReport {
  totals: AggregatedTotals;
  bySource: AggregatedBySource[];
  byEmployee: AggregatedByEmployee[];
}

function createEmptyTotals(): AggregatedTotals {
  return {
    started: 0,
    success: 0,
    errors: 0,
    cancelled: 0,
    inProgress: 0,
    fastRegistrations: 0,
  };
}

function applyStatusTotals(target: AggregatedTotals, status: RegistrationStatus, antifraudFlag: boolean): void {
  target.started += 1;

  if (status === "SUCCESS") {
    target.success += 1;
  }

  if (status === "ERROR") {
    target.errors += 1;
  }

  if (status === "CANCELLED") {
    target.cancelled += 1;
  }

  if (status === "IN_PROGRESS") {
    target.inProgress += 1;
  }

  if (antifraudFlag) {
    target.fastRegistrations += 1;
  }
}

export function aggregateRegistrations(registrations: RegistrationWithEmployeesRecord[]): AggregatedReport {
  const totals = createEmptyTotals();
  const bySourceMap = new Map<RegistrationSource, AggregatedBySource>();
  const byEmployeeMap = new Map<string, AggregatedByEmployee>();

  for (const registration of registrations) {
    applyStatusTotals(totals, registration.status, registration.antifraudFlag);

    const sourceBucket =
      bySourceMap.get(registration.source) ??
      ({
        source: registration.source,
        ...createEmptyTotals(),
      } satisfies AggregatedBySource);

    applyStatusTotals(sourceBucket, registration.status, registration.antifraudFlag);
    bySourceMap.set(registration.source, sourceBucket);

    const employeeBucket =
      byEmployeeMap.get(registration.startedByEmployeeId) ??
      ({
        employeeId: registration.startedByEmployeeId,
        employeeCode: registration.startedBy.employeeCode,
        fullName: registration.startedBy.fullName,
        started: 0,
        success: 0,
        errors: 0,
        fastRegistrations: 0,
        conversion: 0,
      } satisfies AggregatedByEmployee);

    employeeBucket.started += 1;

    if (registration.status === "SUCCESS") {
      employeeBucket.success += 1;
    }

    if (registration.status === "ERROR") {
      employeeBucket.errors += 1;
    }

    if (registration.antifraudFlag) {
      employeeBucket.fastRegistrations += 1;
    }

    byEmployeeMap.set(registration.startedByEmployeeId, employeeBucket);
  }

  const byEmployee = Array.from(byEmployeeMap.values())
    .map((item) => ({
      ...item,
      conversion: item.started === 0 ? 0 : (item.success / item.started) * 100,
    }))
    .sort((left, right) => right.started - left.started || left.fullName.localeCompare(right.fullName));

  const bySource = Array.from(bySourceMap.values()).sort((left, right) => left.source.localeCompare(right.source));

  return {
    totals,
    bySource,
    byEmployee,
  };
}
