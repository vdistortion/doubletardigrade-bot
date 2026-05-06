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
export const userApi = new API({ token: USER_TOKEN });
const upload = new Upload({ api });
export const updates = new Updates({ api, upload });

export const GROUP_ID = 238247894;
let currentAlbumId = Number(process.env.ALBUM_ID);

async function checkAdmin(userId: number): Promise<boolean> {
  return SUPER_ADMINS.includes(userId) || (await isUserAdmin(userId, api, GROUP_ID));
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

  // --- Логика для админов (всегда работает в личных сообщениях) ---
  // Админ-панель и связанные с ней действия доступны только в личных сообщениях
  if (isAdmin && !inChat) {
    // Загружаем вопросы здесь, так как они нужны для админ-меню и некоторых админ-действий
    const questions = await getQuestions();

    // Обработка команды /admin или нажатия кнопки "Админ-панель"
    if (command === '/admin' || payload?.action === 'admin_menu') {
      return context.send(`${BOT_ICON} Админ-панель:`, {
        keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats),
      });
    }

    if (payload?.action === 'admin_help') {
      const helpText = [
        '📖 Справка по командам:',
        '/start - начать',
        '/admin - открыть панель управления',
        '/album [ID] - сменить ID альбома',
        '/quiz_add вопрос|номер|вар1|вар2... - добавить вопрос',
        '/quiz_del [ID] - удалить вопрос по ID',
      ].join('\n');
      return context.send(helpText, {
        keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats),
      });
    }

    // Обработка кнопки "Режим: Выключен/Включен"
    if (payload?.action === 'bot_mode_toggle_menu') {
      return context.send(`${BOT_ICON} Управление режимом бота:`, {
        keyboard: getBotModeToggleKeyboard(enable_messages, enable_chats),
      });
    }

    // Обработка кнопки "Включить/Выключить для сообщений"
    if (payload?.action === 'toggle_mode_messages') {
      await setBotSetting('enable_messages', !enable_messages);
      const updatedSettings = await getBotSettings();
      return context.send(
        `✅ Режим для сообщений ${updatedSettings.enable_messages ? 'включен' : 'выключен'}.`,
        {
          keyboard: getAdminMenu(
            questions.length > 0,
            updatedSettings.enable_messages,
            updatedSettings.enable_chats,
          ),
        },
      );
    }

    // Обработка кнопки "Включить/Выключить для чатов"
    if (payload?.action === 'toggle_mode_chats') {
      await setBotSetting('enable_chats', !enable_chats);
      const updatedSettings = await getBotSettings();
      return context.send(
        `✅ Режим для чатов ${updatedSettings.enable_chats ? 'включен' : 'выключен'}.`,
        {
          keyboard: getAdminMenu(
            questions.length > 0,
            updatedSettings.enable_messages,
            updatedSettings.enable_chats,
          ),
        },
      );
    }

    // Обработка кнопки "Инициализировать квиз"
    if (payload?.action === 'quiz_init') {
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
        keyboard: getAdminMenu(true, enable_messages, enable_chats),
      });
    }

    // Обработка кнопки "Удалить все вопросы"
    if (payload?.action === 'quiz_clear') {
      await deleteAllQuestions();
      return context.send('✅ Все вопросы удалены.', {
        keyboard: getAdminMenu(false, enable_messages, enable_chats),
      });
    }

    // Обработка кнопки "Синхронизация"
    if (payload?.action === 'sync_album') {
      const count = await syncAlbum(GROUP_ID, currentAlbumId, userApi);
      return context.send(`✅ Синхронизация завершена! Объектов: ${count}`, {
        keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats),
      });
    }

    // Обработка кнопки "Тест выдачи"
    if (payload?.action === 'test_tardigrade') {
      const tardigrades = await getTardigrades(); // Загружаем тихоходок для теста
      if (!tardigrades.length) return context.send('❌ Пусто.');
      const rand = tardigrades[Math.floor(Math.random() * tardigrades.length)];
      return context.send(`🧪 Тест:\n\n${rand.text}`, { attachment: rand.image || undefined });
    }

    // Обработка команды /album [ID]
    if (command.startsWith('/album ')) {
      const newAlbumId = parseInt(command.split(' ')[1]);
      if (!isNaN(newAlbumId) && newAlbumId > 0) {
        currentAlbumId = newAlbumId;
        // Можно добавить сохранение currentAlbumId в Supabase для персистентности
        return context.send(`✅ ID альбома изменен на ${newAlbumId}.`, {
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats),
        });
      } else {
        return context.send('❌ Неверный ID альбома.', {
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats),
        });
      }
    }

    // Обработка команды /quiz_add Вопрос|НомерПравильного|Вар1|Вар2|...
    if (command.startsWith('/quiz_add ')) {
      const parts = rawText.substring('/quiz_add '.length).split('|');
      if (parts.length >= 4) {
        const questionText = parts[0];
        const correctOptionIndex = parseInt(parts[1]);
        const options = parts.slice(2);
        if (
          !isNaN(correctOptionIndex) &&
          correctOptionIndex > 0 &&
          correctOptionIndex <= options.length
        ) {
          await addQuizQuestion(questionText, options, correctOptionIndex);
          return context.send('✅ Вопрос добавлен.', {
            keyboard: getAdminMenu(true, enable_messages, enable_chats),
          });
        }
      }
      return context.send(
        '❌ Неверный формат команды. Используйте: /quiz_add Вопрос|НомерПравильного|Вар1|Вар2|...',
        {
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats),
        },
      );
    }

    // Обработка команды /quiz_del [ID]
    if (command.startsWith('/quiz_del ')) {
      const qId = parseInt(command.split(' ')[1]);
      if (!isNaN(qId) && qId > 0) {
        await deleteQuestion(qId);
        return context.send(`✅ Вопрос ${qId} удален.`, {
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats),
        });
      } else {
        return context.send('❌ Неверный ID вопроса.', {
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats),
        });
      }
    }
  }

  // --- Общая логика бота (работает только если бот включен для текущего контекста) ---
  const isEnabledForCurrentContext = (enable_messages && !inChat) || (enable_chats && inChat);

  if (!isEnabledForCurrentContext) {
    // Если бот выключен для текущего контекста (и это не админское действие, которое уже обработано),
    // то просто игнорируем сообщение.
    return;
  }

  // Теперь мы уверены, что либо:
  // 1. Это админ (и он может использовать общие функции бота)
  // 2. ЛИБО это не админ, и бот включен для текущего контекста.

  try {
    // Загружаем данные, необходимые для общих операций бота
    const [tardigrades, questions, stats] = await Promise.all([
      getTardigrades(),
      getQuestions(),
      getQuizStats(String(userId)),
    ]);

    const keyboard = getMainMenu(
      isAdmin && !inChat,
      tardigrades.length > 0,
      questions.length > 0,
      stats.answered > 0 && stats.answered < stats.total,
      isEnabledForCurrentContext,
    );

    // Обработка команды /start или кнопки "Назад"
    if (command === '/start' || payload?.action === 'back') {
      return context.send(`${BOT_ICON} Главное меню:`, { keyboard });
    }

    // Обработка кнопки "Тихоходка дня"
    if (payload?.action === 'tardigrade_day') {
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

    // Обработка кнопки "Квиз" / "Продолжить квиз"
    if (payload?.action === 'quiz') {
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

    // Обработка ответа на вопрос квиза
    if (payload?.action === 'quiz_ans') {
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

    // Обработка кнопки "Пройти заново" (квиз)
    if (payload?.action === 'quiz_reset') {
      await resetQuiz(String(userId));
      return context.send(`${BOT_ICON} Прогресс квиза сброшен. Можно начинать заново!`, {
        keyboard: getMainMenu(
          isAdmin && !inChat,
          tardigrades.length > 0,
          questions.length > 0,
          false,
          isEnabledForCurrentContext,
        ),
      });
    }
  } catch (error) {
    console.error('Bot error:', error);
    await context.send('❌ Произошла ошибка.');
  }
});
