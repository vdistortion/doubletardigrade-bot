export function getMainMenu(
  isAdmin: boolean,
  hasTardigrades: boolean,
  hasQuestions: boolean,
  isQuizInProgress: boolean,
  isEnabled: boolean = true,
) {
  if (!isEnabled && !isAdmin) {
    return JSON.stringify({ one_time: false, buttons: [] });
  }

  const buttons = [];

  if (hasTardigrades) {
    buttons.push([
      {
        action: {
          type: 'text',
          label: '👾 Тихоходка дня',
          payload: JSON.stringify({ action: 'tardigrade_day' }),
        },
        color: 'primary',
      },
    ]);
  }

  if (hasQuestions) {
    const label = isQuizInProgress ? '🔬 Продолжить квиз' : '🔬 Квиз';
    buttons.push([
      {
        action: { type: 'text', label: label, payload: JSON.stringify({ action: 'quiz' }) },
        color: 'secondary',
      },
    ]);
  }

  if (isAdmin) {
    buttons.push([
      {
        action: {
          type: 'text',
          label: '⚙️ Админ-панель',
          payload: JSON.stringify({ action: 'admin_menu' }),
        },
        color: 'negative',
      },
    ]);
  }

  return JSON.stringify({ one_time: false, buttons });
}

export function getAdminMenu(hasQuestions: boolean, enableMessages: boolean, enableChats: boolean) {
  const buttons = [
    [
      {
        action: {
          type: 'text',
          label: '🔄 Синхронизация',
          payload: JSON.stringify({ action: 'sync_album' }),
        },
        color: 'primary',
      },
      {
        action: {
          type: 'text',
          label: '🧪 Тест выдачи',
          payload: JSON.stringify({ action: 'test_tardigrade' }),
        },
        color: 'secondary',
      },
    ],
  ];

  let modeStatusLabel = 'Режим: Выключен';
  let modeStatusColor: 'negative' | 'positive' | 'primary' = 'negative';

  if (enableMessages && enableChats) {
    modeStatusLabel = 'Режим: Сообщения и Чаты';
    modeStatusColor = 'positive';
  } else if (enableMessages) {
    modeStatusLabel = 'Режим: Только Сообщения';
    modeStatusColor = 'primary';
  } else if (enableChats) {
    modeStatusLabel = 'Режим: Только Чаты';
    modeStatusColor = 'primary';
  }

  buttons.push([
    {
      action: {
        type: 'text',
        label: modeStatusLabel,
        payload: JSON.stringify({ action: 'bot_mode_toggle_menu' }),
      },
      color: modeStatusColor,
    },
  ]);

  if (hasQuestions) {
    buttons.push([
      {
        action: {
          type: 'text',
          label: '🗑 Удалить все вопросы',
          payload: JSON.stringify({ action: 'quiz_clear' }),
        },
        color: 'negative',
      },
    ]);
  } else {
    buttons.push([
      {
        action: {
          type: 'text',
          label: '🧪 Инициализировать квиз',
          payload: JSON.stringify({ action: 'quiz_init' }),
        },
        color: 'positive',
      },
    ]);
  }

  const lastRow = [
    {
      action: {
        type: 'text',
        label: '❓ Команды',
        payload: JSON.stringify({ action: 'admin_help' }),
      },
      color: 'default',
    },
  ];

  if (enableMessages) {
    lastRow.push({
      action: { type: 'text', label: '◀️ Назад', payload: JSON.stringify({ action: 'back' }) },
      color: 'default',
    });
  }

  buttons.push(lastRow);
  return JSON.stringify({ one_time: false, buttons });
}

export function getBotModeToggleKeyboard(enableMessages: boolean, enableChats: boolean) {
  return JSON.stringify({
    inline: true,
    buttons: [
      [
        {
          action: {
            type: 'text',
            label: enableMessages ? '❌ Выключить для сообщений' : '✅ Включить для сообщений',
            payload: JSON.stringify({ action: 'toggle_mode_messages' }),
          },
          color: enableMessages ? 'negative' : 'positive',
        },
      ],
      [
        {
          action: {
            type: 'text',
            label: enableChats ? '❌ Выключить для чатов' : '✅ Включить для чатов',
            payload: JSON.stringify({ action: 'toggle_mode_chats' }),
          },
          color: enableChats ? 'negative' : 'positive',
        },
      ],
    ],
  });
}

export const quizRestartKeyboard = JSON.stringify({
  inline: true,
  buttons: [
    [
      {
        action: {
          type: 'text',
          label: '🔄 Пройти заново',
          payload: JSON.stringify({ action: 'quiz_reset' }),
        },
        color: 'positive',
      },
    ],
  ],
});
