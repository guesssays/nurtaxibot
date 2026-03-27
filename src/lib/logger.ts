import { env } from "./env";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogMeta = Record<string, unknown>;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

export interface Logger {
  child(context: LogMeta): Logger;
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

class JsonLogger implements Logger {
  public constructor(
    private readonly context: LogMeta = {},
    private readonly level: LogLevel = env.LOG_LEVEL,
  ) {}

  public child(context: LogMeta): Logger {
    return new JsonLogger({ ...this.context, ...context }, this.level);
  }

  public debug(message: string, meta?: LogMeta): void {
    this.log("debug", message, meta);
  }

  public info(message: string, meta?: LogMeta): void {
    this.log("info", message, meta);
  }

  public warn(message: string, meta?: LogMeta): void {
    this.log("warn", message, meta);
  }

  public error(message: string, meta?: LogMeta): void {
    this.log("error", message, meta);
  }

  private log(level: LogLevel, message: string, meta?: LogMeta): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...(meta ? normalizeMeta(meta) : {}),
    };

    const serialized = JSON.stringify(payload);

    if (level === "error") {
      console.error(serialized);
      return;
    }

    if (level === "warn") {
      console.warn(serialized);
      return;
    }

    console.log(serialized);
  }
}

function normalizeMeta(meta: LogMeta): LogMeta {
  return Object.entries(meta).reduce<LogMeta>((accumulator, [key, value]) => {
    accumulator[key] = key.toLowerCase().includes("error") ? serializeError(value) : value;
    return accumulator;
  }, {});
}

export function createLogger(context?: LogMeta): Logger {
  return new JsonLogger(context);
}
