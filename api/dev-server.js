import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const { updates } = await import('../src/bot.js');
updates
    .startPolling()
    .then(() => console.log('🤖 Long Poll bot started (DEV)'))
    .catch((err) => {
    console.error('Failed to start polling:', err);
    process.exit(1);
});
