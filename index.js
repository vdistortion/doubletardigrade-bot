import { VK } from 'vk-io';
import { groupToken, userToken } from './token.js';

const vk = new VK({ token: groupToken });
const vkUser = new VK({ token: userToken });

const GROUP_ID = 237639126;
const ALBUM_ID = '312224608';

let photosCache = [];
let lastCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 минут

async function getAlbumPhotos() {
    const now = Date.now();
    if (photosCache.length > 0 && now - lastCacheTime < CACHE_TTL) {
        return photosCache; // отдаём из кэша
    }

    const response = await vkUser.api.photos.get({
        owner_id: -GROUP_ID,
        album_id: ALBUM_ID,
        count: 1000
    });

    photosCache = response.items.map(
        photo => `photo${photo.owner_id}_${photo.id}`
    );
    lastCacheTime = now;
    console.log(`Кэш обновлён: ${photosCache.length} фото`);
    return photosCache;
}

async function getRandomPhoto() {
    const photos = await getAlbumPhotos();
    if (photos.length === 0) return null;
    return photos[Math.floor(Math.random() * photos.length)];
}

// Клавиатура
const fortuneKeyboard = {
    one_time: false,
    buttons: [
        [
            {
                action: {
                    type: 'text',
                    label: '🔮 Гадание'
                },
                color: 'primary'
            }
        ]
    ]
};

// Скрытая клавиатура
const hideKeyboard = {
    buttons: [],
    one_time: true
};

vk.updates.on('message_new', async (context) => {
    if (!context.isUser) return;
    const text = context.text?.toLowerCase();

    if (text === 'гадание' || text === 'гадай') {
        try {
            await context.send('Раскидываю карты... 🔮');
            const photo = await getRandomPhoto();
            if (!photo) {
                await context.send({
                    message: 'Альбом пуст, карты закончились 😔',
                    keyboard: hideKeyboard
                });
                return;
            }
            await context.send({
                message: 'Вот твоё предсказание на сегодня! ✨',
                attachment: photo,
                keyboard: hideKeyboard
            });
        } catch (error) {
            console.error('Ошибка:', error);
            await context.send({
                message: 'Хрустальный шар помутнел... Попробуй позже 😅',
                keyboard: hideKeyboard
            });
        }
        return;
    }

    if (text === 'меню' || text === 'кнопки') {
        await context.send({
            message: 'Вот меню:',
            keyboard: fortuneKeyboard
        });
        return;
    }

    if (text === 'привет') {
        await context.send('Привет 👋 Напиши "гадание"!');
    } else {
        await context.send('Я тебя не понял 😅');
    }
});

vk.updates.start().then(() => console.log('Бот запущен 🚀'));
