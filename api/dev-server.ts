import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import bot from '../bot.js';

bot.start().then(() => {
  console.log('🤖 Long Poll bot started (DEV)');
});
