import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { api, GROUP_ID, SUPER_ADMINS, updates } from '../bot.js';
import { isUserAdmin } from '../lib/admin.js';
import { addTortoise } from '../lib/supabase.js';

function verifyVKSignature(body: string, signature: string, secret: string): boolean {
  const hash = crypto.createHmac('sha256', secret).update(body).digest('base64');
  return hash === signature;
}

export default async (req: VercelRequest, res: VercelResponse) => {
  const rawBody = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  // ✅ Обработка confirmation (БЕЗ проверки подписи)
  if (body.type === 'confirmation') {
    console.log('Confirmation request received');
    res.status(200).send(process.env.CONFIRMATION);
    return;
  }

  // ✅ Проверка подписи ТОЛЬКО для остальных событий
  if (process.env.VK_SECRET_KEY) {
    const signature = req.headers['x-vk-signature'] as string | undefined;
    if (!signature || !verifyVKSignature(rawBody, signature, process.env.VK_SECRET_KEY)) {
      console.error('Invalid signature');
      res.status(403).send('Invalid signature');
      return;
    }
  }

  // --- ОБРАБОТЧИК photo_new ---
  if (body.type === 'photo_new') {
    const photo = body.object as any;
    const ownerId: number = photo.owner_id;
    const photoId: number = photo.id;
    const caption: string = (photo.text ?? '').trim();
    const attachment = `photo${ownerId}_${photoId}`;
    const albumId: number = photo.album_id; // Получаем ID альбома из события

    const configuredAlbumId = process.env.ALBUM_ID ? parseInt(process.env.ALBUM_ID, 10) : null;

    // Проверяем, что загрузил админ И что фото загружено в нужный альбом
    const uploaderId: number = photo.user_id ?? 0;
    const isAdmin =
        SUPER_ADMINS.includes(uploaderId) ||
        (uploaderId > 0 && (await isUserAdmin(uploaderId, api, GROUP_ID)));

    if (isAdmin && caption && configuredAlbumId && albumId === configuredAlbumId) {
      const [text, ...descParts] = caption.split('\n').map((s: string) => s.trim());
      const description = descParts.join('\n').trim();
      if (text) {
        await addTortoise(text, description, attachment);
        console.log('Saved tortoise from photo_new:', text);
      }
    } else {
      console.log(`Photo not saved. Admin: ${isAdmin}, Caption: ${!!caption}, Album ID match: ${albumId === configuredAlbumId}`);
    }

    res.status(200).send('ok'); // Всегда отвечаем "ok" на события VK
    return;
  }

  // Передаём остальные события в обработчики updates
  await (updates as any).dispatchMiddleware(body);

  res.status(200).send('ok');
};

export const config = {
  api: {
    bodyParser: false,
  },
};