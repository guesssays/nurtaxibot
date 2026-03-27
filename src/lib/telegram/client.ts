import { InternalAppError } from "../errors";
import type { Logger } from "../logger";

import type {
  TelegramAnswerCallbackQueryPayload,
  TelegramEditMessageTextPayload,
  TelegramMessage,
  TelegramSendDocumentByFileIdPayload,
  TelegramSendMessagePayload,
  TelegramSendPhotoPayload,
  TelegramSendVideoPayload,
} from "./types";

interface TelegramApiSuccess<T> {
  ok: true;
  result: T;
}

interface TelegramApiFailure {
  ok: false;
  error_code: number;
  description: string;
  parameters?: {
    retry_after?: number;
  };
}

type TelegramApiResponse<T> = TelegramApiSuccess<T> | TelegramApiFailure;

export class TelegramClient {
  public constructor(
    private readonly token: string,
    private readonly logger: Logger,
  ) {}

  public async sendMessage(payload: TelegramSendMessagePayload): Promise<TelegramMessage> {
    return this.apiCall<TelegramMessage>("sendMessage", payload);
  }

  public async sendPhoto(payload: TelegramSendPhotoPayload): Promise<TelegramMessage> {
    return this.apiCall<TelegramMessage>("sendPhoto", payload);
  }

  public async sendVideo(payload: TelegramSendVideoPayload): Promise<TelegramMessage> {
    return this.apiCall<TelegramMessage>("sendVideo", payload);
  }

  public async sendDocumentByFileId(payload: TelegramSendDocumentByFileIdPayload): Promise<TelegramMessage> {
    return this.apiCall<TelegramMessage>("sendDocument", payload);
  }

  public async sendDocument(
    chatId: number | string,
    fileName: string,
    buffer: Buffer,
    caption?: string,
  ): Promise<TelegramMessage> {
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("document", new Blob([new Uint8Array(buffer)]), fileName);

    if (caption) {
      formData.append("caption", caption);
    }

    return this.apiCall<TelegramMessage>("sendDocument", formData);
  }

  public async editMessageText(
    payload: TelegramEditMessageTextPayload,
  ): Promise<TelegramMessage | true> {
    return this.apiCall<TelegramMessage | true>("editMessageText", payload);
  }

  public async answerCallbackQuery(payload: TelegramAnswerCallbackQueryPayload): Promise<boolean> {
    return this.apiCall<boolean>("answerCallbackQuery", payload);
  }

  public async setWebhook(url: string, secretToken: string): Promise<boolean> {
    return this.apiCall<boolean>("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
    });
  }

  private async apiCall<T>(method: string, payload: BodyInit | object): Promise<T> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const isFormDataPayload = payload instanceof FormData;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: isFormDataPayload
          ? undefined
          : {
              "content-type": "application/json",
            },
        body: isFormDataPayload ? payload : JSON.stringify(payload),
      });

      const parsedResponse = (await response.json()) as TelegramApiResponse<T>;

      if (!response.ok || !parsedResponse.ok) {
        this.logger.error("Telegram API call failed", {
          method,
          status: response.status,
          response: parsedResponse,
        });

        const failure = parsedResponse.ok
          ? null
          : parsedResponse;

        throw new InternalAppError("Telegram API request failed.", {
          method,
          status: response.status,
          telegramErrorCode: failure?.error_code,
          telegramDescription: failure?.description,
          retryAfterSeconds: failure?.parameters?.retry_after,
        });
      }

      return parsedResponse.result;
    } catch (error: unknown) {
      if (error instanceof InternalAppError) {
        throw error;
      }

      this.logger.error("Telegram API transport failure", {
        method,
        error,
      });

      throw new InternalAppError("Telegram API transport failed.", {
        method,
        errorMessage: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}
