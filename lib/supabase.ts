import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Ленивая инициализация — клиент создаётся только при первом вызове
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
      throw new Error(
        `Supabase env vars missing! SUPABASE_URL=${url}, SUPABASE_KEY=${key ? '***' : 'undefined'}`,
      );
    }

    _supabase = createClient(url, key);
  }
  return _supabase;
}
// Интерфейсы для таблиц Supabase
export interface Tortoise {
  id: number;
  text: string;
  description: string | null;
  image: string | null;
  created_at: string;
}

export interface Question {
  id: number;
  question: string;
  options: string[];
  correct: number; // Индекс правильного ответа (1-based)
  created_at: string;
}

export interface DailyTortoise {
  id: number;
  user_id: string;
  tortoise_id: number;
  date: string; // YYYY-MM-DD
  created_at: string;
}

export interface DailyQuiz {
  id: number;
  user_id: string;
  question_id: number;
  user_answer: number;
  date: string; // YYYY-MM-DD
  created_at: string;
}

// === ТИХОХОДКИ ===

export async function getTortoises(): Promise<Tortoise[]> {
  const { data, error } = await getSupabase().from('tortoises').select('*');
  if (error) console.error('Supabase getTortoises error:', error);
  return (data as Tortoise[]) || [];
}

export async function addTortoise(
  text: string,
  description: string,
  image: string,
): Promise<Tortoise | null> {
  const { data, error } = await getSupabase()
    .from('tortoises')
    .insert([{ text, description, image }])
    .select();

  if (error) console.error('Supabase addTortoise error:', error);
  return (data?.[0] as Tortoise) || null;
}

export async function deleteTortoise(id: number): Promise<void> {
  const { error } = await getSupabase().from('tortoises').delete().eq('id', id);
  if (error) console.error('Supabase deleteTortoise error:', error);
}

// === ВОПРОСЫ ===

export async function getQuestions(): Promise<Question[]> {
  const { data, error } = await getSupabase().from('questions').select('*');
  if (error) console.error('Supabase getQuestions error:', error);
  return (data as Question[]) || [];
}

export async function addQuestion(
  question: string,
  options: string[],
  correct: number,
): Promise<Question | null> {
  const { data, error } = await getSupabase()
    .from('questions')
    .insert([{ question, options, correct }])
    .select();
  if (error) console.error('Supabase addQuestion error:', error);
  return (data?.[0] as Question) || null;
}

export async function deleteQuestion(id: number): Promise<void> {
  const { error } = await getSupabase().from('questions').delete().eq('id', id);
  if (error) console.error('Supabase deleteQuestion error:', error);
}

// === ДНЕВНЫЕ ТИХОХОДКИ ===

function getTodayDate(): string {
  return new Date()
    .toLocaleDateString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .split('.')
    .reverse()
    .join('-'); // Формат "YYYY-MM-DD"
}

export async function getTodayTortoise(
  userId: string,
): Promise<{ tortoise: Tortoise; isNew: boolean }> {
  const today = getTodayDate();

  // Определяем ожидаемую структуру данных, возвращаемых запросом select
  interface ExistingTortoiseData {
    tortoises: { text: string }[]; // Связанные данные - это массив
  }

  const { data: existing, error: existingError } = await getSupabase()
    .from('daily_tortoises')
    .select('tortoises(*)')
    .eq('user_id', userId)
    .eq('date', today)
    .single<ExistingTortoiseData>(); // Явно типизируем результат single

  if (existingError && existingError.code !== 'PGRST116') {
    // PGRST116 = No rows found
    console.error('Supabase getTodayTortoise existing error:', existingError);
  }

  if (existing) {
    // Проверяем, что массив tortoises существует и не пуст
    if (existing.tortoises && existing.tortoises.length > 0) {
      return {
        tortoise: {
          id: -1,
          text: existing.tortoises[0].text,
          description: '',
          image: '',
          created_at: '',
        },
        isNew: false,
      };
    } else {
      // Этот случай означает, что запись daily_tortoise существует, но связанная тихоходка отсутствует.
      // Этого не должно происходить при правильных внешних ключах.
      console.warn(
        `Daily tortoise entry for user ${userId} on ${today} found, but no related tortoise text.`,
      );
      return {
        tortoise: {
          id: -1,
          text: 'неизвестная тихоходка (ошибка связи)',
          description: '',
          image: '',
          created_at: '',
        },
        isNew: false,
      };
    }
  }

  const tortoises = await getTortoises();
  if (tortoises.length === 0) {
    return {
      tortoise: {
        id: -1,
        text: 'неизвестная тихоходка',
        description: '',
        image: '',
        created_at: '',
      },
      isNew: true,
    };
  }
  const randomTortoise = tortoises[Math.floor(Math.random() * tortoises.length)];

  const { error: insertError } = await getSupabase()
    .from('daily_tortoises')
    .insert([
      {
        user_id: userId,
        tortoise_id: randomTortoise.id,
        date: today,
      },
    ]);

  if (insertError) console.error('Supabase insert daily_tortoise error:', insertError);

  return { tortoise: randomTortoise, isNew: true };
}

// === ДНЕВНЫЕ КВИЗЫ ===

export async function getTodayQuiz(userId: string): Promise<{
  question: string;
  options: string[];
  correct: number;
  userAnswer: number;
  isNew: boolean;
} | null> {
  const today = getTodayDate();

  // Определяем ожидаемую структуру данных, возвращаемых запросом select
  interface ExistingQuizData {
    user_answer: number;
    questions: { question: string; options: string[]; correct: number }[]; // Связанные данные - это массив
  }

  const { data: existing, error: existingError } = await getSupabase()
    .from('daily_quizzes')
    .select('user_answer, questions(question, options, correct)')
    .eq('user_id', userId)
    .eq('date', today)
    .single<ExistingQuizData>(); // Явно типизируем результат single

  if (existingError && existingError.code !== 'PGRST116') {
    console.error('Supabase getTodayQuiz existing error:', existingError);
  }

  if (existing) {
    // Проверяем, что массив questions существует и не пуст
    if (existing.questions && existing.questions.length > 0) {
      const questionData = existing.questions[0]; // Обращаемся к первому элементу массива
      return {
        question: questionData.question,
        options: questionData.options,
        correct: questionData.correct,
        userAnswer: existing.user_answer,
        isNew: false,
      };
    } else {
      // Этот случай означает, что запись daily_quiz существует, но связанный вопрос отсутствует.
      console.warn(
        `Daily quiz entry for user ${userId} on ${today} found, but no related question data.`,
      );
      return null;
    }
  }

  return null;
}

export async function saveTodayQuizAnswer(
  userId: string,
  questionId: number,
  userAnswer: number,
): Promise<void> {
  const today = getTodayDate();

  const { error } = await getSupabase()
    .from('daily_quizzes')
    .insert([
      {
        user_id: userId,
        question_id: questionId,
        user_answer: userAnswer,
        date: today,
      },
    ]);

  if (error) console.error('Supabase saveTodayQuizAnswer error:', error);
}

export async function getRandomQuestion(): Promise<Question | null> {
  const questions = await getQuestions();
  if (questions.length === 0) return null;
  return questions[Math.floor(Math.random() * questions.length)];
}
