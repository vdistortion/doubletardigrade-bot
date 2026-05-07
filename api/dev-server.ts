import dotenv from 'dotenv';
dotenv.config({ path: '.env.dev' });

await import('../src/main.js');
