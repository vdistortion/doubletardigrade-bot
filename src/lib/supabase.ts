import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupabase(): SupabaseClient {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
        `Критическая ошибка: SUPABASE_URL=${SUPABASE_URL}, SUPABASE_KEY=${SUPABASE_KEY ? '[SET]' : '[MISSING]'}`
    );
  }

  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

export interface Tardigrade {
  id: number;
  text: string;
  description: string | null;
  image: string | null;
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct: number;
}

export async function getTardigrades(): Promise<Tardigrade[]> {
  const { data, error } = await getSupabase().from('tardigrades').select('*');
  if (error) {
    console.error('Supabase error fetching tardigrades:', error);
    throw new Error(`Failed to fetch tardigrades: ${error.message}`);
  }
  return (data as Tardigrade[]) || [];
}

export async function getTodayTardigrade(
  userId: string,
): Promise<{ tardigrade: Tardigrade; isNew: boolean }> {
  const today = new Date().toISOString().split('T')[0];
  interface Row {
    tardigrades: Tardigrade | null;
  }
  const { data: existing, error: existingError } = await getSupabase()
    .from('daily_tardigrades')
    .select('tardigrades(*)')
    .eq('user_id', userId)
    .eq('date', today)
    .single<Row>();

  // PGRST116 - это код ошибки "нет строк найдено", это не настоящая ошибка в данном случае
  if (existingError && existingError.code !== 'PGRST116') {
    console.error('Supabase error fetching existing daily tardigrade:', existingError);
    throw new Error(`Failed to fetch daily tardigrade: ${existingError.message}`);
  }

  if (existing?.tardigrades) return { tardigrade: existing.tardigrades, isNew: false };

  const list = await getTardigrades();
  if (list.length === 0)
    return {
      tardigrade: { id: 0, text: 'Тихоходок пока нет', description: '', image: null },
      isNew: true,
    };

  const random = list[Math.floor(Math.random() * list.length)];
  const { error: insertError } = await getSupabase()
    .from('daily_tardigrades')
    .insert([{ user_id: userId, tardigrade_id: random.id, date: today }]);
  if (insertError) {
    console.error('Supabase error inserting daily tardigrade:', insertError);
    throw new Error(`Failed to save daily tardigrade: ${insertError.message}`);
  }
  return { tardigrade: random, isNew: true };
}

export async function syncAlbum(groupId: number, albumId: number, vkUserApi: any) {
  const response = await vkUserApi.photos.get({
    owner_id: -groupId,
    album_id: albumId,
    count: 1000,
  });
  const records = response.items.map((p: any) => {
    const lines = (p.text || '').split('\n');
    return {
      text: lines[0] || 'Без названия',
      description: lines.slice(1).join('\n') || null,
      image: `photo${p.owner_id}_${p.id}`,
    };
  });
  const { error: deleteError } = await getSupabase().from('tardigrades').delete().neq('id', 0);
  if (deleteError) {
    console.error('Supabase error deleting old tardigrades:', deleteError);
    throw new Error(`Failed to clear old tardigrades: ${deleteError.message}`);
  }
  const { data, error: insertError } = await getSupabase()
    .from('tardigrades')
    .insert(records)
    .select();
  if (insertError) {
    console.error('Supabase error inserting new tardigrades:', insertError);
    throw new Error(`Failed to insert new tardigrades: ${insertError.message}`);
  }
  return data?.length || 0;
}

export async function getQuestions(): Promise<QuizQuestion[]> {
  const { data, error } = await getSupabase().from('quiz_questions').select('*');
  if (error) {
    console.error('Supabase error fetching quiz questions:', error);
    throw new Error(`Failed to fetch quiz questions: ${error.message}`);
  }
  return (data as QuizQuestion[]) || [];
}

export async function addQuizQuestion(question: string, options: string[], correct: number) {
  const { error } = await getSupabase()
    .from('quiz_questions')
    .insert([{ question, options, correct }]);
  if (error) {
    console.error('Supabase error adding quiz question:', error);
    throw new Error(`Failed to add quiz question: ${error.message}`);
  }
}

export async function deleteQuestion(id: number) {
  const { error } = await getSupabase().from('quiz_questions').delete().eq('id', id);
  if (error) {
    console.error(`Supabase error deleting quiz question ${id}:`, error);
    throw new Error(`Failed to delete quiz question: ${error.message}`);
  }
}

export async function deleteAllQuestions() {
  const { error } = await getSupabase().from('quiz_questions').delete().neq('id', 0);
  if (error) {
    console.error('Supabase error deleting all quiz questions:', error);
    throw new Error(`Failed to delete all quiz questions: ${error.message}`);
  }
}

export async function getUnansweredQuestion(userId: string): Promise<QuizQuestion | null> {
  const { data: answered, error: answeredError } = await getSupabase()
    .from('quiz_answers')
    .select('question_id')
    .eq('user_id', userId);
  if (answeredError) {
    console.error('Supabase error fetching answered questions:', answeredError);
    throw new Error(`Failed to fetch answered questions: ${answeredError.message}`);
  }

  const ids = answered?.map((a) => a.question_id) || [];
  let query = getSupabase().from('quiz_questions').select('*');
  if (ids.length > 0) query = query.not('id', 'in', `(${ids.join(',')})`);
  const { data, error } = await query;
  if (error) {
    console.error('Supabase error fetching unanswered questions:', error);
    throw new Error(`Failed to fetch unanswered questions: ${error.message}`);
  }
  if (!data?.length) return null;
  return data[Math.floor(Math.random() * data.length)];
}

export async function saveQuizAnswer(userId: string, qId: number, isCorrect: boolean) {
  const { error } = await getSupabase()
    .from('quiz_answers')
    .upsert(
      { user_id: userId, question_id: qId, is_correct: isCorrect },
      { onConflict: 'user_id,question_id' },
    );
  if (error) {
    console.error('Supabase error saving quiz answer:', error);
    throw new Error(`Failed to save quiz answer: ${error.message}`);
  }
}

export async function getQuizStats(userId: string) {
  const { data, error } = await getSupabase()
    .from('quiz_answers')
    .select('is_correct')
    .eq('user_id', userId);
  if (error) {
    console.error('Supabase error fetching quiz stats:', error);
    throw new Error(`Failed to fetch quiz stats: ${error.message}`);
  }

  const questions = await getQuestions();
  const total = questions.length;
  const answered = data?.length || 0;
  const correct = data?.filter((d) => d.is_correct).length || 0;
  const percent = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  return { total, answered, correct, percent };
}

export async function resetQuiz(userId: string) {
  const { error } = await getSupabase().from('quiz_answers').delete().eq('user_id', userId);
  if (error) {
    console.error('Supabase error resetting quiz:', error);
    throw new Error(`Failed to reset quiz: ${error.message}`);
  }
}

export async function getBotSettings(): Promise<{
  enable_messages: boolean;
  enable_chats: boolean;
}> {
  const { data, error } = await getSupabase()
    .from('bot_settings')
    .select('key,value')
    .in('key', ['enable_messages', 'enable_chats']);

  if (error) {
    console.error('Supabase error fetching bot settings:', error);
    // Возвращаем значения по умолчанию в случае ошибки, чтобы бот не падал
    return { enable_messages: false, enable_chats: false };
  }

  const settings: { enable_messages: boolean; enable_chats: boolean } = {
    enable_messages: false,
    enable_chats: false,
  };

  if (data) {
    for (const row of data) {
      if (row.key === 'enable_messages') {
        settings.enable_messages = row.value === 'true';
      } else if (row.key === 'enable_chats') {
        settings.enable_chats = row.value === 'true';
      }
    }
  }
  return settings;
}

export async function setBotSetting(
  key: 'enable_messages' | 'enable_chats',
  value: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from('bot_settings')
    .upsert({ key, value: String(value) }, { onConflict: 'key' });
  if (error) {
    console.error(`Supabase error setting bot setting ${key}:`, error);
    throw new Error(`Failed to update bot setting: ${error.message}`);
  }
}
