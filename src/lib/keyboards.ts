import type { QuizQuestion } from './db.js';

export function generateShuffledQuestionKeyboard(question: QuizQuestion): string {
  const optionsWithFlag = question.options.map((text, idx) => ({
    text,
    isCorrect: idx === question.correct - 1, // correct — номер от 1
  }));

  // Алгоритм Фишера-Йетса
  for (let i = optionsWithFlag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [optionsWithFlag[i], optionsWithFlag[j]] = [optionsWithFlag[j], optionsWithFlag[i]];
  }

  return JSON.stringify({
    inline: true,
    buttons: optionsWithFlag.map((opt) => [
      {
        action: {
          type: 'text',
          label: opt.text.slice(0, 40),
          payload: JSON.stringify({
            action: 'quiz_ans',
            qid: question.id,
            isCorrect: opt.isCorrect,
          }),
        },
        color: 'primary',
      },
    ]),
  });
}

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

export function getAdminMenu(
  hasQuestions: boolean,
  enableMessages: boolean,
  enableChats: boolean,
  quizCsvUrl: string | null,
) {
  const buttons: any[] = [
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

  // Блок управления вопросами
  const questionButtons: any[] = [];

  // Кнопка "Загрузить демо" — только если вопросов нет
  if (!hasQuestions) {
    questionButtons.push({
      action: {
        type: 'text',
        label: '🧪 Загрузить демо‑вопросы',
        payload: JSON.stringify({ action: 'load_demo_questions' }),
      },
      color: 'positive',
    });
  }

  // Если есть сохранённый URL — кнопка "Обновить квиз"
  if (quizCsvUrl) {
    questionButtons.push({
      action: {
        type: 'text',
        label: '🔄 Обновить квиз',
        payload: JSON.stringify({ action: 'refresh_quiz' }),
      },
      color: 'primary',
    });
  }

  if (questionButtons.length > 0) {
    buttons.push(questionButtons);
  }

  // Режим работы (как раньше)
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

  const lastRow: any[] = [
    {
      action: {
        type: 'text',
        label: '❓ Справка',
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
