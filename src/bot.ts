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
} from './lib/db.js';
import { isUserAdmin } from './lib/admin.js';
import {
  generateShuffledQuestionKeyboard,
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

const GROUP_ID = Number(process.env.GROUP_ID);
if (!GROUP_ID)
  throw new Error('Критическая ошибка: Переменная GROUP_ID не найдена или не является числом!');
let currentAlbumId = Number(process.env.ALBUM_ID);

async function fetchGoogleSheetCsv(url: string): Promise<string> {
  let exportUrl = url.trim();
  // Если ссылка уже явно ведёт на CSV (содержит output=csv или format=csv), оставляем как есть
  if (exportUrl.includes('output=csv') || exportUrl.includes('format=csv')) {
    // ничего не меняем
  }
  // Если это опубликованный документ (содержит /pub?)
  else if (exportUrl.includes('/pub?')) {
    exportUrl = exportUrl.replace(/\?.*$/, '') + '?output=csv';
  }
  // Обычная ссылка на редактирование/просмотр
  else {
    // Убираем всё после ? и добавляем /export?format=csv
    exportUrl =
      exportUrl.split('?')[0].replace(/\/(edit|htmlview|view)(\?.*)?$/, '') + '/export?format=csv';
  }

  const response = await fetch(exportUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) throw new Error('Получен пустой CSV');
  return text;
}

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

  // ─── Админские действия в ЛС (работают всегда) ──────────────────────────
  if (isAdmin && !inChat) {
    // Загружаем вопросы здесь, так как они нужны для админ-меню и некоторых админ-действий
    const questions = await getQuestions();
    const quizCsvUrl = await getQuizCsvUrl();

    // /admin или кнопка "Админ-панель" (старый payload 'admin_menu')
    if (command === '/admin' || payload?.action === 'admin_menu') {
      return context.send(`${BOT_ICON} Админ-панель:`, {
        keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats, quizCsvUrl),
      });
    }

    // Справка
    if (payload?.action === 'admin_help') {
      const helpText = [
        '📖 Справка',
        '',
        'Команды:',
        '/start – открыть главное меню',
        '/admin – открыть панель управления',
        '/album [ID] – сменить ID альбома для синхронизации',
        '',
        'Загрузка тихоходок дня:',
        '– Кнопка «🔄 Синхронизация» загружает фото и подписи из указанного альбома ВК в базу тихоходок.',
        '– Для обновления нажмите «Синхронизация» повторно — старые данные заменятся новыми.',
        '',
        'Импорт вопросов квиза:',
        '– Отправьте боту ссылку на опубликованную Google Таблицу для автоматической загрузки вопросов.',
        '– После успешного импорта ссылка сохранится, и появится кнопка «🔄 Обновить квиз».',
        '– Формат ячеек: Вопрос, НомерПравильногоОтвета, Вариант1, Вариант2...',
        '– Если квиз пуст, используйте кнопку «🧪 Загрузить демо‑вопросы».',
        '',
        '🌐 Исходный код: https://github.com/vdistortion/doubletardigrade-bot',
      ].join('\n');
      return context.send(helpText, {
        keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats, quizCsvUrl),
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
            quizCsvUrl,
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
            quizCsvUrl,
          ),
        },
      );
    }

    // Обработка кнопки "Синхронизация"
    if (payload?.action === 'sync_album') {
      try {
        const count = await syncAlbum(GROUP_ID, currentAlbumId, userApi);
        return context.send(`✅ Синхронизация завершена! Объектов: ${count}`, {
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats, quizCsvUrl),
        });
      } catch (error: any) {
        console.error('Ошибка при синхронизации альбома:', error);
        let errorMessage =
          '‼ Не удалось синхронизировать альбом. Пожалуйста, проверьте настройки группы и альбома.';
        if (error.code === 15 || error.code === 200) {
          errorMessage =
            '‼ Не удалось синхронизировать альбом. Убедитесь, что сообщество открыто, и повторите попытку.';
        }
        return context.send(errorMessage, {
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats, quizCsvUrl),
        });
      }
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
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats, quizCsvUrl),
        });
      } else {
        return context.send('❌ Неверный ID альбома.', {
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats, quizCsvUrl),
        });
      }
    }

    // CSV
    if (payload?.action === 'load_demo_questions') {
      try {
        const filePath = join(process.cwd(), 'demo_questions.csv');
        const csvText = await readFile(filePath, { encoding: 'utf-8' });
        const count = await importQuestionsFromCsv(csvText);
        return context.send(`✅ Загружено ${count} демо‑вопросов.`, {
          keyboard: getAdminMenu(true, enable_messages, enable_chats, await getQuizCsvUrl()),
        });
      } catch (e: any) {
        return context.send(`❌ Ошибка загрузки демо: ${e.message}`, {
          keyboard: getAdminMenu(
            questions.length > 0,
            enable_messages,
            enable_chats,
            await getQuizCsvUrl(),
          ),
        });
      }
    }

    if (payload?.action === 'refresh_quiz') {
      const url = await getQuizCsvUrl();
      if (!url) return context.send('❌ Нет сохранённой ссылки.');
      try {
        const csvText = await fetchGoogleSheetCsv(url);
        const count = await importQuestionsFromCsv(csvText);
        return context.send(`✅ Квиз обновлён из таблицы. Загружено ${count} вопросов.`, {
          keyboard: getAdminMenu(true, enable_messages, enable_chats, url),
        });
      } catch (e: any) {
        return context.send(`❌ Не удалось обновить квиз: ${e.message}`, {
          keyboard: getAdminMenu(questions.length > 0, enable_messages, enable_chats, url),
        });
      }
    }

    // Обработка вложений (файл CSV)
    for (const attach of context.attachments) {
      // Проверяем, что это документ и у него есть поле doc
      if (attach.type === 'doc' && 'doc' in attach) {
        const docAttach = attach as { doc: { ext: string; url?: string } };
        if (docAttach.doc?.ext === 'csv' && docAttach.doc?.url) {
          try {
            const response = await fetch(docAttach.doc.url);
            const csvText = await response.text();
            const count = await importQuestionsFromCsv(csvText);
            return context.send(`✅ Импортировано ${count} вопросов из файла.`, {
              keyboard: getAdminMenu(true, enable_messages, enable_chats, await getQuizCsvUrl()),
            });
          } catch (e: any) {
            return context.send(`❌ Ошибка при импорте файла: ${e.message}`, {
              keyboard: getAdminMenu(
                questions.length > 0,
                enable_messages,
                enable_chats,
                await getQuizCsvUrl(),
              ),
            });
          }
        }
      }
    }

    // Обработка текста сообщения: поиск ссылки на Google Sheets
    const urlRegex = /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
    const match = rawText.match(urlRegex);
    if (match) {
      const url = match[0];
      try {
        const csvText = await fetchGoogleSheetCsv(url);
        const count = await importQuestionsFromCsv(csvText);
        await setQuizCsvUrl(url); // сохраняем исходную ссылку
        return context.send(
          `✅ Импортировано ${count} вопросов из Google Таблицы. Ссылка сохранена для автообновления.`,
          {
            keyboard: getAdminMenu(true, enable_messages, enable_chats, url),
          },
        );
      } catch (e: any) {
        return context.send(`❌ Не удалось загрузить таблицу: ${e.message}`, {
          keyboard: getAdminMenu(
            questions.length > 0,
            enable_messages,
            enable_chats,
            await getQuizCsvUrl(),
          ),
        });
      }
    }
  }

  // ─── Проверка доступности бота для текущего контекста ──────────────────
  const isEnabledForCurrentContext = (enable_messages && !inChat) || (enable_chats && inChat);

  if (!isEnabledForCurrentContext) {
    // Выключен для всех, кроме админа в ЛС (его уже обслужили выше)
    return;
  }

  // Теперь мы уверены, что либо:
  // 1. Это админ (и он может использовать общие функции бота)
  // 2. ЛИБО это не админ, и бот включен для текущего контекста.

  try {
    // ─── Загрузка данных ────────────────────────────────────────────────────
    const [tardigrades, questions, stats] = await Promise.all([
      getTardigrades(),
      getQuestions(),
      getQuizStats(String(userId)),
    ]);

    const hasTardigrades = tardigrades.length > 0;
    const hasQuestions = questions.length > 0;
    const hasContent = hasTardigrades || hasQuestions;

    // Если контента нет и это не админ в ЛС (админ уже получил бы админ-панель выше) – молчим
    if (!hasContent) {
      // Админ в ЛС без контента при /start или admin_menu уже обслужен в блоке выше,
      // поэтому сюда попадают только обычные пользователи (или админ в чате) – игнорируем
      return;
    }

    // ─── Главное меню (для всех, у кого есть контент) ──────────────────────
    const isQuizInProgress = stats.answered > 0 && stats.answered < stats.total;
    const mainMenuKeyboard = getMainMenu(
      isAdmin && !inChat, // показывать шестерёнку только админу в ЛС
      hasTardigrades,
      hasQuestions,
      isQuizInProgress,
      inChat,
    );

    // /start или кнопка "Начать" – показываем главное меню
    if (command === 'Начать' || command === '/start' || payload?.action === 'start') {
      return context.send(`${BOT_ICON} Главное меню:`, { keyboard: mainMenuKeyboard });
    }

    // Обработка кнопки «Тихоходка дня»
    if (payload?.action === 'tardigrade_day') {
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

    // Обработка кнопки «Квиз» / «Продолжить квиз»
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
      const qKeyboard = generateShuffledQuestionKeyboard(question);
      return context.send(`${BOT_ICON} Вопрос:\n\n❓ ${question.question}`, {
        keyboard: qKeyboard,
      });
    }

    // Обработка ответа на вопрос квиза
    if (payload?.action === 'quiz_ans') {
      const { qid, isCorrect } = payload;
      const q = questions.find((item) => item.id === qid);
      if (!q) return context.send('❌ Вопрос не найден.');

      await saveQuizAnswer(String(userId), qid, isCorrect);
      const [updatedTardigrades, updatedQuestions, updatedStats] = await Promise.all([
        getTardigrades(),
        getQuestions(),
        getQuizStats(String(userId)),
      ]);

      const feedbackMessage = isCorrect
        ? '✅ Верно!'
        : `❌ Неправильно. Правильный ответ: ${q.options[q.correct - 1]}`;

      const updatedMainMenuKeyboard = getMainMenu(
        isAdmin && !inChat,
        updatedTardigrades.length > 0,
        updatedQuestions.length > 0,
        updatedStats.answered > 0 && updatedStats.answered < updatedStats.total,
        inChat,
      );

      await context.send(feedbackMessage, { keyboard: updatedMainMenuKeyboard });

      const nextQ = await getUnansweredQuestion(String(userId));
      if (!nextQ) {
        const finalStats = await getQuizStats(String(userId));
        return context.send(
          `${BOT_ICON} Квиз завершен! Результат: ${finalStats.correct} из ${finalStats.total}`,
          { keyboard: quizRestartKeyboard },
        );
      }

      const nextKeyboard = generateShuffledQuestionKeyboard(nextQ);
      return context.send(`${BOT_ICON} Следующий вопрос:\n\n❓ ${nextQ.question}`, {
        keyboard: nextKeyboard,
      });
    }

    // Обработка кнопки «Пройти заново»
    if (payload?.action === 'quiz_reset') {
      await resetQuiz(String(userId));
      return context.send(`${BOT_ICON} Прогресс квиза сброшен. Можно начинать заново!`, {
        keyboard: getMainMenu(isAdmin && !inChat, hasTardigrades, hasQuestions, false, inChat),
      });
    }
  } catch (error) {
    console.error('Bot error:', error);
    await context.send('❌ Произошла ошибка.');
  }
});
