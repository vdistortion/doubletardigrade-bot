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

/**
 * Главное меню
 * @param isAdmin админ в ЛС
 * @param hasTardigrades есть тихоходки
 * @param hasQuestions есть вопросы квиза
 * @param isQuizInProgress квиз начат
 * @param isChat чат (true) или ЛС (false)
 */
export function getMainMenu(
  isAdmin: boolean,
  hasTardigrades: boolean,
  hasQuestions: boolean,
  isQuizInProgress: boolean,
  isChat: boolean,
): string {
  const buttons: any[] = [];

  // Верхний ряд: только для админов в ЛС — кнопка админ-панели
  if (isAdmin && !isChat) {
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

  // Нижний ряд: основные кнопки (Тихоходка и Квиз)
  const mainRow: any[] = [];
  if (hasTardigrades) {
    mainRow.push({
      action: {
        type: 'text',
        label: '👾 Тихоходка дня',
        payload: JSON.stringify({ action: 'tardigrade_day' }),
      },
      color: 'primary',
    });
  }
  if (hasQuestions) {
    mainRow.push({
      action: {
        type: 'text',
        label: isQuizInProgress ? '🔬 Продолжить квиз' : '🔬 Квиз',
        payload: JSON.stringify({ action: 'quiz' }),
      },
      color: 'secondary',
    });
  }
  if (mainRow.length > 0) {
    buttons.push(mainRow);
  }

  return JSON.stringify(isChat ? { inline: true, buttons } : { one_time: false, buttons });
}

/**
 * Админ-панель
 */
export function getAdminMenu(
  hasQuestions: boolean,
  enableMessages: boolean,
  enableChats: boolean,
  quizCsvUrl: string | null,
): string {
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
  if (questionButtons.length > 0) buttons.push(questionButtons);

  // Режим работы
  let modeLabel = 'Режим: Выключен';
  let modeColor: 'negative' | 'positive' | 'primary' = 'negative';
  if (enableMessages && enableChats) {
    modeLabel = 'Режим: Сообщения и Чаты';
    modeColor = 'positive';
  } else if (enableMessages) {
    modeLabel = 'Режим: Только Сообщения';
    modeColor = 'primary';
  } else if (enableChats) {
    modeLabel = 'Режим: Только Чаты';
    modeColor = 'primary';
  }

  buttons.push([
    {
      action: {
        type: 'text',
        label: modeLabel,
        payload: JSON.stringify({ action: 'bot_mode_toggle_menu' }),
      },
      color: modeColor,
    },
  ]);

  // Справка
  buttons.push([
    {
      action: {
        type: 'text',
        label: '❓ Справка',
        payload: JSON.stringify({ action: 'admin_help' }),
      },
      color: 'default',
    },
  ]);

  return JSON.stringify({ inline: true, buttons });
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
          label: '👾 Тихоходка дня',
          payload: JSON.stringify({ action: 'tardigrade_day' }),
        },
        color: 'primary',
      },
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
