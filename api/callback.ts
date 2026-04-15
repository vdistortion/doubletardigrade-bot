import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import bot from '../bot.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env.local') });

console.log('TOKEN:', !!process.env.TOKEN);
console.log('CONFIRMATION:', process.env.CONFIRMATION);

function verifyVKSignature(body: string, signature: string, secret: string): boolean {
  const hash = crypto.createHmac('sha256', secret).update(body).digest('base64');

  return hash === signature;
}

export default async (req: VercelRequest, res: VercelResponse) => {
  let rawBody = '';

  await new Promise<void>((resolve) => {
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => resolve());
  });

  const body = JSON.parse(rawBody);
  console.log('INCOMING EVENT:', body.type);

  if (body?.type === 'confirmation') {
    res.status(200).send(process.env.CONFIRMATION);
    return;
  }

  if (process.env.VK_SECRET_KEY) {
    const signature = req.headers['x-vk-signature'] as string;
    console.log(signature);

    if (!signature || !verifyVKSignature(rawBody, signature, process.env.VK_SECRET_KEY)) {
      res.status(403).send('Invalid signature');
      return;
    }
  }

  await bot.handleWebhookUpdate(body);
  res.status(200).send('ok');
};

export const config = {
  api: {
    bodyParser: false,
  },
};
