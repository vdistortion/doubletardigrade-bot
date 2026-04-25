import { API, Upload, Updates, MessageContext } from 'vk-io';
import {
  getTodayTardigrade,
  syncAlbum,
  addQuizQuestion,
  deleteQuestion,
  deleteAllQuestions,
  getUnansweredQuestion,
  saveQuizAnswer,
  getQuizStats,
  resetQuiz,
  getTardigrades,
  getQuestions,
  getBotSettings,
  setBotSetting,
} from './lib/supabase.js';
import { isUserAdmin } from './lib/admin.js';
import {
  getAdminMenu,
  getBotModeToggleKeyboard,
  getMainMenu,
  quizRestartKeyboard,
} from './lib/keyboards.js';

const BOT_ICON = '👾';
const GROUP_TOKEN = process.env.GROUP_TOKEN;
if (!GROUP_TOKEN) throw new Error('Критическая ошибка: Переменная GROUP_TOKEN не найдена!');

const USER_TOKEN = process.env.USER_TOKEN;
if (!USER_TOKEN) throw new Error('Критическая ошибка: Переменная USER_TOKEN не найдена!');

const ADMIN_ID_ENV = process.env.SUPER_ADMINS || '';
const SUPER_ADMINS = ADMIN_ID_ENV.split(',')
  .map((id) => parseInt(id.trim()))
  .filter((id) => !isNaN(id));

export const api = new API({ token: GROUP_TOKEN });
export const userApi = new API({ token: USER_TOKEN }); // Используем проверенный USER_TOKEN
const upload = new Upload({ api });
export const updates = new Updates({ api, upload });

export const GROUP_ID = 237639126; // Рассмотри возможность вынести в .env
let currentAlbumId = Number(process.env.ALBUM_ID);

async function checkAdmin(userId: number): Promise<boolean> {
  return SUPER_ADMINS.includes(userId) || (await isUserAdmin(userId, api, GROUP_ID));
}

updates.on('message_new', async (context: MessageContext) => {
  if (!context.isUser) return;

  const userId = context.senderId;
  const isSuperAdmin = SUPER_ADMINS.includes(userId);
  const payload = context.messagePayload;
  const rawText = context.text?.trim() ?? '';
  const command = rawText.toLowerCase();

  const isAdmin = await checkAdmin(userId);
  const isEmergencyAccess = isAdmin && command === '/admin';

  if (!isEmergencyAccess) {
    const { enable_messages, enable_chats } = await getBotSettings();
    const inChat = context.isChat;

    const isEnabledForMessages = enable_messages && !inChat;
    const isEnabledForChats = enable_chats && inChat;

    // Если бот не включен для текущего контекста (личные сообщения или чат)
    // и это не экстренная команда админа, то игнорируем сообщение.
    if (!isEnabledForMessages && !isEnabledForChats) {
      return;
    }
  }

  // Оригинальный ранний выход для сообщений без payload и не команд, теперь после фильтра режима
  if (!payload && !['/admin', '/start'].includes(command)) return;

  try {
    // Загружаем все необходимые данные параллельно, включая настройки бота
    const [tardigrades, questions, stats, botSettings] = await Promise.all([
      getTardigrades(),
      getQuestions(),
      getQuizStats(String(userId)),
      getBotSettings(),
    ]);

    const isBotEnabled =
      isEmergencyAccess || botSettings.enable_messages || botSettings.enable_chats;
    const keyboard = getMainMenu(
      isAdmin && !context.isChat,
      tardigrades.length > 0,
      questions.length > 0,
      stats.answered > 0 && stats.answered < stats.total,
      isBotEnabled,
    );

    if (command === '/admin' && isAdmin && !context.isChat) {
      const showFullSettings =
        isEmergencyAccess || botSettings.enable_messages || botSettings.enable_chats;
      return context.send(`${BOT_ICON} Админ-панель:`, {
        keyboard: getAdminMenu(questions.length > 0, showFullSettings, showFullSettings),
      });
    }

    const action = payload?.action;

    if (action === 'admin_help') {
      const helpText = [
        '📖 Справка по командам:',
        '/start - начать',
        '/admin - открыть панель управления',
        '/album [ID] - сменить ID альбома',
        '/quiz_add вопрос|номер|вар1|вар2... - добавить вопрос',
        '/quiz_del [ID] - удалить вопрос по ID',
      ].join('\n');
      return context.send(helpText, {
        keyboard: getAdminMenu(
          questions.length > 0,
          botSettings.enable_messages,
          botSettings.enable_chats,
        ),
      });
    }

    if (action === 'bot_mode_toggle_menu' && isAdmin && !context.isChat) {
      return context.send(`${BOT_ICON} Управление режимом бота:`, {
        keyboard: getBotModeToggleKeyboard(botSettings.enable_messages, botSettings.enable_chats),
      });
    }

    if (action === 'toggle_mode_messages' && isAdmin && !context.isChat) {
      await setBotSetting('enable_messages', !botSettings.enable_messages);
      const updatedSettings = await getBotSettings(); // Получаем обновленные настройки
      return context.send(
        `✅ Режим для сообщений ${updatedSettings.enable_messages ? 'включен' : 'выключен'}.`,
        {
          keyboard: getBotModeToggleKeyboard(
            updatedSettings.enable_messages,
            updatedSettings.enable_chats,
          ),
        },
      );
    }

    if (action === 'toggle_mode_chats' && isAdmin && !context.isChat) {
      await setBotSetting('enable_chats', !botSettings.enable_chats);
      const updatedSettings = await getBotSettings(); // Получаем обновленные настройки
      return context.send(
        `✅ Режим для чатов ${updatedSettings.enable_chats ? 'включен' : 'выключен'}.`,
        {
          keyboard: getBotModeToggleKeyboard(
            updatedSettings.enable_messages,
            updatedSettings.enable_chats,
          ),
        },
      );
    }

    if (action === 'quiz_init') {
      const tests = [
        [
          'Кто такие тихоходки?',
          '1',
          'Микроскопические животные',
          'Вид рыб',
          'Пришельцы',
          'Насекомые',
        ],
        ['Сколько ног у тихоходки?', '3', 'Две', 'Шесть', 'Восемь', 'Десять'],
        [
          'Где НЕ могут выжить тихоходки?',
          '4',
          'В открытом космосе',
          'При радиации',
          'В жидком кислороде',
          'В жерле вулкана',
        ],
        [
          'Как еще называют тихоходок?',
          '2',
          'Водные слоны',
          'Водные медведи',
          'Моховые поросята',
          'Морские львы',
        ],
      ];
      for (const t of tests) {
        await addQuizQuestion(t[0], t.slice(2), parseInt(t[1]));
      }
      return context.send('✅ База инициализирована (4 вопроса).', {
        keyboard: getAdminMenu(true, botSettings.enable_messages, botSettings.enable_chats),
      });
    }

    if (action === 'quiz_clear') {
      await deleteAllQuestions();
      return context.send('✅ Все вопросы удалены.', {
        keyboard: getAdminMenu(false, botSettings.enable_messages, botSettings.enable_chats),
      });
    }

    if (action === 'tardigrade_day') {
      const { tardigrade, isNew } = await getTodayTardigrade(String(userId));
      const prefix = isNew
        ? '🎉 Найдена новая тихоходка дня!'
        : '📖 Эта тихоходка уже была найдена:';
      return context.send(
        `${BOT_ICON} ${prefix}\n\n✨ ${tardigrade.text}\n\n🔬 ${tardigrade.description || ''}`,
        {
          attachment: tardigrade.image || undefined,
          keyboard,
        },
      );
    }

    if (action === 'quiz') {
      const question = await getUnansweredQuestion(String(userId));
      if (!question) {
        let resultMsg = `${BOT_ICON} Все доступные вопросы пройдены!\n📈 Результат: ${stats.correct} из ${stats.total}\n\n`;
        if (stats.percent === 100) resultMsg += '🏆 Невероятно! Это абсолютный успех!';
        else if (stats.percent === 0)
          resultMsg += '🌊 Тихоходки сегодня оказались хитрее. Попробуем еще раз?';
        else resultMsg += 'Хороший результат!';
        return context.send(resultMsg, { keyboard: quizRestartKeyboard });
      }

      const qKeyboard = JSON.stringify({
        inline: true,
        buttons: question.options.map((opt, idx) => [
          {
            action: {
              type: 'text',
              label: opt.slice(0, 40),
              payload: JSON.stringify({ action: 'quiz_ans', qid: question.id, ans: idx + 1 }),
            },
            color: 'primary',
          },
        ]),
      });
      return context.send(`${BOT_ICON} Вопрос:\n\n❓ ${question.question}`, {
        keyboard: qKeyboard,
      });
    }

    if (action === 'quiz_ans') {
      const { qid, ans } = payload;
      const q = questions.find((item) => item.id === qid);
      if (!q) return context.send('❌ Вопрос не найден.');

      await saveQuizAnswer(String(userId), qid, q.correct === ans);
      await context.send(
        q.correct === ans
          ? '✅ Верно!'
          : `❌ Неправильно. Правильный ответ: ${q.options[q.correct - 1]}`,
      );

      const nextQ = await getUnansweredQuestion(String(userId));
      if (!nextQ) {
        const finalStats = await getQuizStats(String(userId));
        return context.send(
          `${BOT_ICON} Квиз завершен! Результат: ${finalStats.correct} из ${finalStats.total}`,
          { keyboard: quizRestartKeyboard },
        );
      }

      const nextKeyboard = JSON.stringify({
        inline: true,
        buttons: nextQ.options.map((opt, idx) => [
          {
            action: {
              type: 'text',
              label: opt.slice(0, 40),
              payload: JSON.stringify({ action: 'quiz_ans', qid: nextQ.id, ans: idx + 1 }),
            },
            color: 'primary',
          },
        ]),
      });
      return context.send(`${BOT_ICON} Следующий вопрос:\n\n❓ ${nextQ.question}`, {
        keyboard: nextKeyboard,
      });
    }

    if (action === 'quiz_reset') {
      await resetQuiz(String(userId));
      return context.send(`${BOT_ICON} Прогресс квиза сброшен. Можно начинать заново!`, {
        keyboard: getMainMenu(
          isAdmin && !context.isChat,
          tardigrades.length > 0,
          questions.length > 0,
          false,
        ),
      });
    }

    if (isAdmin && !context.isChat) {
      if (action === 'admin_menu')
        return context.send(`${BOT_ICON} Админ-панель:`, {
          keyboard: getAdminMenu(
            questions.length > 0,
            botSettings.enable_messages,
            botSettings.enable_chats,
          ),
        });
      if (action === 'sync_album') {
        const count = await syncAlbum(GROUP_ID, currentAlbumId, userApi);
        return context.send(`✅ Синхронизация завершена! Объектов: ${count}`, {
          keyboard: getAdminMenu(
            questions.length > 0,
            botSettings.enable_messages,
            botSettings.enable_chats,
          ),
        });
      }
      if (action === 'test_tardigrade') {
        if (!tardigrades.length) return context.send('❌ Пусто.');
        const rand = tardigrades[Math.floor(Math.random() * tardigrades.length)];
        return context.send(`🧪 Тест:\n\n${rand.text}`, { attachment: rand.image || undefined });
      }
    }

    if (action === 'back' || command === '/start') {
      return context.send(`${BOT_ICON} Главное меню:`, { keyboard });
    }
  } catch (error) {
    console.error('Bot error:', error);
    await context.send('❌ Произошла ошибка.');
  }
});
