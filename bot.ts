import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
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

// Определяем типы для payload кнопок
interface BasePayload {
  action: string;
}

interface TortoiseDayPayload extends BasePayload {
  action: 'tortoise_day';
}

interface QuizPayload extends BasePayload {
  action: 'quiz';
}

interface QuizAnswerPayload extends BasePayload {
  action: 'quiz_answer';
  qid: number;
  answer: number;
}

interface AdminMenuPayload extends BasePayload {
  action: 'admin_menu';
}

interface ManageTortoisesPayload extends BasePayload {
  action: 'manage_tortoises';
}

interface ManageQuestionsPayload extends BasePayload {
  action: 'manage_questions';
}

interface BackPayload extends BasePayload {
  action: 'back';
}

type BotPayload =
  | TortoiseDayPayload
  | QuizPayload
  | QuizAnswerPayload
  | AdminMenuPayload
  | ManageTortoisesPayload
  | ManageQuestionsPayload
  | BackPayload;

const api = new API({ token: process.env.TOKEN as string });
const upload = new Upload({ api });
const updates = new Updates({ api, upload });

const GROUP_ID = 237639126;
const SUPER_ADMINS = [786742761];

updates.on('photo_new', async (context: any) => {
  try {
    const photo = context.object?.photo ?? context.object;
    const attachment = photo?.owner_id && photo?.id ? `photo${photo.owner_id}_${photo.id}` : null;
    const caption = (photo?.text ?? '').trim();

    const [text, description = ''] = caption.split('\n').map((s: string) => s.trim());

    if (!attachment || !text) {
      return;
    }

    await addTortoise(text, description, attachment);
    console.log('Saved tortoise from photo_new:', text);
  } catch (error) {
    console.error('photo_new handler error:', error);
  }
});

updates.on('message_new', async (context: MessageContext) => {
  if (!context.isUser) return;

  const userId = context.senderId;
  const admin = SUPER_ADMINS.includes(userId) || (await isUserAdmin(userId, api, GROUP_ID));
  const payload: BotPayload | undefined = context.messagePayload as BotPayload | undefined;
  const rawText = context.text?.trim() ?? '';
  const command = rawText.toLowerCase();

  try {
    // === ОБРАБОТКА PAYLOAD (нажатия на кнопки) ===
    if (payload?.action === 'tortoise_day') {
      const { tortoise, isNew } = await getTodayTortoise(String(userId));
      const keyboard = admin ? adminKeyboard : userKeyboard;
      await context.send({
        message: isNew
          ? `Сегодня ты ${tortoise.text} 🐢\n\n${tortoise.description ?? ''}`
          : `Ты уже узнала свою тихоходку сегодня!\nСегодня ты ${tortoise.text} 🐢\n\n${tortoise.description ?? ''}`,
        attachment: tortoise.image ?? undefined,
        keyboard,
      });
      return;
    }

    if (payload?.action === 'quiz') {
      const question = await getRandomQuestion();
      if (!question) {
        await context.send('Извините, пока нет вопросов для квиза.');
        return;
      }
      const quizKeyboard = JSON.stringify({
        one_time: false,
        buttons: question.options.map((opt, i) => [
          {
            action: {
              type: 'text',
              label: `${i + 1}. ${opt}`,
              payload: JSON.stringify({
                action: 'quiz_answer',
                qid: question.id,
                answer: i + 1,
              } as QuizAnswerPayload),
            },
            color: 'primary',
          },
        ]),
      });
      await context.send({
        message: question.question,
        keyboard: quizKeyboard,
      });
      return;
    }

    if (payload?.action === 'quiz_answer') {
      const { qid, answer } = payload as QuizAnswerPayload; // Приводим к нужному типу
      const questions = await getQuestions();
      const question = questions.find((q) => q.id === qid);

      if (!question) {
        await context.send('Извините, этот вопрос не найден.');
        return;
      }

      await saveTodayQuizAnswer(String(userId), qid, answer);

      const keyboard = admin ? adminKeyboard : userKeyboard;
      if (answer === question.correct) {
        await context.send({
          message: '✅ Правильно!',
          keyboard,
        });
      } else {
        await context.send({
          message: `❌ Неправильно. Правильный ответ: ${question.options[question.correct - 1]}`,
          keyboard,
        });
      }
      return;
    }

    if (payload?.action === 'admin_menu') {
      if (!admin) return;
      await context.send({
        message: '🔧 Админ-панель:',
        keyboard: adminMenuKeyboard,
      });
      return;
    }

    if (payload?.action === 'manage_tortoises') {
      if (!admin) return;
      const tortoises = await getTortoises();
      let list = '🐢 Текущие тихоходки:\n\n';
      tortoises.forEach((t) => {
        list += `${t.id}. ${t.text}\n`;
      });
      list += '\n💡 Напиши:\n/add_tortoise <текст> — добавить\n/delete_tortoise <id> — удалить';
      await context.send(list);
      return;
    }

    if (payload?.action === 'manage_questions') {
      if (!admin) return;
      const questions = await getQuestions();
      let list = '❓ Текущие вопросы:\n\n';
      questions.forEach((q) => {
        list += `${q.id}. ${q.question}\n`;
      });
      list +=
        '\n💡 Напиши:\n/add_question <вопрос>|<ответ1>|<ответ2>|<ответ3>|<ответ4>|<номер_правильного>\n/delete_question <id> — удалить';
      await context.send(list);
      return;
    }

    if (payload?.action === 'back') {
      if (!admin) return;
      await context.send({
        message: 'Главное меню:',
        keyboard: adminKeyboard,
      });
      return;
    }

    // === ОБРАБОТКА ТЕКСТОВЫХ КОМАНД (для админов) ===
    if (admin && command.startsWith('/add_tortoise ')) {
      const message = command.replace('/add_tortoise ', '').trim();
      if (!message) {
        await context.send('❌ Укажи текст тихоходки');
        return;
      }
      await addTortoise(message, 'Без описания', '');
      await context.send(`✅ Добавлена тихоходка: "${message}"`);
      return;
    }

    if (admin && command.startsWith('/delete_tortoise ')) {
      const id = parseInt(command.replace('/delete_tortoise ', '').trim());
      if (isNaN(id)) {
        await context.send('❌ Неверный ID тихоходки.');
        return;
      }
      await deleteTortoise(id);
      await context.send(`✅ Тихоходка удалена`);
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
      if (Number.isNaN(correct) || correct < 1 || correct > 4) {
        await context.send('❌ Номер правильного ответа должен быть от 1 до 4.');
        return;
      }

      await addQuestion(parts[0], parts.slice(1, 5), correct);
      await context.send('✅ Вопрос добавлен');
      return;
    }

    if (admin && command.startsWith('/delete_question ')) {
      const id = parseInt(command.replace('/delete_question ', '').trim());
      if (isNaN(id)) {
        await context.send('❌ Неверный ID вопроса.');
        return;
      }
      await deleteQuestion(id);
      await context.send(`✅ Вопрос удалён`);
      return;
    }

    // === ОБРАБОТКА ТЕКСТОВЫХ КОМАНД (для всех пользователей) ===
    if (command === 'меню' || command === 'привет' || command === 'старт') {
      const keyboard = admin ? adminKeyboard : userKeyboard;
      await context.send({
        message: admin ? '👑 Админ-меню:' : '📋 Меню:',
        keyboard,
      });
      return;
    }

    // Fallback: если команда не распознана
    const keyboard = admin ? adminKeyboard : userKeyboard;
    await context.send({
      message: 'Не понял 😅 Выбери из меню:',
      keyboard,
    });
  } catch (error) {
    console.error('Ошибка в обработчике message_new:', error);
    await context.send('❌ Что-то пошло не так...');
  }
});

export default updates;
