import { test, expect, type Page } from '@playwright/test';
async function mockApi(
  page: Page,
  options: {
    unauthorized?: boolean;
    failSend?: boolean;
    holdSend?: Promise<void>;
    pollUnauthorized?: boolean;
    settingsDisabled?: boolean;
  } = {},
) {
  const queue: object[] = [];
  const sent: object[] = [];
  const deleted: number[] = [];
  let receipt = 1;
  let sendStarted = 0;
  await page.route('https://*.api.green-api.com/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname.includes('/getStateInstance/'))
      data = { stateInstance: options.unauthorized ? 'notAuthorized' : 'authorized' };
    else if (url.pathname.includes('/getSettings/'))
      data = {
        typeInstance: 'telegram',
        incomingWebhook: options.settingsDisabled ? 'no' : 'yes',
        webhookUrl: '',
      };
    else if (url.pathname.includes('/checkAccount/'))
      data = {
        exist: true,
        chatId:
          route.request().postDataJSON().phoneNumber === 79991234567 ? '12345678' : '87654321',
      };
    else if (url.pathname.includes('/sendMessage/')) {
      sendStarted++;
      if (options.holdSend) await options.holdSend;
      if (options.failSend) {
        await route.fulfill({ status: 500, json: { error: 'server error' } });
        return;
      }
      sent.push(route.request().postDataJSON());
      data = { idMessage: `sent-${sent.length}` };
    } else if (url.pathname.includes('/receiveNotification/')) {
      if (options.pollUnauthorized) {
        await route.fulfill({ status: 401, json: {} });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      data = queue.length ? { receiptId: receipt, body: queue[0] } : null;
    } else if (url.pathname.includes('/deleteNotification/')) {
      const receiptId = Number(url.pathname.split('/').at(-1));
      if (receiptId === receipt && queue.length) {
        queue.shift();
        receipt++;
        deleted.push(receiptId);
      }
      data = { result: true };
    }
    await route.fulfill({ json: data });
  });
  return {
    queue,
    sent,
    deleted,
    options,
    get sendStarted() {
      return sendStarted;
    },
  };
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('idInstance', { exact: true }).fill('4100000000');
  await page.getByLabel('apiTokenInstance', { exact: true }).fill('test-token');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
}
async function createChat(page: Page, phone = '+7 (999) 123-45-67') {
  await page.getByRole('button', { name: 'Новый чат', exact: true }).click();
  await page.getByLabel('Номер телефона').fill(phone);
  await page.getByRole('dialog').getByRole('button', { name: 'Создать чат', exact: true }).click();
  await expect(page.getByRole('heading', { name: `+${phone.replace(/\D/g, '')}` })).toBeVisible();
}
test('login, create, send, receive, deduplicate, and logout', async ({ page }, testInfo) => {
  const api = await mockApi(page);
  await login(page);
  await expect(page.getByRole('button', { name: 'Новый чат', exact: true })).toBeVisible();
  await createChat(page);
  await page.getByLabel('Сообщение', { exact: true }).fill('Привет! Как дела?');
  await page.getByLabel('Сообщение', { exact: true }).press('Enter');
  await expect(page.getByRole('log')).toContainText('Привет! Как дела?');
  expect(api.sent).toEqual([{ chatId: '12345678', message: 'Привет! Как дела?' }]);
  api.queue.push({
    typeWebhook: 'outgoingMessageStatus',
    chatId: '12345678',
    idMessage: 'sent-1',
    status: 'read',
  });
  const reply = {
    typeWebhook: 'incomingMessageReceived',
    idMessage: 'reply-1',
    timestamp: Math.floor(Date.now() / 1000),
    senderData: { chatId: '12345678', senderName: 'Анна', senderPhoneNumber: 79991234567 },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: 'Привет! Все отлично, спасибо 😊' },
    },
  };
  api.queue.push(reply, reply);
  await expect(page.getByRole('log')).toContainText('Все отлично, спасибо');
  await expect(page.getByLabel('Прочитано')).toBeVisible();
  await expect.poll(() => api.deleted.length).toBe(3);
  await expect(
    page.getByRole('log').getByText('Привет! Все отлично, спасибо 😊', { exact: true }),
  ).toHaveCount(1);
  await expect(page.locator('.chat-item')).toHaveCount(1);
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
  await page.screenshot({ path: testInfo.outputPath('chat-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Начните разговор' })).toBeVisible();
  await expect(page.getByLabel('apiTokenInstance', { exact: true })).toHaveValue('');
});
test('shows authorization errors and retains draft after send failure', async ({ page }) => {
  const api = await mockApi(page, { unauthorized: true, failSend: true });
  await login(page);
  await expect(page.getByRole('alert')).toContainText('не авторизован');
  api.options.unauthorized = false;
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await createChat(page);
  await page.getByLabel('Сообщение', { exact: true }).fill('Текст не должен потеряться');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByRole('alert')).toContainText('Текст сохранен');
  await expect(page.getByLabel('Сообщение', { exact: true })).toHaveValue(
    'Текст не должен потеряться',
  );
  await expect(page.getByRole('log')).not.toContainText('Текст не должен потеряться');
});
test('mobile layout supports chat navigation and multiline drafts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await login(page);
  await createChat(page);
  await expect(page.getByRole('button', { name: 'Назад к чатам' })).toBeVisible();
  await page.getByLabel('Сообщение', { exact: true }).fill('Первая строка');
  await page.getByLabel('Сообщение', { exact: true }).press('Shift+Enter');
  await page.getByLabel('Сообщение', { exact: true }).pressSequentially('Вторая строка');
  await expect(page.getByLabel('Сообщение', { exact: true })).toHaveValue(
    'Первая строка\nВторая строка',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('chat-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Назад к чатам' }).click();
  await expect(page.getByRole('button', { name: 'Новый чат', exact: true })).toBeVisible();
  await page.locator('.chat-item').click();
  await expect(page.getByLabel('Сообщение', { exact: true })).toHaveValue(
    'Первая строка\nВторая строка',
  );
});
test('ignores stale account-state events and supports recovery after actual logout', async ({
  page,
}) => {
  const api = await mockApi(page);
  api.queue.push({ typeWebhook: 'stateInstanceChanged', stateInstance: 'notAuthorized' });
  await login(page);
  await expect.poll(() => api.deleted.length).toBe(1);
  await expect(page.locator('.connection').getByText('Получение сообщений включено')).toBeVisible();
  await expect(page.getByText('Инстанс отключен.', { exact: false })).not.toBeVisible();
  api.options.unauthorized = true;
  api.queue.push({ typeWebhook: 'stateInstanceChanged', stateInstance: 'notAuthorized' });
  await expect(page.locator('.connection').getByText('Получение приостановлено')).toBeVisible();
  await expect.poll(() => api.deleted.length).toBe(2);
  api.options.unauthorized = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.connection').getByText('Получение сообщений включено')).toBeVisible();
});
test('reports errors without message IDs and names dialogs for assistive technology', async ({
  page,
}) => {
  const api = await mockApi(page);
  await login(page);
  await page.getByRole('button', { name: 'Новый чат', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Новый чат', exact: true })).toBeVisible();
  await page.getByLabel('Номер телефона').fill('+79991234567');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать чат', exact: true }).click();
  api.queue.push({
    typeWebhook: 'outgoingMessageStatus',
    chatId: '12345678',
    status: 'failed',
    description: 'chatId unresolvable on this session',
  });
  await expect(page.getByRole('alert')).toContainText('Telegram не смог определить получателя');
  await expect.poll(() => api.deleted.length).toBe(1);
  await page.getByRole('button', { name: 'Закрыть ошибку отправки' }).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
});
test('keeps a pending send failure and draft in the originating chat', async ({ page }) => {
  let releaseSend!: () => void;
  const holdSend = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  const api = await mockApi(page, { holdSend, failSend: true });
  await login(page);
  await createChat(page);
  await page.getByLabel('Сообщение', { exact: true }).fill('Текст для первого чата');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect.poll(() => api.sendStarted).toBe(1);
  await createChat(page, '+79991234568');
  await page.getByLabel('Сообщение', { exact: true }).fill('Другой черновик');
  releaseSend();
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeEnabled();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await page.locator('.chat-item').filter({ hasText: '+79991234567' }).click();
  await expect(page.getByRole('alert')).toContainText('Текст сохранен');
  await expect(page.getByLabel('Сообщение', { exact: true })).toHaveValue('Текст для первого чата');
});
test('focuses the phone field and restores the trigger after closing a dialog', async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  const trigger = page.getByRole('button', { name: 'Новый чат', exact: true });
  await trigger.click();
  await expect(page.getByLabel('Номер телефона')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
test('preserves history scroll position and tracks unread messages in another chat', async ({
  page,
}) => {
  const api = await mockApi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await createChat(page);
  for (let index = 0; index < 45; index++)
    api.queue.push({
      typeWebhook: 'incomingMessageReceived',
      idMessage: `history-${index}`,
      timestamp: 1763115112 + index,
      senderData: { chatId: '12345678', senderName: 'Анна', chatType: 'user' },
      messageData: {
        typeMessage: 'textMessage',
        textMessageData: {
          textMessage: `Сообщение ${index}\nНесколько строк\nДля проверки истории`,
        },
      },
    });
  await expect(page.getByRole('log')).toContainText('Сообщение 44', { timeout: 20000 });
  await page.getByRole('log').evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect.poll(() => page.getByRole('log').evaluate((element) => element.scrollTop)).toBe(0);
  api.queue.push({
    typeWebhook: 'incomingMessageReceived',
    idMessage: 'latest',
    timestamp: 1763115199,
    senderData: { chatId: '12345678' },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: 'Новое сообщение внизу' },
    },
  });
  await expect(page.getByRole('log')).toContainText('Новое сообщение внизу');
  expect(await page.getByRole('log').evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'К новым сообщениям' }).click();
  await expect
    .poll(() =>
      page
        .getByRole('log')
        .evaluate((element) =>
          Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
        ),
    )
    .toBeLessThan(2);
  await expect(page.getByRole('button', { name: 'К новым сообщениям' })).not.toBeVisible();
  await createChat(page, '+79991234568');
  api.queue.push({
    typeWebhook: 'incomingMessageReceived',
    idMessage: 'unread',
    timestamp: 1763115200,
    senderData: { chatId: '12345678' },
    messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Непрочитанное' } },
  });
  const firstChat = page.locator('.chat-item').filter({ hasText: 'Непрочитанное' });
  await expect(firstChat.locator('.unread')).toHaveText('1');
  await firstChat.click();
  await expect(firstChat.locator('.unread')).not.toBeVisible();
});
test('mobile recovery works from the open chat and the composer grows with text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await mockApi(page);
  await login(page);
  await createChat(page);
  const field = page.getByLabel('Сообщение', { exact: true });
  const initialHeight = await field.evaluate((element) => element.clientHeight);
  await field.fill('Первая строка\nВторая строка\nТретья строка\nЧетвертая строка');
  expect(await field.evaluate((element) => element.clientHeight)).toBeGreaterThan(initialHeight);
  expect(await field.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
  api.options.pollUnauthorized = true;
  const retry = page.getByRole('button', { name: 'Возобновить получение' });
  await expect(retry).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  api.options.pollUnauthorized = false;
  await retry.click();
  await expect(retry).not.toBeVisible();
  await expect(page.locator('.conversation-header')).toContainText('Получение включено');
  const longName = 'ОченьДлинноеИмяБезПробелов'.repeat(10);
  api.queue.push({
    typeWebhook: 'incomingMessageReceived',
    idMessage: 'long-name',
    timestamp: 1763115201,
    senderData: { chatId: '12345678', senderName: longName },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: 'Проверка длинного имени' },
    },
  });
  await expect(page.locator('.conversation-header h1')).toHaveAttribute('title', longName);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('mobile chat list shows prerequisites and the search focus has a visible outline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { settingsDisabled: true });
  await login(page);
  await expect(page.locator('.global-notices')).toBeVisible();
  await expect(page.getByText('Включите «Получать уведомления', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: 'Поиск чатов' }).focus();
  expect(
    await page
      .locator('.search-input')
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe('solid');
  expect(
    await page
      .getByRole('textbox', { name: 'Поиск чатов' })
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe('16px');
});
