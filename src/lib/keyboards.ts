import type { QuizQuestion } from './db.js';
import { messages } from './messages.js';

const digitEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export function generateQuestionMessageAndKeyboard(
  question: QuizQuestion,
  ownerId: number,
): {
  message: string;
  keyboard: string;
} {
  const optionsWithFlag = question.options.map((text, idx) => ({
    text,
    isCorrect: idx === question.correct - 1, // correct — номер от 1
  }));

  // Перемешивание Фишера-Йетса
  for (let i = optionsWithFlag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [optionsWithFlag[i], optionsWithFlag[j]] = [optionsWithFlag[j], optionsWithFlag[i]];
  }

  let optionsText = '';
  const flatButtons: any[] = [];
  for (let i = 0; i < optionsWithFlag.length; i++) {
    const opt = optionsWithFlag[i];
    const digit = i < digitEmojis.length ? digitEmojis[i] : `${i + 1}`;
    optionsText += `${digit} ${opt.text}\n`;

    flatButtons.push({
      action: {
        type: 'callback',
        label: digit,
        payload: JSON.stringify({
          action: 'quiz_ans',
          qid: question.id,
          isCorrect: opt.isCorrect,
          uid: ownerId,
        }),
      },
      color: 'primary',
    });
  }

  // Группируем по 4 кнопки в ряд
  const buttonRows: any[] = [];
  for (let i = 0; i < flatButtons.length; i += 4) {
    buttonRows.push(flatButtons.slice(i, i + 4));
  }

  const message = `❓ ${question.question}\n\n${optionsText.trim()}`;
  const keyboard = JSON.stringify({ inline: true, buttons: buttonRows });
  return { message, keyboard };
}

/**
 * Главное меню
 * @param hasTardigrades есть тихоходки
 * @param hasQuestions есть вопросы квиза
 * @param isQuizInProgress квиз начат
 */
export function getMainMenu(
  hasTardigrades: boolean,
  hasQuestions: boolean,
  isQuizInProgress: boolean,
): string {
  const buttons: any[] = [];
  const mainRow: any[] = [];

  if (hasTardigrades) {
    mainRow.push({
      action: {
        type: 'callback',
        label: messages.buttons.tardigradeDay,
        payload: JSON.stringify({ action: 'tardigrade_day' }),
      },
      color: 'primary',
    });
  }
  if (hasQuestions) {
    mainRow.push({
      action: {
        type: 'callback',
        label: isQuizInProgress ? messages.buttons.continueQuiz : messages.buttons.quiz,
        payload: JSON.stringify({ action: 'quiz' }),
      },
      color: 'secondary',
    });
  }
  if (mainRow.length > 0) {
    buttons.push(mainRow);
  }

  return JSON.stringify({ inline: true, buttons });
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
          type: 'callback',
          label: messages.buttons.sync,
          payload: JSON.stringify({ action: 'sync_album' }),
        },
        color: 'primary',
      },
      {
        action: {
          type: 'callback',
          label: messages.buttons.testTardigrade,
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
        type: 'callback',
        label: messages.buttons.loadDemoQuestions,
        payload: JSON.stringify({ action: 'load_demo_questions' }),
      },
      color: 'positive',
    });
  }

  // Если есть сохранённый URL — кнопка "Обновить квиз"
  if (quizCsvUrl) {
    questionButtons.push({
      action: {
        type: 'callback',
        label: messages.buttons.refreshQuiz,
        payload: JSON.stringify({ action: 'refresh_quiz' }),
      },
      color: 'primary',
    });
  }
  if (questionButtons.length > 0) buttons.push(questionButtons);

  // Режим работы
  let modeLabel = messages.buttons.modeDisabled;
  let modeColor: 'negative' | 'positive' | 'primary' = 'negative';
  if (enableMessages && enableChats) {
    modeLabel = messages.buttons.modeMessagesAndChats;
    modeColor = 'positive';
  } else if (enableMessages) {
    modeLabel = messages.buttons.modeMessagesOnly;
    modeColor = 'primary';
  } else if (enableChats) {
    modeLabel = messages.buttons.modeChatsOnly;
    modeColor = 'primary';
  }

  buttons.push([
    {
      action: {
        type: 'callback',
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
        type: 'callback',
        label: messages.buttons.help,
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
            type: 'callback',
            label: enableMessages
              ? messages.buttons.disableMessages
              : messages.buttons.enableMessages,
            payload: JSON.stringify({ action: 'toggle_mode_messages' }),
          },
          color: enableMessages ? 'negative' : 'positive',
        },
      ],
      [
        {
          action: {
            type: 'callback',
            label: enableChats ? messages.buttons.disableChats : messages.buttons.enableChats,
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
          type: 'callback',
          label: messages.buttons.tardigradeDay,
          payload: JSON.stringify({ action: 'tardigrade_day' }),
        },
        color: 'primary',
      },
      {
        action: {
          type: 'callback',
          label: messages.buttons.quiz,
          payload: JSON.stringify({ action: 'quiz_reset' }),
        },
        color: 'secondary',
      },
    ],
  ],
});
