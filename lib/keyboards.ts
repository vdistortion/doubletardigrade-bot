// VKVercelBot-master/lib/keyboards.ts
export const userKeyboard: string = JSON.stringify({
  one_time: false,
  buttons: [
    [
      {
        action: {
          type: 'text',
          label: '🐢 Тихоходка дня',
          payload: JSON.stringify({ action: 'tortoise_day' }),
        },
        color: 'primary',
      },
    ],
    [
      {
        action: {
          type: 'text',
          label: '❓ Квиз',
          payload: JSON.stringify({ action: 'quiz' }),
        },
        color: 'primary',
      },
    ],
  ],
});

export const adminKeyboard: string = JSON.stringify({
  one_time: false,
  buttons: [
    [
      {
        action: {
          type: 'text',
          label: '🐢 Тихоходка дня',
          payload: JSON.stringify({ action: 'tortoise_day' }),
        },
        color: 'primary',
      },
    ],
    [
      {
        action: {
          type: 'text',
          label: '❓ Квиз',
          payload: JSON.stringify({ action: 'quiz' }),
        },
        color: 'primary',
      },
    ],
    [
      {
        action: {
          type: 'text',
          label: '⚙️ Админ-панель',
          payload: JSON.stringify({ action: 'admin_menu' }),
        },
        color: 'negative',
      },
    ],
  ],
});

export const adminMenuKeyboard: string = JSON.stringify({
  one_time: false,
  buttons: [
    [
      {
        action: {
          type: 'text',
          label: '📝 Управлять тихоходками',
          payload: JSON.stringify({ action: 'manage_tortoises' }),
        },
        color: 'negative',
      },
    ],
    [
      {
        action: {
          type: 'text',
          label: '❓ Управлять вопросами',
          payload: JSON.stringify({ action: 'manage_questions' }),
        },
        color: 'negative',
      },
    ],
    [
      {
        action: {
          type: 'text',
          label: '◀️ Назад',
          payload: JSON.stringify({ action: 'back' }),
        },
        color: 'primary',
      },
    ],
  ],
});
