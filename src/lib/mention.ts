import type { API } from 'vk-io';

const NAME_TTL = 60 * 60 * 1000;

const names = new Map<number, { name: string; timestamp: number }>();

export async function getMention(api: API, userId: number): Promise<string> {
  const now = Date.now();
  const cached = names.get(userId);

  if (cached && now - cached.timestamp < NAME_TTL) {
    return cached.name;
  }

  let name = cached?.name ?? '';

  try {
    const [user] = await api.users.get({ user_ids: [String(userId)] });
    if (user?.first_name) {
      name = user.first_name;
      names.set(userId, { name, timestamp: now });
    }
  } catch (e) {
    console.error('Не удалось получить имя пользователя:', e);
  }

  if (!name) return `@id${userId}`;

  return name;
}
