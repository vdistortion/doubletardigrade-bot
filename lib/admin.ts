import { API } from 'vk-io';

let adminsCache: number[] = [];
let adminsCacheTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // Кэш админов на 5 минут

export async function getAdminsWithCache(api: API, groupId: number): Promise<number[]> {
  const now = Date.now();
  if (adminsCache.length > 0 && now - adminsCacheTime < CACHE_TTL) {
    return adminsCache;
  }
  try {
    const response = await api.groups.getMembers({
      group_id: groupId,
      filter: 'managers',
      count: 1000,
    });
    adminsCache = response.items;
    adminsCacheTime = now;
    return adminsCache;
  } catch (error) {
    console.error('Ошибка при получении админов:', error);
    return adminsCache;
  }
}

export async function isUserAdmin(userId: number, api: API, groupId: number): Promise<boolean> {
  const admins = await getAdminsWithCache(api, groupId);
  return admins.includes(userId);
}
