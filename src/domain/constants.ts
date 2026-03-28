export const EMPLOYEE_ROLES = ["EMPLOYEE", "ADMIN", "SUPERVISOR"] as const;
export const REGISTRATION_SOURCES = ["TELEGRAM", "SITE", "OFFLINE"] as const;
export const REGISTRATION_STATUSES = ["IN_PROGRESS", "SUCCESS", "ERROR", "CANCELLED"] as const;
export const REGISTRATION_ERROR_REASONS = [
  "ALREADY_REGISTERED_IN_OTHER_PARK",
  "DUPLICATE",
  "INVALID_DOCUMENTS",
  "CLIENT_CHANGED_MIND",
  "OTHER",
] as const;
export const ANTIFRAUD_REASONS = ["REGISTRATION_TOO_FAST"] as const;
export const CANCEL_REASONS = ["EMPLOYEE_CANCELLED", "ADMIN_RELEASE"] as const;
export const BROADCAST_TARGET_TYPES = ["ALL_ACTIVE_USERS", "ACTIVE_EMPLOYEES", "ACTIVE_ADMINS"] as const;
export const BROADCAST_CONTENT_TYPES = ["TEXT", "PHOTO", "VIDEO", "DOCUMENT"] as const;
export const EXPORT_PERIOD_PRESETS = ["TODAY", "YESTERDAY", "THIS_MONTH", "LAST_MONTH", "ALL_TIME"] as const;
export const BROADCAST_STATUSES = [
  "DRAFT",
  "SENDING",
  "COMPLETED",
  "PARTIAL_FAILED",
  "CANCELLED",
  "FAILED",
] as const;
export const BROADCAST_DELIVERY_STATUSES = ["PENDING", "SENT", "FAILED", "SKIPPED"] as const;
export const USER_REGISTRATION_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const SESSION_STATES = [
  "IDLE",
  "CREATING_REGISTRATION_SELECT_SOURCE",
  "CREATING_REGISTRATION_ENTER_PHONE",
  "CREATING_REGISTRATION_CONFIRM_START",
  "ACTIVE_REGISTRATION_ACTIONS",
  "EMPLOYEE_SEARCH_ACTIVE_PHONE",
  "MARK_ERROR_SELECT_REASON",
  "MARK_ERROR_ENTER_COMMENT",
  "ADMIN_SEARCH_PHONE",
  "ADMIN_EXPORT_SELECT_PERIOD",
  "ADMIN_REPORT_SELECT_FILTERS",
  "ADMIN_RELEASE_ENTER_REASON",
  "ADMIN_BROADCAST_MENU",
  "ADMIN_BROADCAST_CHOOSE_TYPE",
  "ADMIN_BROADCAST_WAIT_TEXT",
  "ADMIN_BROADCAST_WAIT_PHOTO",
  "ADMIN_BROADCAST_WAIT_VIDEO",
  "ADMIN_BROADCAST_WAIT_DOCUMENT",
  "ADMIN_BROADCAST_WAIT_CAPTION",
  "ADMIN_BROADCAST_PREVIEW",
  "ADMIN_BROADCAST_CONFIRM_SEND",
  "ADMIN_BROADCAST_HISTORY",
  "ADMIN_BROADCAST_VIEW_DETAILS",
  "ADMIN_USER_MENU",
  "ADMIN_ADD_USER_TELEGRAM_ID",
  "ADMIN_ADD_USER_FULL_NAME",
  "ADMIN_ADD_USER_EMPLOYEE_CODE",
  "ADMIN_ADD_USER_ROLE",
  "ADMIN_ADD_USER_IS_ACTIVE",
  "ADMIN_ADD_USER_PREVIEW",
  "ADMIN_REGISTRATION_REQUESTS_LIST",
  "ADMIN_REGISTRATION_REQUEST_DETAIL",
  "ADMIN_REGISTRATION_APPROVE_ROLE",
  "ADMIN_REGISTRATION_APPROVE_EMPLOYEE_CODE",
  "ADMIN_REGISTRATION_APPROVE_CONFIRM",
  "ADMIN_REGISTRATION_REJECT_COMMENT",
  "GUEST_REGISTRATION_FULL_NAME",
  "GUEST_REGISTRATION_EMPLOYEE_CODE",
  "GUEST_REGISTRATION_PHONE",
  "GUEST_REGISTRATION_ROLE",
  "GUEST_REGISTRATION_COMMENT",
  "GUEST_REGISTRATION_PREVIEW",
  "GUEST_REGISTRATION_STATUS",
] as const;
export const AUDIT_ENTITY_TYPES = [
  "EMPLOYEE",
  "REGISTRATION",
  "SESSION",
  "REPORT",
  "BROADCAST",
  "USER_REGISTRATION_REQUEST",
  "SYSTEM",
] as const;

export type EmployeeRoleValue = (typeof EMPLOYEE_ROLES)[number];
export type RegistrationSourceValue = (typeof REGISTRATION_SOURCES)[number];
export type RegistrationStatusValue = (typeof REGISTRATION_STATUSES)[number];
export type RegistrationErrorReasonValue = (typeof REGISTRATION_ERROR_REASONS)[number];
export type AntifraudReasonValue = (typeof ANTIFRAUD_REASONS)[number];
export type CancelReasonValue = (typeof CANCEL_REASONS)[number];
export type BroadcastTargetTypeValue = (typeof BROADCAST_TARGET_TYPES)[number];
export type BroadcastContentTypeValue = (typeof BROADCAST_CONTENT_TYPES)[number];
export type ExportPeriodPresetValue = (typeof EXPORT_PERIOD_PRESETS)[number];
export type BroadcastStatusValue = (typeof BROADCAST_STATUSES)[number];
export type BroadcastDeliveryStatusValue = (typeof BROADCAST_DELIVERY_STATUSES)[number];
export type UserRegistrationRequestStatusValue = (typeof USER_REGISTRATION_REQUEST_STATUSES)[number];
export type SessionStateValue = (typeof SESSION_STATES)[number];
export type AuditEntityTypeValue = (typeof AUDIT_ENTITY_TYPES)[number];

export const SOURCE_LABELS: Record<RegistrationSourceValue, string> = {
  TELEGRAM: "Telegram",
  SITE: "Сайт",
  OFFLINE: "Оффлайн",
};

export const STATUS_LABELS: Record<RegistrationStatusValue, string> = {
  IN_PROGRESS: "В процессе",
  SUCCESS: "Успешно",
  ERROR: "Ошибка",
  CANCELLED: "Отменено",
};

export const ROLE_LABELS: Record<EmployeeRoleValue, string> = {
  EMPLOYEE: "Сотрудник",
  ADMIN: "Администратор",
  SUPERVISOR: "Супервайзер",
};

export const ERROR_REASON_LABELS: Record<RegistrationErrorReasonValue, string> = {
  ALREADY_REGISTERED_IN_OTHER_PARK: "Уже зарегистрирован в другом парке",
  DUPLICATE: "Дубликат",
  INVALID_DOCUMENTS: "Неверные документы",
  CLIENT_CHANGED_MIND: "Клиент передумал",
  OTHER: "Другое",
};

export const ANTIFRAUD_REASON_LABELS: Record<AntifraudReasonValue, string> = {
  REGISTRATION_TOO_FAST: "Регистрация подозрительно быстрая",
};

export const CANCEL_REASON_LABELS: Record<CancelReasonValue, string> = {
  EMPLOYEE_CANCELLED: "Отмена сотрудником",
  ADMIN_RELEASE: "Снято администратором",
};

export const BROADCAST_TARGET_LABELS: Record<BroadcastTargetTypeValue, string> = {
  ALL_ACTIVE_USERS: "Все активные пользователи",
  ACTIVE_EMPLOYEES: "Активные сотрудники",
  ACTIVE_ADMINS: "Активные админы",
};

export const BROADCAST_CONTENT_TYPE_LABELS: Record<BroadcastContentTypeValue, string> = {
  TEXT: "Текст",
  PHOTO: "Фото",
  VIDEO: "Видео",
  DOCUMENT: "Файл",
};

export const EXPORT_PERIOD_LABELS: Record<ExportPeriodPresetValue, string> = {
  TODAY: "Excel за сегодня",
  YESTERDAY: "Excel за вчера",
  THIS_MONTH: "Excel за этот месяц",
  LAST_MONTH: "Excel за прошлый месяц",
  ALL_TIME: "Excel за весь период",
};

export const BROADCAST_STATUS_LABELS: Record<BroadcastStatusValue, string> = {
  DRAFT: "Черновик",
  SENDING: "Отправка",
  COMPLETED: "Завершено",
  PARTIAL_FAILED: "Частично с ошибками",
  CANCELLED: "Отменено",
  FAILED: "Не удалось",
};

export const BROADCAST_DELIVERY_STATUS_LABELS: Record<BroadcastDeliveryStatusValue, string> = {
  PENDING: "В очереди",
  SENT: "Отправлено",
  FAILED: "Ошибка",
  SKIPPED: "Пропущено",
};

export const USER_REGISTRATION_REQUEST_STATUS_LABELS: Record<UserRegistrationRequestStatusValue, string> = {
  PENDING: "На рассмотрении",
  APPROVED: "Одобрена",
  REJECTED: "Отклонена",
  CANCELLED: "Отменена",
};

export const EMPLOYEE_MENU_LABELS = {
  NEW_REGISTRATION: "Новая регистрация",
  MY_REGISTRATIONS_TODAY: "Мои регистрации за сегодня",
  MY_ERRORS_TODAY: "Мои ошибки за сегодня",
  CANCEL_ACTIVE: "Отмена активной регистрации",
  SEARCH_ACTIVE: "Поиск по номеру",
  FINISH_REGISTRATION: "Завершить регистрацию",
  MARK_ERROR: "Ошибка регистрации",
  CANCEL_PROCESS: "Отменить процесс",
} as const;

export const ADMIN_MENU_LABELS = {
  REPORTS: "Отчеты",
  EXPORT: "Выгрузка Excel",
  BROADCAST: "Рассылка",
  ADD_USER: "Добавить пользователя",
  REGISTRATION_REQUESTS: "Заявки на регистрацию",
  EMPLOYEES: "Пользователи",
  STATISTICS: "Статистика",
  ANTIFRAUD: "Антифрод",
  SEARCH_PHONE: "Поиск по номеру",
  ACTIVE_REGISTRATIONS: "Активные регистрации",
  RELEASE_ACTIVE: "Снять активную регистрацию",
  MANAGE_EMPLOYEES: "Управление сотрудниками",
} as const;

export const GUEST_MENU_LABELS = {
  APPLY: "Подать заявку",
  CHECK_STATUS: "Проверить статус",
  CANCEL: "Отмена",
  SKIP: "Пропустить",
  BACK_TO_START: "К началу",
} as const;

export const BROADCAST_MENU_LABELS = {
  CREATE: "Создать новую рассылку",
  HISTORY: "История рассылок",
  CANCEL: "Отмена",
  SKIP_CAPTION: "Пропустить подпись",
} as const;

export const TELEGRAM_CALLBACKS = {
  SELECT_SOURCE: "SRC",
  CONFIRM_START: "START_OK",
  CANCEL_START: "START_CANCEL",
  ERROR_REASON: "ERR",
  REPORT: "REPORT",
  EXPORT: "EXPORT",
  BROADCAST_MENU: "BROADCAST_MENU",
  BROADCAST_TYPE: "BROADCAST_TYPE",
  BROADCAST_CONFIRM_SEND: "BROADCAST_SEND",
  BROADCAST_EDIT_TEXT: "BROADCAST_EDIT_TEXT",
  BROADCAST_EDIT_MEDIA: "BROADCAST_EDIT_MEDIA",
  BROADCAST_CANCEL: "BROADCAST_CANCEL",
  BROADCAST_HISTORY: "BROADCAST_HISTORY",
  BROADCAST_VIEW: "BROADCAST_VIEW",
  BROADCAST_REFRESH: "BROADCAST_REFRESH",
  BROADCAST_BACK: "BROADCAST_BACK",
  BROADCAST_SKIP_CAPTION: "BROADCAST_SKIP_CAPTION",
  EMPLOYEE_TOGGLE: "EMP_TOGGLE",
  EMPLOYEE_PAGE: "EMP_PAGE",
  RELEASE_SELECT: "REL_SELECT",
  MENU: "MENU",
  GUEST_REQUEST_MENU: "GUEST_REQUEST_MENU",
  GUEST_REQUEST_ROLE: "GUEST_REQUEST_ROLE",
  GUEST_REQUEST_SUBMIT: "GUEST_REQUEST_SUBMIT",
  GUEST_REQUEST_CANCEL: "GUEST_REQUEST_CANCEL",
  ADMIN_ADD_USER_ROLE: "ADMIN_ADD_USER_ROLE",
  ADMIN_ADD_USER_ACTIVE: "ADMIN_ADD_USER_ACTIVE",
  ADMIN_ADD_USER_SAVE: "ADMIN_ADD_USER_SAVE",
  ADMIN_ADD_USER_CANCEL: "ADMIN_ADD_USER_CANCEL",
  REGISTRATION_REQUEST_VIEW: "REG_REQUEST_VIEW",
  REGISTRATION_REQUEST_APPROVE: "REG_REQUEST_APPROVE",
  REGISTRATION_REQUEST_REJECT: "REG_REQUEST_REJECT",
  REGISTRATION_REQUEST_ROLE: "REG_REQUEST_ROLE",
  REGISTRATION_REQUEST_CONFIRM: "REG_REQUEST_CONFIRM",
  REGISTRATION_REQUEST_BACK: "REG_REQUEST_BACK",
  USER_MANAGEMENT_MENU: "USER_MGMT_MENU",
} as const;
