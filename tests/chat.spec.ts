import { test, expect, type Page } from '@playwright/test';
async function mockApi(page: Page, options: { unauthorized?: boolean; failSend?: boolean } = {}) {
  const queue: object[] = [];
  const sent: object[] = [];
  const deleted: number[] = [];
  let receipt = 0;
  await page.route('https://*.api.green-api.com/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname.includes('/getStateInstance/'))
      data = { stateInstance: options.unauthorized ? 'notAuthorized' : 'authorized' };
    else if (url.pathname.includes('/getSettings/'))
      data = { typeInstance: 'telegram', incomingWebhook: 'yes', webhookUrl: '' };
    else if (url.pathname.includes('/checkAccount/')) data = { exist: true, chatId: '12345678' };
    else if (url.pathname.includes('/sendMessage/')) {
      if (options.failSend) {
        await route.fulfill({ status: 500, json: { error: 'server error' } });
        return;
      }
      sent.push(route.request().postDataJSON());
      data = { idMessage: `sent-${sent.length}` };
    } else if (url.pathname.includes('/receiveNotification/')) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      data = queue.length ? { receiptId: ++receipt, body: queue.shift() } : null;
    } else if (url.pathname.includes('/deleteNotification/')) {
      deleted.push(Number(url.pathname.split('/').at(-1)));
      data = { result: true };
    }
    await route.fulfill({ json: data });
  });
  return { queue, sent, deleted, options };
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('idInstance', { exact: true }).fill('4100000000');
  await page.getByLabel('apiTokenInstance', { exact: true }).fill('test-token');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
}
async function createChat(page: Page) {
  await page.getByRole('button', { name: 'Новый чат', exact: true }).click();
  await page.getByLabel('Номер телефона').fill('+7 (999) 123-45-67');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать чат', exact: true }).click();
  await expect(page.getByRole('heading', { name: '+79991234567' })).toBeVisible();
}
test('login, create, send, receive, deduplicate, and logout', async ({ page }) => {
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
  await page.screenshot({ path: 'docs/screenshots/chat-desktop.png', fullPage: true });
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
test('mobile layout supports chat navigation and multiline drafts', async ({ page }) => {
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
  await page.screenshot({ path: 'docs/screenshots/chat-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Назад к чатам' }).click();
  await expect(page.getByRole('button', { name: 'Новый чат', exact: true })).toBeVisible();
  await page.locator('.chat-item').click();
  await expect(page.getByLabel('Сообщение', { exact: true })).toHaveValue(
    'Первая строка\nВторая строка',
  );
});
