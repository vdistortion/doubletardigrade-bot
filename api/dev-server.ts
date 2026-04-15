import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env.local') });

import bot from '../bot.js';

const PORT = 3000;

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const data = JSON.parse(body);

      if (data?.type === 'confirmation') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(process.env.CONFIRMATION);
        return;
      }

      await bot.handleWebhookUpdate(data);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } catch (error) {
      console.error('Ошибка при обработке вебхука VK:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error handling webhook');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Dev server listening on http://localhost:${PORT}`);
});
