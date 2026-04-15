import { API, Upload, Updates, MessageContext } from 'vk-io';
import {
  getTodayTortoise,
  getTortoises,
  addTortoise,
  deleteTortoise,
  getRandomQuestion,
  addQuestion,
  deleteQuestion,
  getQuestions,
  saveTodayQuizAnswer,
} from './lib/supabase.js';
import { isUserAdmin } from './lib/admin.js';
import { userKeyboard, adminKeyboard, adminMenuKeyboard } from './lib/keyboards.js';

// ─── Типы payload ────────────────────────────────────────────────────────────

type BotPayload =
  | { action: 'tortoise_day' }
  | { action: 'quiz' }
  | { action: 'quiz_answer'; qid: number; answer: number }
  | { action: 'admin_menu' }
  | { action: 'manage_tortoises' }
  | { action: 'manage_questions' }
  | { action: 'sync_album' }
  | { action: 'back' };

// ─── Инициализация ───────────────────────────────────────────────────────────

export const api = new API({ token: process.env.TOKEN as string });
export const userApi = new API({ token: process.env.USER_TOKEN as string });
const upload = new Upload({ api });

// updates создаётся один раз и переиспользуется и в polling, и в webhook
export const updates = new Updates({ api, upload });

export const GROUP_ID = 237639126;
export const SUPER_ADMINS = [786742761];

// ─── Хелперы ─────────────────────────────────────────────────────────────────

async function checkAdmin(userId: number): Promise<boolean> {
  return SUPER_ADMINS.includes(userId) || (await isUserAdmin(userId, api, GROUP_ID));
}

// ─── Обработчики ─────────────────────────────────────────────────────────────

updates.on('message_new', async (context: MessageContext) => {
  // Игнорируем сообщения не от пользователей (боты, группы)
  if (!context.isUser) return;

  const userId = context.senderId;
  const admin = await checkAdmin(userId);
  const payload = context.messagePayload as BotPayload | undefined;
  const rawText = context.text?.trim() ?? '';
  const command = rawText.toLowerCase();

  const keyboard = admin ? adminKeyboard : userKeyboard;

  try {
    // ── Кнопки ──────────────────────────────────────────────────────────────

    if (payload?.action === 'tortoise_day') {
      const { tortoise, isNew } = await getTodayTortoise(String(userId));
      const prefix = isNew ? '' : 'Ты уже узнала свою тихоходку сегодня!\n';
      await context.send({
        message: `${prefix}Сегодня ты ${tortoise.text} 🐢${tortoise.description ? `\n\n${tortoise.description}` : ''}`,
        attachment: tortoise.image || undefined,
        keyboard,
      });
      return;
    }

    if (payload?.action === 'quiz') {
      const question = await getRandomQuestion();
      if (!question) {
        await context.send({ message: 'Пока нет вопросов для квиза 😔', keyboard });
        return;
      }
      const quizKeyboard = JSON.stringify({
        one_time: true,
        buttons: question.options.map((opt, i) => [
          {
            action: {
              type: 'text',
              label: `${i + 1}. ${opt}`,
              payload: JSON.stringify({
                action: 'quiz_answer',
                qid: question.id,
                answer: i + 1,
              } satisfies BotPayload),
            },
            color: 'primary',
          },
        ]),
      });
      await context.send({ message: question.question, keyboard: quizKeyboard });
      return;
    }

    if (payload?.action === 'quiz_answer') {
      const { qid, answer } = payload;
      const questions = await getQuestions();
      const question = questions.find((q) => q.id === qid);

      if (!question) {
        await context.send({ message: 'Вопрос не найден 😔', keyboard });
        return;
      }

      await saveTodayQuizAnswer(String(userId), qid, answer);

      const isCorrect = answer === question.correct;
      await context.send({
        message: isCorrect
          ? '✅ Правильно!'
          : `❌ Неправильно. Правильный ответ: ${question.options[question.correct - 1]}`,
        keyboard,
      });
      return;
    }

    if (payload?.action === 'admin_menu') {
      if (!admin) return;
      await context.send({ message: '🔧 Админ-панель:', keyboard: adminMenuKeyboard });
      return;
    }

    if (payload?.action === 'manage_tortoises') {
      if (!admin) return;
      const tortoises = await getTortoises();
      const list =
        '🐢 Текущие тихоходки:\n\n' +
        tortoises.map((t) => `${t.id}. ${t.text}`).join('\n') +
        '\n\n💡 Команды:\n/add_tortoise <текст> — добавить\n/delete_tortoise <id> — удалить';
      await context.send({ message: list, keyboard: adminMenuKeyboard });
      return;
    }

    if (payload?.action === 'sync_album') {
      if (!admin) return;

      const albumId = process.env.ALBUM_ID;
      if (!albumId) {
        await context.send({ message: '❌ В .env.local не указан ALBUM_ID', keyboard: adminMenuKeyboard });
        return;
      }

      await context.send({ message: '⏳ Начинаю чтение альбома...', keyboard: adminMenuKeyboard });

      try {
        // Получаем фото из альбома группы (owner_id для групп всегда с минусом)
        const photosResponse = await userApi.photos.get({
          owner_id: -GROUP_ID,
          album_id: albumId,
          count: 1000, // Максимум за один запрос
        });

        // Получаем уже сохраненные тихоходки, чтобы не добавлять дубликаты
        const existingTortoises = await getTortoises();
        const existingImages = new Set(existingTortoises.map((t) => t.image));

        let addedCount = 0;

        for (const photo of photosResponse.items) {
          const attachment = `photo${photo.owner_id}_${photo.id}`;

          // Если такого фото еще нет в базе
          if (!existingImages.has(attachment)) {
            const caption = (photo.text ?? '').trim();

            // Добавляем только если есть описание (первая строка пойдет в название)
            if (caption) {
              const [text, ...descParts] = caption.split('\n').map((s) => s.trim());
              const description = descParts.join('\n').trim();

              await addTortoise(text, description, attachment);
              addedCount++;
            }
          }
        }

        await context.send({
          message: `✅ Синхронизация завершена!\n\n📸 Всего фото в альбоме: ${photosResponse.count}\n🐢 Добавлено новых тихоходок: ${addedCount}`,
          keyboard: adminMenuKeyboard
        });
      } catch (error) {
        console.error('Sync error:', error);
        await context.send({ message: '❌ Ошибка при синхронизации альбома. Проверь логи.', keyboard: adminMenuKeyboard });
      }
      return;
    }

    if (payload?.action === 'manage_questions') {
      if (!admin) return;
      const questions = await getQuestions();
      const list =
        '❓ Текущие вопросы:\n\n' +
        questions.map((q) => `${q.id}. ${q.question}`).join('\n') +
        '\n\n💡 Команды:\n/add_question <вопрос>|<ответ1>|<ответ2>|<ответ3>|<ответ4>|<номер_правильного>\n/delete_question <id>';
      await context.send({ message: list, keyboard: adminMenuKeyboard });
      return;
    }

    if (payload?.action === 'back') {
      if (!admin) return;
      await context.send({ message: '👑 Главное меню:', keyboard: adminKeyboard });
      return;
    }

    // ── Текстовые команды (только для админов) ───────────────────────────────

    if (admin && command.startsWith('/add_tortoise ')) {
      const text = rawText.slice('/add_tortoise '.length).trim();
      if (!text) {
        await context.send('❌ Укажи текст тихоходки');
        return;
      }
      await addTortoise(text, '', null);
      await context.send(`✅ Добавлена тихоходка: "${text}"`);
      return;
    }

    if (admin && command.startsWith('/delete_tortoise ')) {
      const id = parseInt(rawText.slice('/delete_tortoise '.length).trim(), 10);
      if (isNaN(id)) {
        await context.send('❌ Неверный ID');
        return;
      }
      await deleteTortoise(id);
      await context.send('✅ Тихоходка удалена');
      return;
    }

    if (admin && command.startsWith('/add_question')) {
      const raw = rawText.slice('/add_question'.length).trim();
      const parts = raw.split('|').map((s) => s.trim());

      if (parts.length !== 6) {
        await context.send(
          '❌ Формат: /add_question <вопрос>|<ответ1>|<ответ2>|<ответ3>|<ответ4>|<номер_правильного>',
        );
        return;
      }

      const correct = Number(parts[5]);
      if (!Number.isInteger(correct) || correct < 1 || correct > 4) {
        await context.send('❌ Номер правильного ответа должен быть от 1 до 4');
        return;
      }

      await addQuestion(parts[0], parts.slice(1, 5), correct);
      await context.send('✅ Вопрос добавлен');
      return;
    }

    if (admin && command.startsWith('/delete_question ')) {
      const id = parseInt(rawText.slice('/delete_question '.length).trim(), 10);
      if (isNaN(id)) {
        await context.send('❌ Неверный ID');
        return;
      }
      await deleteQuestion(id);
      await context.send('✅ Вопрос удалён');
      return;
    }

    // ── Текстовые команды (для всех) ─────────────────────────────────────────

    if (['меню', 'привет', 'старт', 'start'].includes(command)) {
      await context.send({
        message: admin ? '👑 Админ-меню:' : '📋 Меню:',
        keyboard,
      });
      return;
    }

    // Fallback
    await context.send({ message: 'Не понял 😅 Выбери из меню:', keyboard });
  } catch (error) {
    console.error('message_new handler error:', error);
    await context.send('❌ Что-то пошло не так...');
  }
});
