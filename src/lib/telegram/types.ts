export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  document?: TelegramDocument;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface ReplyKeyboardMarkup {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard: boolean;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramSendMessagePayload {
  chat_id: number | string;
  text: string;
  reply_markup?: ReplyKeyboardMarkup | InlineKeyboardMarkup;
}

export interface TelegramSendPhotoPayload {
  chat_id: number | string;
  photo: string;
  caption?: string;
}

export interface TelegramSendVideoPayload {
  chat_id: number | string;
  video: string;
  caption?: string;
}

export interface TelegramSendDocumentByFileIdPayload {
  chat_id: number | string;
  document: string;
  caption?: string;
}

export interface TelegramEditMessageTextPayload {
  chat_id: number | string;
  message_id: number;
  text: string;
  reply_markup?: InlineKeyboardMarkup;
}

export interface TelegramDeleteMessagePayload {
  chat_id: number | string;
  message_id: number;
}

export interface TelegramAnswerCallbackQueryPayload {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}
