import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API, Upload, Updates, MessageContext } from 'vk-io';
import {
  getTodayTardigrade,
  syncAlbum,
  getQuizCsvUrl,
  setQuizCsvUrl,
  importQuestionsFromCsv,
  getUnansweredQuestion,
  saveQuizAnswer,
  getQuizStats,
  resetQuiz,
  getTardigrades,
  getQuestions,
  getBotSettings,
  setBotSetting,
  getAlbumId,
  setAlbumId,
  setActiveMessage,
  getActiveMessage,
  clearActiveMessage,
  isQuestionAnswered,
} from './lib/db.js';
import { isUserAdmin } from './lib/admin.js';
import {
  generateQuestionMessageAndKeyboard,
  getAdminMenu,
  getBotModeToggleKeyboard,
  getMainMenu,
  quizRestartKeyboard,
} from './lib/keyboards.js';

const BOT_ICON = '👾';

const GROUP_TOKEN = process.env.GROUP_TOKEN;
if (!GROUP_TOKEN) {
  throw new Error('Критическая ошибка: Переменная GROUP_TOKEN не найдена!');
}

const USER_TOKEN = process.env.USER_TOKEN;
if (!USER_TOKEN) {
  throw new Error('Критическая ошибка: Переменная USER_TOKEN не найдена!');
}

const ADMIN_ID_ENV = process.env.SUPER_ADMINS || '';
const SUPER_ADMINS = ADMIN_ID_ENV.split(',')
  .map((id) => parseInt(id.trim(), 10))
  .filter((id) => !isNaN(id));

function isPeerChat(peerId: number): boolean {
  return peerId >= 2000000000;
}

function randomId(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function getCmidFromResponse(sent: unknown): number | null {
  const first = Array.isArray(sent) ? (sent[0] as Record<string, unknown> | undefined) : undefined;
  const cmid = first?.conversation_message_id;
  return typeof cmid === 'number' && cmid > 0 ? cmid : null;
}

function parsePayload(rawPayload: unknown): Record<string, any> | undefined {
  if (!rawPayload) return undefined;

  if (typeof rawPayload === 'string') {
    try {
      const parsed = JSON.parse(rawPayload);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch (error) {
      console.error('Ошибка парсинга payload:', error);
      return undefined;
    }
  }

  if (typeof rawPayload === 'object') {
    return rawPayload as Record<string, any>;
  }

  return undefined;
}

async function sendMenu(
  peerId: number,
  userId: number,
  message: string,
  keyboard: string,
  options: Record<string, any> = {},
): Promise<void> {
  const sent = await api.messages.send({
    peer_ids: [peerId],
    random_id: randomId(),
    message,
    keyboard,
    ...options,
  });

  console.log('SENT RAW:', JSON.stringify(sent));

  const cmid = getCmidFromResponse(sent);

  if (cmid) {
    await setActiveMessage(String(userId), String(peerId), cmid);
  } else {
    console.error('Не удалось получить cmid:', sent);
  }
}

async function sendMainMenu(
  context: MessageContext,
  hasTardigrades: boolean,
  hasQuestions: boolean,
  isQuizInProgress: boolean,
): Promise<void> {
  if (!context.isChat) {
    await context.send('⌨️', {
      keyboard: JSON.stringify({ buttons: [], one_time: true }),
    });
  }

  await sendMenu(
    context.peerId,
    context.senderId,
    `${BOT_ICON} Главное меню:`,
    getMainMenu(hasTardigrades, hasQuestions, isQuizInProgress),
  );
}

async function checkAdmin(userId: number): Promise<boolean> {
  return SUPER_ADMINS.includes(userId) || (await isUserAdmin(userId, api, GROUP_ID));
}

export const api = new API({ token: GROUP_TOKEN });
export const userApi = new API({ token: USER_TOKEN });
const upload = new Upload({ api });
export const updates = new Updates({ api, upload });

const response = await api.groups.getById({});
const groupInfo = response.groups[0];
const GROUP_ID = groupInfo.id;

if (!GROUP_ID) {
  throw new Error('Критическая ошибка: Переменная GROUP_ID не найдена или не является числом!');
}

let currentAlbumId: number | null = null;

// Асинхронно подгружаем сохранённый альбом из БД
getAlbumId()
  .then((id) => {
    if (id) currentAlbumId = id;
  })
  .catch((e) => console.error('Не удалось загрузить album_id из БД:', e));

async function fetchGoogleSheetCsv(url: string): Promise<string> {
  let exportUrl = url.trim();
  // Если ссылка уже явно ведёт на CSV (содержит output=csv или format=csv), оставляем как есть
  if (exportUrl.includes('output=csv') || exportUrl.includes('format=csv')) {
    // Уже CSV.
  } else if (exportUrl.includes('/pub?')) {
    exportUrl = exportUrl.replace(/\?.*$/, '') + '?output=csv';
  } else {
    exportUrl =
      exportUrl.split('?')[0].replace(/\/(edit|htmlview|view)(\?.*)?$/, '') + '/export?format=csv';
  }

  const response = await fetch(exportUrl);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();

  if (!text.trim()) {
    throw new Error('Получен пустой CSV');
  }

  return text;
}

async function sendEventMessage(
  peerId: number,
  message: string,
  options: Record<string, any> = {},
): Promise<any> {
  return api.messages.send({
    peer_id: peerId,
    random_id: randomId(),
    message,
    ...options,
  });
}

async function sendAdminMenu(
  send: (message: string, options?: Record<string, any>) => Promise<any>,
  questions: any[],
  enableMessages: boolean,
  enableChats: boolean,
  quizCsvUrl: string | null,
): Promise<any> {
  return send(`${BOT_ICON} Админ-панель:`, {
    keyboard: getAdminMenu(questions.length > 0, enableMessages, enableChats, quizCsvUrl),
  });
}

async function handleAdminAction(
  action: string,
  peerId: number,
  userId: number,
  settings: { enable_messages: boolean; enable_chats: boolean },
): Promise<boolean> {
  const send = (message: string, options: Record<string, any> = {}) =>
    sendEventMessage(peerId, message, options);
  const { enable_messages, enable_chats } = settings;

  const questions = await getQuestions();
  const quizCsvUrl = await getQuizCsvUrl();

  if (action === 'admin_help') {
    const helpText = [
      '📖 Справка',
      '',
      'Команды:',
      '/start – открыть главное меню',
      '/admin – открыть админ-панель (только для администраторов в личных сообщениях).',
      '',
      'Загрузка тихоходок дня:',
      '– Кнопка «🔄 Синхронизация» загружает фото и подписи из указанного альбома ВК в базу тихоходок.',
      '– Чтобы сменить альбом, отправьте ссылку на альбом группы.',
      '– Для обновления нажмите «Синхронизация» повторно — старые данные заменятся новыми.',
      '',
      'Импорт вопросов квиза:',
      '– Отправьте боту ссылку на опубликованную Google Таблицу для автоматической загрузки вопросов.',
      '– После успешного импорта ссылка сохранится, и появится кнопка «🔄 Обновить квиз».',
      '– Формат ячеек: Вопрос, НомерПравильногоОтвета, Вариант1, Вариант2...',
      '– Если квиз пуст, используйте кнопку «🧪 Загрузить демо-вопросы».',
      '',
      '🌐 Исходный код: https://github.com/vdistortion/doubletardigrade-bot',
    ].join('\n');

    await send(helpText);
    return true;
  }

  if (action === 'bot_mode_toggle_menu') {
    await send(`${BOT_ICON} Управление режимом бота:`, {
      keyboard: getBotModeToggleKeyboard(enable_messages, enable_chats),
    });

    return true;
  }

  if (action === 'toggle_mode_messages') {
    await setBotSetting('enable_messages', !enable_messages);

    const updatedSettings = await getBotSettings();

    await send(
      `✅ Режим для сообщений ${updatedSettings.enable_messages ? 'включен' : 'выключен'}.`,
    );

    return true;
  }

  if (action === 'toggle_mode_chats') {
    await setBotSetting('enable_chats', !enable_chats);

    const updatedSettings = await getBotSettings();

    await send(`✅ Режим для чатов ${updatedSettings.enable_chats ? 'включен' : 'выключен'}.`);

    return true;
  }

  if (action === 'sync_album') {
    if (!currentAlbumId) {
      await send('❌ Альбом не задан. Отправьте ссылку на альбом.');
      return true;
    }

    try {
      const count = await syncAlbum(GROUP_ID, currentAlbumId, userApi);

      const [updatedTardigrades, updatedQuestions] = await Promise.all([
        getTardigrades(),
        getQuestions(),
      ]);

      await send(`✅ Синхронизация завершена! Объектов: ${count}`);

      await sendMenu(
        peerId,
        userId,
        `${BOT_ICON} Главное меню:`,
        getMainMenu(updatedTardigrades.length > 0, updatedQuestions.length > 0, false),
      );
    } catch (error: any) {
      console.error('Ошибка при синхронизации альбома:', error);

      let errorMessage =
        '‼ Не удалось синхронизировать альбом. Пожалуйста, проверьте настройки группы и альбома.';

      if (error.code === 15 || error.code === 200) {
        errorMessage =
          '‼ Не удалось синхронизировать альбом. Убедитесь, что сообщество открыто, и повторите попытку.';
      }

      await send(errorMessage);
    }

    return true;
  }

  if (action === 'test_tardigrade') {
    const tardigrades = await getTardigrades();

    if (!tardigrades.length) {
      await send('❌ Пусто.');
      return true;
    }

    const rand = tardigrades[Math.floor(Math.random() * tardigrades.length)];

    await send(`🧪 Тест:\n\n${rand.text}`, {
      attachment: rand.image || undefined,
    });

    return true;
  }

  if (action === 'load_demo_questions') {
    try {
      const filePath = join(process.cwd(), 'demo_questions.csv');

      const csvText = await readFile(filePath, {
        encoding: 'utf-8',
      });

      const count = await importQuestionsFromCsv(csvText);

      await send(`✅ Загружено ${count} демо-вопросов.`);

      const [updatedTardigrades, updatedQuestions] = await Promise.all([
        getTardigrades(),
        getQuestions(),
      ]);

      await send(`${BOT_ICON} Админ-панель:`, {
        keyboard: getAdminMenu(
          updatedQuestions.length > 0,
          enable_messages,
          enable_chats,
          quizCsvUrl,
        ),
      });
    } catch (error: any) {
      await send(`❌ Ошибка загрузки демо: ${error.message}`);
    }

    return true;
  }

  if (action === 'refresh_quiz') {
    const url = await getQuizCsvUrl();

    if (!url) {
      await send('❌ Нет сохранённой ссылки.');
      return true;
    }

    try {
      const csvText = await fetchGoogleSheetCsv(url);
      const count = await importQuestionsFromCsv(csvText);

      await send(`✅ Квиз обновлён из таблицы. Загружено ${count} вопросов.`);

      const updatedQuestions = await getQuestions();

      await send(`${BOT_ICON} Админ-панель:`, {
        keyboard: getAdminMenu(updatedQuestions.length > 0, enable_messages, enable_chats, url),
      });
    } catch (error: any) {
      await send(`❌ Не удалось обновить квиз: ${error.message}`);
    }

    return true;
  }

  // Обработка ссылки на альбом выполняется отдельно,
  // потому что это обычное сообщение, а не callback.
  void userId;
  void questions;

  return false;
}

updates.on('message_new', async (context: MessageContext) => {
  if (!context.isUser) return;

  const userId = context.senderId;
  const payload = context.messagePayload;
  const rawText = context.text?.trim() ?? '';
  const command = rawText.toLowerCase();
  const inChat = context.isChat;

  const isAdmin = await checkAdmin(userId);
  const botSettings = await getBotSettings();
  const { enable_messages, enable_chats } = botSettings;

  const payloadObject = parsePayload(payload);
  const action = typeof payloadObject?.action === 'string' ? payloadObject.action : undefined;

  try {
    // ─────────────────────────────────────────────────────────────
    // АДМИН-ПАНЕЛЬ
    // ─────────────────────────────────────────────────────────────

    if (isAdmin && !inChat) {
      const questions = await getQuestions();
      const quizCsvUrl = await getQuizCsvUrl();

      // /admin всегда открывает админ-панель.
      // Даже если бот ещё пустой — иначе невозможно его настроить.
      if (command === '/admin') {
        return sendAdminMenu(
          context.send.bind(context),
          questions,
          enable_messages,
          enable_chats,
          quizCsvUrl,
        );
      }

      // Все callback-действия админки.
      if (
        action &&
        [
          'admin_help',
          'bot_mode_toggle_menu',
          'toggle_mode_messages',
          'toggle_mode_chats',
          'sync_album',
          'test_tardigrade',
          'load_demo_questions',
          'refresh_quiz',
        ].includes(action)
      ) {
        const handled = await handleAdminAction(action, context.peerId, userId, botSettings);

        if (handled) return;
      }

      // Ссылка на альбом VK.
      const albumRegex = /album-(\d+)_(\d+)/;
      const albumMatch = rawText.match(albumRegex);

      if (albumMatch) {
        const ownerId = parseInt(albumMatch[1], 10);
        const albumId = parseInt(albumMatch[2], 10);

        if (Math.abs(ownerId) === GROUP_ID) {
          currentAlbumId = albumId;

          try {
            await setAlbumId(albumId);

            const count = await syncAlbum(GROUP_ID, albumId, userApi);

            const [updatedTardigrades, updatedQuestions] = await Promise.all([
              getTardigrades(),
              getQuestions(),
            ]);

            await context.send(`✅ Альбом обновлён и синхронизирован. Объектов: ${count}`);

            return sendAdminMenu(
              context.send.bind(context),
              updatedQuestions,
              enable_messages,
              enable_chats,
              quizCsvUrl,
            );
          } catch (error: any) {
            return context.send(
              `❌ Альбом сохранён, но синхронизация не удалась: ${error.message}`,
            );
          }
        }

        return context.send('❌ Альбом не принадлежит этому сообществу.');
      }

      // Импорт вопросов из Google Таблицы.
      const urlRegex = /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

      const match = rawText.match(urlRegex);

      if (match) {
        const url = match[0];

        try {
          const csvText = await fetchGoogleSheetCsv(url);
          const count = await importQuestionsFromCsv(csvText);

          await setQuizCsvUrl(url);

          const updatedQuestions = await getQuestions();

          await context.send(
            `✅ Импортировано ${count} вопросов из Google Таблицы. Ссылка сохранена для автообновления.`,
          );

          return sendAdminMenu(
            context.send.bind(context),
            updatedQuestions,
            enable_messages,
            enable_chats,
            url,
          );
        } catch (error: any) {
          return context.send(`❌ Не удалось загрузить таблицу: ${error.message}`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // ПРОВЕРКА РЕЖИМА РАБОТЫ БОТА
    // ─────────────────────────────────────────────────────────────

    const isEnabledForCurrentContext = (enable_messages && !inChat) || (enable_chats && inChat);

    if (!isEnabledForCurrentContext) {
      return;
    }

    // ─────────────────────────────────────────────────────────────
    // ПОЛЬЗОВАТЕЛЬСКОЕ МЕНЮ
    // ─────────────────────────────────────────────────────────────

    const [tardigrades, questions, stats] = await Promise.all([
      getTardigrades(),
      getQuestions(),
      getQuizStats(String(userId)),
    ]);

    const hasTardigrades = tardigrades.length > 0;

    const hasQuestions = questions.length > 0;

    const hasContent = hasTardigrades || hasQuestions;

    // /start — всегда обычное меню.
    // Если контента нет — сообщаем, что бот не настроен.
    if (command === '/start' || command === 'начать' || action === 'start') {
      if (!hasContent) {
        return context.send('⚠️ Бот ещё не настроен.');
      }

      const isQuizInProgress = stats.answered > 0 && stats.answered < stats.total;

      return sendMainMenu(context, hasTardigrades, hasQuestions, isQuizInProgress);
    }

    if (!hasContent) {
      return;
    }

    const isQuizInProgress = stats.answered > 0 && stats.answered < stats.total;

    const mainMenuKeyboard = getMainMenu(hasTardigrades, hasQuestions, isQuizInProgress);

    // ─────────────────────────────────────────────────────────────
    // ТИХОХОДКА ДНЯ
    // ─────────────────────────────────────────────────────────────

    if (action === 'tardigrade_day') {
      const { tardigrade, isNew } = await getTodayTardigrade(String(userId));

      const prefix = isNew
        ? '🎉 Найдена новая тихоходка дня!'
        : '📖 Эта тихоходка уже была найдена:';

      return context.send(
        `${BOT_ICON} ${prefix}\n\n✨ ${tardigrade.text}\n\n🔬 ${tardigrade.description || ''}`,
        {
          attachment: tardigrade.image || undefined,
          keyboard: mainMenuKeyboard,
        },
      );
    }

    // ─────────────────────────────────────────────────────────────
    // КВИЗ
    // ─────────────────────────────────────────────────────────────

    if (action === 'quiz') {
      const peerId = String(context.peerId);
      const userIdStr = String(userId);

      const oldCmid = await getActiveMessage(userIdStr, peerId);

      if (oldCmid) {
        try {
          await api.messages.delete({
            peer_id: Number(peerId),
            cmids: [oldCmid],
            delete_for_all: 1,
          });
        } catch {
          // Старое сообщение могло уже быть удалено.
        }
      }

      const question = await getUnansweredQuestion(userIdStr);

      if (!question) {
        let resultMsg =
          `${BOT_ICON} Все доступные вопросы пройдены!\n` +
          `📈 Результат: ${stats.correct} из ${stats.total}\n\n`;

        if (stats.percent === 100) {
          resultMsg += '🏆 Невероятно! Это абсолютный успех!';
        } else if (stats.percent === 0) {
          resultMsg += '🌊 Тихоходки сегодня оказались хитрее. Попробуем еще раз?';
        } else {
          resultMsg += 'Хороший результат!';
        }

        return context.send(resultMsg, {
          keyboard: quizRestartKeyboard,
        });
      }

      const { message, keyboard } = generateQuestionMessageAndKeyboard(question);

      const sent = await context.send(message, { keyboard });

      const msgId = getCmidFromResponse(sent);

      if (typeof msgId === 'number' && msgId > 0) {
        await setActiveMessage(userIdStr, peerId, msgId);
      } else {
        console.error('Не удалось получить ID сообщения для квиза');
      }

      return;
    }

    // ─────────────────────────────────────────────────────────────
    // СБРОС КВИЗА
    // ─────────────────────────────────────────────────────────────

    if (action === 'quiz_reset') {
      const peerId = String(context.peerId);

      const userIdStr = String(userId);

      const oldCmid = await getActiveMessage(userIdStr, peerId);

      if (oldCmid) {
        try {
          await api.messages.delete({
            peer_id: Number(peerId),
            cmids: [oldCmid],
            delete_for_all: 1,
          });
        } catch {
          // Игнорируем ошибку удаления.
        }

        await clearActiveMessage(userIdStr, peerId);
      }

      await resetQuiz(userIdStr);

      const firstQuestion = await getUnansweredQuestion(userIdStr);

      if (firstQuestion) {
        const { message, keyboard } = generateQuestionMessageAndKeyboard(firstQuestion);

        const combinedMessage =
          `${BOT_ICON} Прогресс квиза сброшен. ` + `Начинаем новый квиз!\n\n${message}`;

        const sent = await context.send(combinedMessage, { keyboard });

        const msgId = getCmidFromResponse(sent);

        if (typeof msgId === 'number' && msgId > 0) {
          await setActiveMessage(userIdStr, peerId, msgId);
        } else {
          console.error('Не удалось получить ID сообщения после сброса квиза');
        }
      } else {
        return context.send(
          `${BOT_ICON} Прогресс квиза сброшен, но вопросов для нового квиза не найдено.`,
          {
            keyboard: getMainMenu(hasTardigrades, hasQuestions, false),
          },
        );
      }

      return;
    }
  } catch (error) {
    console.error('Bot error:', error);
    await context.send('❌ Произошла ошибка.');
  }
});

// ============================================================================
// INLINE CALLBACKS
// ============================================================================

updates.on('message_event', async (event) => {
  console.log('EVENT CMID:', event.conversationMessageId, 'KEYS:', Object.keys(event));
  console.log('EVENT:', event.conversationMessageId, event?.peerId, event?.userId, event?.eventId);
  console.log('EVENT CMID:', event.conversationMessageId, 'FULL:', JSON.stringify(event));

  let answered = false;
  const answer = async (text?: string): Promise<void> => {
    if (answered) return;
    answered = true;
    try {
      await api.messages.sendMessageEventAnswer({
        event_id: event.eventId,
        user_id: event.userId,
        peer_id: event.peerId,
        event_data: text ? JSON.stringify({ type: 'show_snackbar', text }) : undefined,
      });
    } catch (e) {
      console.error('Ошибка при ответе на callback:', e);
    }
  };

  try {
    // VK/vk-io передаёт payload callback-кнопки в eventPayload.
    // В зависимости от версии/формата это может быть строка или объект.
    const rawEventPayload = event.eventPayload;

    let buttonPayload:
      | {
          action?: string;
          qid?: number;
          isCorrect?: boolean;
        }
      | undefined;

    if (typeof rawEventPayload === 'string') {
      try {
        buttonPayload = JSON.parse(rawEventPayload);
      } catch (e) {
        console.error('Ошибка парсинга eventPayload:', rawEventPayload, e);
        await answer('Ошибка данных кнопки.');
        return;
      }
    } else if (typeof rawEventPayload === 'object' && rawEventPayload !== null) {
      buttonPayload = rawEventPayload as {
        action?: string;
        qid?: number;
        isCorrect?: boolean;
      };
    }

    if (!buttonPayload?.action) {
      console.warn('Callback без action:', rawEventPayload);
      await answer('Неизвестная кнопка.');
      return;
    }

    const action = buttonPayload.action.trim();

    console.log('INLINE CALLBACK:', {
      action,
      payload: buttonPayload,
      userId: event.userId,
      peerId: event.peerId,
    });

    // ============================================================
    // АДМИН-ПАНЕЛЬ (кнопки тоже inline-callback, поэтому обрабатываются
    // здесь же, а не в message_new — там они были недостижимы)
    // ============================================================

    const ADMIN_ACTIONS = [
      'admin_help',
      'bot_mode_toggle_menu',
      'toggle_mode_messages',
      'toggle_mode_chats',
      'sync_album',
      'test_tardigrade',
      'load_demo_questions',
      'refresh_quiz',
    ];

    const isChatPeer = isPeerChat(event.peerId);

    if (ADMIN_ACTIONS.includes(action)) {
      const isAdmin = await checkAdmin(event.userId);

      if (!isAdmin || isChatPeer) {
        await answer('Недоступно.');
        return;
      }

      const botSettings = await getBotSettings();

      await handleAdminAction(action, event.peerId, event.userId, botSettings);

      await answer();
      return;
    }

    const { enable_messages, enable_chats } = await getBotSettings();
    if (!((enable_messages && !isChatPeer) || (enable_chats && isChatPeer))) return;

    const eventCmid = event.conversationMessageId;

    // ============================================================
    // КВИЗ — запуск
    // ============================================================

    if (action === 'quiz') {
      const senderStr = String(event.userId);
      const peerIdStr = String(event.peerId);

      const oldCmid = await getActiveMessage(senderStr, peerIdStr);

      if (oldCmid) {
        try {
          await api.messages.delete({
            peer_id: event.peerId,
            cmids: [oldCmid],
            delete_for_all: 1,
          });
        } catch (e) {
          console.error('Не удалось удалить старое сообщение квиза:', e);
        }
      }

      const question = await getUnansweredQuestion(senderStr);

      await answer();

      if (!question) {
        const stats = await getQuizStats(senderStr);

        let resultMsg =
          `${BOT_ICON} Все доступные вопросы пройдены!\n` +
          `📈 Результат: ${stats.correct} из ${stats.total}\n\n`;

        if (stats.percent === 100) {
          resultMsg += '🏆 Невероятно! Это абсолютный успех!';
        } else if (stats.percent === 0) {
          resultMsg += '🌊 Тихоходки сегодня оказались хитрее. Попробуем ещё раз?';
        } else {
          resultMsg += 'Хороший результат!';
        }

        await api.messages.send({
          peer_ids: [event.peerId],
          random_id: randomId(),
          message: resultMsg,
          keyboard: quizRestartKeyboard,
        });

        return;
      }

      const { message, keyboard } = generateQuestionMessageAndKeyboard(question);

      const sent = await api.messages.send({
        peer_ids: [event.peerId],
        random_id: randomId(),
        message,
        keyboard,
      });

      const isChat = isPeerChat(event.peerId);

      const msgId = getCmidFromResponse(sent);

      console.log('QUIZ MESSAGE ID:', {
        sent,
        msgId,
        isChat,
      });

      if (typeof msgId !== 'number' || msgId <= 0) {
        console.error('Не удалось получить ID сообщения квиза:', sent);

        await answer('Квиз запущен, но не удалось сохранить сообщение.');

        return;
      }

      await setActiveMessage(senderStr, peerIdStr, msgId);

      return;
    }

    if (action === 'tardigrade_day') {
      const senderStr = String(event.userId);
      const { tardigrade, isNew } = await getTodayTardigrade(senderStr);
      const prefix = isNew
        ? '🎉 Найдена новая тихоходка дня!'
        : '📖 Эта тихоходка уже была найдена:';
      await api.messages.send({
        peer_ids: [event.peerId],
        random_id: randomId(),
        message: `${BOT_ICON} ${prefix}\n\n✨ ${tardigrade.text}\n\n🔬 ${tardigrade.description || ''}`,
        attachment: tardigrade.image || undefined,
      });
      await answer();
      return;
    }

    // ============================================================
    // КВИЗ — сброс
    // ============================================================

    if (action === 'quiz_reset') {
      const senderStr = String(event.userId);
      const peerIdStr = String(event.peerId);

      const oldCmid = await getActiveMessage(senderStr, peerIdStr);

      if (oldCmid) {
        try {
          await api.messages.delete({
            peer_id: event.peerId,
            cmids: [oldCmid],
            delete_for_all: 1,
          });
        } catch (e) {
          console.error('Не удалось удалить старый вопрос:', e);
        }

        await clearActiveMessage(senderStr, peerIdStr);
      }

      await resetQuiz(senderStr);

      const firstQuestion = await getUnansweredQuestion(senderStr);

      if (!firstQuestion) {
        const empty = await api.messages.send({
          peer_ids: [event.peerId],
          random_id: randomId(),
          message: `${BOT_ICON} Прогресс квиза сброшен, ` + `но вопросов для нового квиза нет.`,
          keyboard: quizRestartKeyboard,
        });

        const emptyCmid = getCmidFromResponse(empty);

        if (typeof emptyCmid === 'number' && emptyCmid > 0) {
          await setActiveMessage(senderStr, peerIdStr, emptyCmid);
        }

        await answer();

        return;
      }

      const { message, keyboard } = generateQuestionMessageAndKeyboard(firstQuestion);

      const combinedMessage =
        `${BOT_ICON} Прогресс квиза сброшен. ` + `Начинаем новый квиз!\n\n${message}`;

      const sent = await api.messages.send({
        peer_ids: [event.peerId],
        random_id: randomId(),
        message: combinedMessage,
        keyboard,
      });

      const msgId = getCmidFromResponse(sent);

      if (typeof msgId === 'number' && msgId > 0) {
        await setActiveMessage(senderStr, peerIdStr, msgId);
        await answer();
      } else {
        console.error('Не удалось получить ID сообщения после сброса квиза:', sent);
        await answer();
      }

      return;
    }

    // ============================================================
    // КВИЗ — ответ
    // ============================================================

    if (action === 'quiz_ans') {
      const qid = Number(buttonPayload.qid);

      const isCorrect = Boolean(buttonPayload.isCorrect);

      if (!Number.isFinite(qid)) {
        await answer('Произошла ошибка в данных кнопки.');
        return;
      }

      const senderStr = String(event.userId);

      const peerIdStr = String(event.peerId);

      const activeCmid = await getActiveMessage(senderStr, peerIdStr);

      if (!activeCmid || (typeof eventCmid === 'number' && eventCmid !== activeCmid)) {
        await answer('Этот вопрос уже неактивен.');
        return;
      }

      if (await isQuestionAnswered(senderStr, qid)) {
        await answer('Вы уже ответили на этот вопрос.');
        return;
      }

      const questions = await getQuestions();

      const question = questions.find((q) => q.id === qid);

      if (!question) {
        await answer('Произошла ошибка: вопрос не найден.');
        return;
      }

      await saveQuizAnswer(senderStr, qid, isCorrect);

      const feedbackText = isCorrect ? '✅ Верно!' : '❌ Неправильно.';

      // Теперь answer() вызывается только здесь.
      await answer(feedbackText);

      // Ищем следующий вопрос.
      const nextQ = await getUnansweredQuestion(senderStr);

      if (nextQ) {
        const { message, keyboard } = generateQuestionMessageAndKeyboard(nextQ);

        const combinedMessage = `${feedbackText}\n\n${message}`;

        try {
          await api.messages.edit({
            peer_id: event.peerId,
            conversation_message_id: activeCmid,
            message: combinedMessage,
            keyboard,
          });
        } catch (e) {
          console.error('Не удалось отредактировать вопрос квиза:', e);

          const result = await api.messages.send({
            peer_ids: [event.peerId],
            random_id: randomId(),
            message: combinedMessage,
            keyboard,
          });

          const newMsgId = getCmidFromResponse(result);

          if (typeof newMsgId === 'number' && newMsgId > 0) {
            await setActiveMessage(senderStr, peerIdStr, newMsgId);
          } else {
            console.error('Не удалось получить ID нового сообщения квиза:', result);
          }
        }

        return;
      }

      // ==========================================================
      // КВИЗ закончен
      // ==========================================================

      const finalStats = await getQuizStats(senderStr);

      const finalMessage =
        `${feedbackText}\n\n` +
        `${BOT_ICON} Квиз завершён! ` +
        `Результат: ${finalStats.correct} из ${finalStats.total}`;

      try {
        await api.messages.edit({
          peer_id: event.peerId,
          conversation_message_id: activeCmid,
          message: finalMessage,
          keyboard: quizRestartKeyboard,
        });
      } catch (e) {
        console.error('Не удалось отредактировать финальное сообщение квиза:', e);

        const result = await api.messages.send({
          peer_ids: [event.peerId],
          random_id: randomId(),
          message: finalMessage,
          keyboard: quizRestartKeyboard,
        });

        const finalCmid = getCmidFromResponse(result);

        if (typeof finalCmid === 'number' && finalCmid > 0) {
          await setActiveMessage(senderStr, peerIdStr, finalCmid);
        } else {
          console.error('Не удалось получить ID финального сообщения квиза:', result);
        }
      }

      return;
    }

    // ============================================================
    // Пока неизвестная inline-кнопка
    // ============================================================

    console.warn('Необработанный inline action:', action);

    await answer(`Необработанное действие: ${action}`);
  } catch (error) {
    console.error('Ошибка в обработчике message_event:', error);

    await answer('Произошла ошибка.');
  } finally {
    await answer();
  }
});
