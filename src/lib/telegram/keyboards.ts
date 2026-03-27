import { EmployeeRole } from "@prisma/client";

import {
  ADMIN_MENU_LABELS,
  BROADCAST_CONTENT_TYPE_LABELS,
  BROADCAST_MENU_LABELS,
  EMPLOYEE_MENU_LABELS,
  ERROR_REASON_LABELS,
  REGISTRATION_ERROR_REASONS,
  REGISTRATION_SOURCES,
  SOURCE_LABELS,
  TELEGRAM_CALLBACKS,
  type BroadcastContentTypeValue,
} from "../../domain/constants";
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup } from "./types";

export function buildMainMenu(role: EmployeeRole, hasActiveRegistration: boolean): ReplyKeyboardMarkup {
  if (role === EmployeeRole.ADMIN) {
    return {
      resize_keyboard: true,
      keyboard: [
        [{ text: ADMIN_MENU_LABELS.REPORTS }, { text: ADMIN_MENU_LABELS.EXPORT }],
        [{ text: ADMIN_MENU_LABELS.BROADCAST }, { text: ADMIN_MENU_LABELS.STATISTICS }],
        [{ text: ADMIN_MENU_LABELS.ANTIFRAUD }, { text: ADMIN_MENU_LABELS.SEARCH_PHONE }],
        [{ text: ADMIN_MENU_LABELS.ACTIVE_REGISTRATIONS }, { text: ADMIN_MENU_LABELS.RELEASE_ACTIVE }],
        [{ text: ADMIN_MENU_LABELS.EMPLOYEES }, { text: ADMIN_MENU_LABELS.MANAGE_EMPLOYEES }],
      ],
    };
  }

  if (role === EmployeeRole.SUPERVISOR) {
    return {
      resize_keyboard: true,
      keyboard: [[{ text: ADMIN_MENU_LABELS.REPORTS }, { text: ADMIN_MENU_LABELS.STATISTICS }]],
    };
  }

  const keyboard: Array<Array<{ text: string }>> = [
    [{ text: EMPLOYEE_MENU_LABELS.NEW_REGISTRATION }, { text: EMPLOYEE_MENU_LABELS.MY_REGISTRATIONS_TODAY }],
    [{ text: EMPLOYEE_MENU_LABELS.MY_ERRORS_TODAY }, { text: EMPLOYEE_MENU_LABELS.CANCEL_ACTIVE }],
  ];

  if (hasActiveRegistration) {
    keyboard.push(
      [{ text: EMPLOYEE_MENU_LABELS.SEARCH_ACTIVE }, { text: EMPLOYEE_MENU_LABELS.FINISH_REGISTRATION }],
      [{ text: EMPLOYEE_MENU_LABELS.MARK_ERROR }, { text: EMPLOYEE_MENU_LABELS.CANCEL_PROCESS }],
    );
  }

  return {
    resize_keyboard: true,
    keyboard,
  };
}

export function buildSourceSelectionKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: REGISTRATION_SOURCES.map((source) => [
      {
        text: SOURCE_LABELS[source],
        callback_data: `${TELEGRAM_CALLBACKS.SELECT_SOURCE}:${source}`,
      },
    ]),
  };
}

export function buildStartConfirmationKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "Подтвердить", callback_data: TELEGRAM_CALLBACKS.CONFIRM_START },
      { text: "Отменить", callback_data: TELEGRAM_CALLBACKS.CANCEL_START },
    ]],
  };
}

export function buildErrorReasonKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: REGISTRATION_ERROR_REASONS.map((reason) => [
      {
        text: ERROR_REASON_LABELS[reason],
        callback_data: `${TELEGRAM_CALLBACKS.ERROR_REASON}:${reason}`,
      },
    ]),
  };
}

export function buildAdminReportKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "За сегодня", callback_data: `${TELEGRAM_CALLBACKS.REPORT}:TODAY` },
        { text: "За вчера", callback_data: `${TELEGRAM_CALLBACKS.REPORT}:YESTERDAY` },
      ],
      [
        { text: "Активные", callback_data: `${TELEGRAM_CALLBACKS.REPORT}:ACTIVE` },
        { text: "Антифрод", callback_data: `${TELEGRAM_CALLBACKS.REPORT}:ANTIFRAUD` },
      ],
    ],
  };
}

export function buildAdminExportKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "Excel за сегодня", callback_data: `${TELEGRAM_CALLBACKS.EXPORT}:TODAY` },
      { text: "Excel за вчера", callback_data: `${TELEGRAM_CALLBACKS.EXPORT}:YESTERDAY` },
    ]],
  };
}

export function buildEmployeeToggleKeyboard(employeeId: string, isActive: boolean): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      {
        text: isActive ? "Деактивировать" : "Активировать",
        callback_data: `${TELEGRAM_CALLBACKS.EMPLOYEE_TOGGLE}:${employeeId}`,
      },
    ]],
  };
}

export function buildReleaseKeyboard(registrationId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      {
        text: "Снять регистрацию",
        callback_data: `${TELEGRAM_CALLBACKS.RELEASE_SELECT}:${registrationId}`,
      },
    ]],
  };
}

export function buildBroadcastMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: BROADCAST_MENU_LABELS.CREATE, callback_data: `${TELEGRAM_CALLBACKS.BROADCAST_MENU}:CREATE` }],
      [{ text: BROADCAST_MENU_LABELS.HISTORY, callback_data: `${TELEGRAM_CALLBACKS.BROADCAST_MENU}:HISTORY` }],
      [{ text: BROADCAST_MENU_LABELS.CANCEL, callback_data: `${TELEGRAM_CALLBACKS.BROADCAST_MENU}:CANCEL` }],
    ],
  };
}

export function buildBroadcastContentTypeKeyboard(): InlineKeyboardMarkup {
  const rows = (["TEXT", "PHOTO", "VIDEO", "DOCUMENT"] as BroadcastContentTypeValue[]).map((type) => [
    {
      text: BROADCAST_CONTENT_TYPE_LABELS[type],
      callback_data: `${TELEGRAM_CALLBACKS.BROADCAST_TYPE}:${type}`,
    },
  ]);

  rows.push([{ text: "Отмена", callback_data: TELEGRAM_CALLBACKS.BROADCAST_CANCEL }]);

  return {
    inline_keyboard: rows,
  };
}

export function buildBroadcastSkipCaptionKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      {
        text: BROADCAST_MENU_LABELS.SKIP_CAPTION,
        callback_data: TELEGRAM_CALLBACKS.BROADCAST_SKIP_CAPTION,
      },
    ]],
  };
}

export function buildBroadcastPreviewKeyboard(
  contentType: BroadcastContentTypeValue,
  allowEditMedia: boolean,
): InlineKeyboardMarkup {
  const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "Подтвердить отправку", callback_data: TELEGRAM_CALLBACKS.BROADCAST_CONFIRM_SEND }],
    [{ text: contentType === "TEXT" ? "Изменить текст" : "Изменить текст/подпись", callback_data: TELEGRAM_CALLBACKS.BROADCAST_EDIT_TEXT }],
    [{ text: "Отмена", callback_data: TELEGRAM_CALLBACKS.BROADCAST_CANCEL }],
  ];

  if (allowEditMedia) {
    inlineKeyboard.splice(2, 0, [{ text: "Изменить вложение", callback_data: TELEGRAM_CALLBACKS.BROADCAST_EDIT_MEDIA }]);
  }

  return {
    inline_keyboard: inlineKeyboard,
  };
}

export function buildBroadcastHistoryKeyboard(broadcastIds: string[]): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...broadcastIds.map((broadcastId) => [
        {
          text: `Рассылка ${broadcastId.slice(0, 8)}`,
          callback_data: `${TELEGRAM_CALLBACKS.BROADCAST_VIEW}:${broadcastId}`,
        },
      ]),
      [{ text: "Назад", callback_data: TELEGRAM_CALLBACKS.BROADCAST_BACK }],
    ],
  };
}

export function buildBroadcastDetailsKeyboard(broadcastId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "Обновить", callback_data: `${TELEGRAM_CALLBACKS.BROADCAST_REFRESH}:${broadcastId}` }],
      [{ text: "Назад", callback_data: `${TELEGRAM_CALLBACKS.BROADCAST_HISTORY}:LIST` }],
    ],
  };
}

export function buildBroadcastResultKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "История рассылок", callback_data: `${TELEGRAM_CALLBACKS.BROADCAST_HISTORY}:LIST` }],
      [{ text: "Назад в меню", callback_data: TELEGRAM_CALLBACKS.BROADCAST_BACK }],
    ],
  };
}
