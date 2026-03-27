export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;
export const TELEGRAM_CAPTION_MAX_LENGTH = 1024;

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function findSplitIndex(text: string, maxLength: number): number {
  if (text.length <= maxLength) {
    return text.length;
  }

  const chunk = text.slice(0, maxLength);
  const newlineIndex = chunk.lastIndexOf("\n");

  if (newlineIndex >= Math.floor(maxLength * 0.5)) {
    return newlineIndex;
  }

  const spaceIndex = chunk.lastIndexOf(" ");

  if (spaceIndex >= Math.floor(maxLength * 0.5)) {
    return spaceIndex;
  }

  return maxLength;
}

export function splitTelegramText(rawText: string, maxLength: number = TELEGRAM_MESSAGE_MAX_LENGTH): string[] {
  const normalizedText = normalizeWhitespace(rawText);

  if (normalizedText.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let remainder = normalizedText;

  while (remainder.length > 0) {
    const splitIndex = findSplitIndex(remainder, maxLength);
    const chunk = remainder.slice(0, splitIndex).trim();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    remainder = remainder.slice(splitIndex).trim();
  }

  return chunks;
}

export function buildMediaTextPlan(text?: string | null): {
  caption: string | undefined;
  followUpMessages: string[];
  sendCaptionSeparately: boolean;
} {
  if (!text) {
    return {
      caption: undefined,
      followUpMessages: [],
      sendCaptionSeparately: false,
    };
  }

  const normalizedText = normalizeWhitespace(text);

  if (normalizedText.length === 0) {
    return {
      caption: undefined,
      followUpMessages: [],
      sendCaptionSeparately: false,
    };
  }

  if (normalizedText.length <= TELEGRAM_CAPTION_MAX_LENGTH) {
    return {
      caption: normalizedText,
      followUpMessages: [],
      sendCaptionSeparately: false,
    };
  }

  return {
    caption: undefined,
    followUpMessages: splitTelegramText(normalizedText),
    sendCaptionSeparately: true,
  };
}
