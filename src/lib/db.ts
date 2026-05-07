import { Pool } from 'pg';

function getPool(): Pool {
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_DB } = process.env;
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB || !POSTGRES_HOST) {
    throw new Error('Критическая ошибка: Не все переменные POSTGRES_* найдены!');
  }
  const url = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:5432/${POSTGRES_DB}`;
  return new Pool({ connectionString: url });
}

// Синглтон пула — не создаём новый на каждый запрос
let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = getPool();
  return pool;
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

// ─── Тихоходки ────────────────────────────────────────────────────────────────

export async function getTardigrades(): Promise<Tardigrade[]> {
  const { rows } = await db().query<Tardigrade>('SELECT * FROM tardigrades');
  return rows;
}

export async function getTodayTardigrade(
  userId: string,
): Promise<{ tardigrade: Tardigrade; isNew: boolean }> {
  const today = new Date().toISOString().split('T')[0];

  const { rows } = await db().query<{ tardigrades: Tardigrade }>(
    `SELECT t.id, t.text, t.description, t.image
       FROM daily_tardigrades dt
              JOIN tardigrades t ON t.id = dt.tardigrade_id
       WHERE dt.user_id = $1 AND dt.date = $2
         LIMIT 1`,
    [userId, today],
  );

  if (rows[0]) return { tardigrade: rows[0] as unknown as Tardigrade, isNew: false };

  const list = await getTardigrades();
  if (list.length === 0) {
    return {
      tardigrade: { id: 0, text: 'Тихоходок пока нет', description: '', image: null },
      isNew: true,
    };
  }

  const random = list[Math.floor(Math.random() * list.length)];
  await db().query(
    'INSERT INTO daily_tardigrades (user_id, tardigrade_id, date) VALUES ($1, $2, $3)',
    [userId, random.id, today],
  );
  return { tardigrade: random, isNew: true };
}

export async function syncAlbum(groupId: number, albumId: number, vkUserApi: any): Promise<number> {
  const response = await vkUserApi.photos.get({
    owner_id: -groupId,
    album_id: albumId,
    count: 1000,
  });

  const records: { text: string; description: string | null; image: string }[] = response.items.map(
    (p: any) => {
      const lines = (p.text || '').split('\n');
      return {
        text: lines[0] || 'Без названия',
        description: lines.slice(1).join('\n') || null,
        image: `photo${p.owner_id}_${p.id}`,
      };
    },
  );

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM tardigrades');
    let count = 0;
    for (const r of records) {
      await client.query('INSERT INTO tardigrades (text, description, image) VALUES ($1, $2, $3)', [
        r.text,
        r.description,
        r.image,
      ]);
      count++;
    }
    await client.query('COMMIT');
    return count;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ─── Квиз ─────────────────────────────────────────────────────────────────────

export async function getQuestions(): Promise<QuizQuestion[]> {
  const { rows } = await db().query<QuizQuestion>('SELECT * FROM quiz_questions');
  return rows;
}

export async function addQuizQuestion(
  question: string,
  options: string[],
  correct: number,
): Promise<void> {
  await db().query('INSERT INTO quiz_questions (question, options, correct) VALUES ($1, $2, $3)', [
    question,
    JSON.stringify(options),
    correct,
  ]);
}

export async function deleteQuestion(id: number): Promise<void> {
  await db().query('DELETE FROM quiz_questions WHERE id = $1', [id]);
}

export async function deleteAllQuestions(): Promise<void> {
  await db().query('DELETE FROM quiz_questions');
}

export async function getUnansweredQuestion(userId: string): Promise<QuizQuestion | null> {
  const { rows: answered } = await db().query<{ question_id: number }>(
    'SELECT question_id FROM quiz_answers WHERE user_id = $1',
    [userId],
  );

  const ids = answered.map((a) => a.question_id);

  const { rows } =
    ids.length > 0
      ? await db().query<QuizQuestion>('SELECT * FROM quiz_questions WHERE id != ALL($1)', [ids])
      : await db().query<QuizQuestion>('SELECT * FROM quiz_questions');

  if (!rows.length) return null;
  return rows[Math.floor(Math.random() * rows.length)];
}

export async function saveQuizAnswer(
  userId: string,
  qId: number,
  isCorrect: boolean,
): Promise<void> {
  await db().query(
    `INSERT INTO quiz_answers (user_id, question_id, is_correct)
       VALUES ($1, $2, $3)
         ON CONFLICT (user_id, question_id) DO UPDATE SET is_correct = EXCLUDED.is_correct`,
    [userId, qId, isCorrect],
  );
}

export async function getQuizStats(userId: string) {
  const { rows: answers } = await db().query<{ is_correct: boolean }>(
    'SELECT is_correct FROM quiz_answers WHERE user_id = $1',
    [userId],
  );
  const { rows: questions } = await db().query<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM quiz_questions',
  );

  const total = questions[0]?.count ?? 0;
  const answered = answers.length;
  const correct = answers.filter((a) => a.is_correct).length;
  const percent = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  return { total, answered, correct, percent };
}

export async function resetQuiz(userId: string): Promise<void> {
  await db().query('DELETE FROM quiz_answers WHERE user_id = $1', [userId]);
}

// ─── Настройки бота ────────────────────────────────────────────────────────────

export async function getBotSettings(): Promise<{
  enable_messages: boolean;
  enable_chats: boolean;
}> {
  try {
    const { rows } = await db().query<{ key: string; value: string }>(
      `SELECT key, value FROM bot_settings WHERE key IN ('enable_messages', 'enable_chats')`,
    );
    const settings = { enable_messages: false, enable_chats: false };
    for (const row of rows) {
      if (row.key === 'enable_messages') settings.enable_messages = row.value === 'true';
      if (row.key === 'enable_chats') settings.enable_chats = row.value === 'true';
    }
    return settings;
  } catch {
    return { enable_messages: false, enable_chats: false };
  }
}

export async function setBotSetting(
  key: 'enable_messages' | 'enable_chats',
  value: boolean,
): Promise<void> {
  await db().query(
    `INSERT INTO bot_settings (key, value) VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)],
  );
}
