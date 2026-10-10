import { test, expect, type Page } from '@playwright/test';
import type { MessengerId } from '../src/messengers/types';
const providerFixtures = {
  telegram: { instance: '4100000000', type: 'telegram', label: 'Telegram', limit: 4096 },
  max: { instance: '3100000000', type: 'v3', label: 'MAX', limit: 4000 },
  whatsapp: { instance: '1101000000', type: 'whatsapp', label: 'WhatsApp', limit: 20000 },
};
async function mockApi(
  page: Page,
  options: {
    messenger?: MessengerId;
    instanceType?: string;
    unauthorized?: boolean;
    failSend?: boolean;
    holdSend?: Promise<void>;
    pollUnauthorized?: boolean;
    settingsDisabled?: boolean;
    history?: object[];
    failHistory?: boolean;
    holdHistory?: Promise<void>;
  } = {},
) {
  const messenger = options.messenger ?? 'telegram';
  const checks: { method: string; body: object }[] = [];
  const queue: object[] = [];
  const sent: object[] = [];
  const deleted: number[] = [];
  const historyRequests: { chatId: string; count: number }[] = [];
  let receipt = 1;
  let sendStarted = 0;
  await page.route('https://*.api.green-api.com/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname.includes('/getStateInstance/'))
      data = { stateInstance: options.unauthorized ? 'notAuthorized' : 'authorized' };
    else if (url.pathname.includes('/getSettings/'))
      data = {
        ...(messenger === 'whatsapp' && !options.instanceType
          ? { wid: '79876543210@c.us' }
          : { typeInstance: options.instanceType ?? providerFixtures[messenger].type }),
        incomingWebhook: options.settingsDisabled ? 'no' : 'yes',
        webhookUrl: '',
      };
    else if (url.pathname.includes('/checkAccount/') || url.pathname.includes('/checkWhatsapp/')) {
      const body = route.request().postDataJSON();
      checks.push({
        method: url.pathname.includes('/checkWhatsapp/') ? 'checkWhatsapp' : 'checkAccount',
        body,
      });
      const first = body.phoneNumber === 79991234567 || body.chatId === '79991234567@c.us';
      const chatId = first ? '12345678' : '87654321';
      data =
        messenger === 'whatsapp'
          ? { existsWhatsapp: true, chatId: `${chatId}@lid` }
          : { exist: true, chatId };
    } else if (url.pathname.includes('/getChatHistory/')) {
      const body = route.request().postDataJSON();
      historyRequests.push(body);
      if (options.holdHistory) await options.holdHistory;
      if (options.failHistory) {
        await route.fulfill({ status: 500, json: {} });
        return;
      }
      data = options.history ?? [];
    } else if (url.pathname.includes('/sendMessage/')) {
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
      await new Promise((resolve) => setTimeout(resolve, queue.length ? 10 : 100));
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
    checks,
    queue,
    sent,
    deleted,
    historyRequests,
    options,
    get sendStarted() {
      return sendStarted;
    },
  };
}
async function login(page: Page, messenger: MessengerId = 'telegram') {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Мессенджер' }).selectOption(messenger);
  await page.getByLabel('idInstance', { exact: true }).fill(providerFixtures[messenger].instance);
  await page.getByLabel('apiTokenInstance', { exact: true }).fill('test-token');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
}
async function createChat(page: Page, phone = '+7 (999) 123-45-67') {
  await page.getByRole('button', { name: 'Новый чат', exact: true }).click();
  await page.getByLabel('Номер телефона').fill(phone);
  await page.getByRole('dialog').getByRole('button', { name: 'Создать чат', exact: true }).click();
  await expect(page.getByRole('heading', { name: `+${phone.replace(/\D/g, '')}` })).toBeVisible();
}
async function openChatSearch(page: Page) {
  await page.getByLabel('Действия чата', { exact: true }).click();
  await page.getByRole('button', { name: 'Поиск по сообщениям', exact: true }).click();
}
async function openHistoryTools(page: Page) {
  if (await page.locator('.history-toolbar').isVisible()) return;
  await page.getByLabel('Действия чата', { exact: true }).click();
  await page.getByRole('button', { name: 'Управление историей', exact: true }).click();
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
  const api = await mockApi(page, {
    history: Array.from({ length: 45 }, (_, index) => ({
      type: 'incoming',
      idMessage: `history-${index}`,
      timestamp: 1763115112 + index,
      typeMessage: 'textMessage',
      textMessage: `Сообщение ${index}\nНесколько строк\nДля проверки истории`,
    })),
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await createChat(page);
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
for (const messenger of ['max', 'whatsapp'] as const) {
  test(`${messenger}: selects adapter, resolves recipient, sends and receives in one chat`, async ({
    page,
  }, testInfo) => {
    const api = await mockApi(page, { messenger });
    await login(page, messenger);
    await createChat(page);
    const fixture = providerFixtures[messenger];
    await expect(page.locator('.sidebar-header')).toContainText(fixture.label);
    await expect(page.getByLabel('Сообщение', { exact: true })).toHaveAttribute(
      'maxlength',
      String(fixture.limit),
    );
    await page.getByLabel('Сообщение', { exact: true }).fill(`Привет из ${fixture.label}!`);
    await page.getByRole('button', { name: 'Отправить сообщение' }).click();
    await expect(page.getByRole('log')).toContainText(`Привет из ${fixture.label}!`);
    const canonicalId = messenger === 'whatsapp' ? '12345678@lid' : '12345678';
    const replyId = messenger === 'whatsapp' ? '79991234567@c.us' : canonicalId;
    expect(api.sent).toEqual([{ chatId: canonicalId, message: `Привет из ${fixture.label}!` }]);
    expect(api.checks).toEqual([
      {
        method: messenger === 'whatsapp' ? 'checkWhatsapp' : 'checkAccount',
        body:
          messenger === 'whatsapp' ? { chatId: '79991234567@c.us' } : { phoneNumber: 79991234567 },
      },
    ]);
    api.queue.push({
      typeWebhook: 'incomingMessageReceived',
      instanceData: { typeInstance: fixture.type },
      idMessage: 'reply',
      timestamp: Math.floor(Date.now() / 1000),
      senderData: {
        chatId: replyId,
        chatType: 'user',
        senderName: 'Анна',
        senderPhoneNumber: 79991234567,
      },
      messageData: {
        typeMessage: 'textMessage',
        textMessageData: { textMessage: `Ответ из ${fixture.label}` },
      },
    });
    api.queue.push({
      typeWebhook: 'outgoingMessageStatus',
      instanceData: { typeInstance: fixture.type },
      chatId: replyId,
      idMessage: 'sent-1',
      status: 'read',
    });
    await expect(page.getByRole('log')).toContainText(`Ответ из ${fixture.label}`);
    await expect(page.getByLabel('Прочитано')).toBeVisible();
    await expect(page.locator('.chat-item')).toHaveCount(1);
    await expect.poll(() => api.deleted.length).toBe(2);
    await page.screenshot({ path: testInfo.outputPath(`${messenger}-chat.png`), fullPage: true });
  });
}
test('switching messenger resets credentials and rejects a mismatched instance', async ({
  page,
}) => {
  await mockApi(page, { messenger: 'max', instanceType: 'telegram' });
  await page.goto('/');
  await page.getByLabel('idInstance', { exact: true }).fill('4100000000');
  await page.getByLabel('apiTokenInstance', { exact: true }).fill('old-token');
  await page.getByRole('button', { name: 'Показать токен' }).click();
  await expect(page.getByLabel('apiTokenInstance', { exact: true })).toHaveAttribute(
    'type',
    'text',
  );
  await page.getByRole('combobox', { name: 'Мессенджер' }).selectOption('max');
  await expect(page.getByLabel('idInstance', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('apiTokenInstance', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('apiTokenInstance', { exact: true })).toHaveAttribute(
    'type',
    'password',
  );
  await expect(page).toHaveTitle('Линия · MAX — GREEN-API');
  await page.getByLabel('idInstance', { exact: true }).fill('3100000000');
  await page.getByLabel('apiTokenInstance', { exact: true }).fill('new-token');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Нужен инстанс MAX');
});

for (const messenger of ['telegram', 'max', 'whatsapp'] as const) {
  test(`${messenger}: restores history, searches and sends a quoted reply`, async ({
    page,
  }, testInfo) => {
    const chatId = messenger === 'whatsapp' ? '12345678@lid' : '12345678';
    const api = await mockApi(page, {
      messenger,
      history: [
        {
          type: 'incoming',
          idMessage: 'history-1',
          timestamp: 1763115112,
          typeMessage: 'textMessage',
          chatId,
          textMessage: 'Обсудим проект завтра',
        },
        {
          type: 'outgoing',
          idMessage: 'history-2',
          timestamp: 1763115113,
          typeMessage: 'textMessage',
          chatId,
          textMessage: 'Проект готов к проверке',
          statusMessage: 'read',
        },
      ],
    });
    await login(page, messenger);
    await createChat(page);
    await expect(page.getByRole('log')).toContainText('Обсудим проект завтра');
    expect(api.historyRequests).toEqual([{ chatId, count: 100 }]);
    await openHistoryTools(page);
    await page.getByRole('button', { name: 'Обновить историю', exact: true }).click();
    await expect.poll(() => api.historyRequests.length).toBe(2);
    await expect(page.getByRole('log').locator('.bubble')).toHaveCount(2);
    await openChatSearch(page);
    const query = page.getByRole('textbox', { name: 'Текст для поиска' });
    await expect(query).toBeFocused();
    await query.fill('ПРОЕКТ');
    await expect(page.locator('.search-count')).toHaveText('1 из 2');
    await expect(page.getByRole('log').locator('mark')).toHaveCount(2);
    await query.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await expect(page.locator('.search-count')).toHaveText('1 из 2');
    await page.getByRole('button', { name: 'Следующее совпадение' }).click();
    await expect(page.locator('.search-count')).toHaveText('2 из 2');
    await expect(page.locator('.bubble.search-match')).toContainText('Проект готов');
    await query.fill('отсутствующее');
    await expect(page.locator('.search-count')).toHaveText('Не найдено');
    await expect(page.getByRole('button', { name: 'Следующее совпадение' })).toBeDisabled();
    await query.press('Escape');
    await expect(query).not.toBeVisible();
    await page
      .getByRole('button', { name: 'Ответить на сообщение: Обсудим проект завтра', exact: true })
      .click();
    await expect(page.getByLabel('Цитируемое сообщение')).toContainText('Обсудим проект завтра');
    await page.getByLabel('Сообщение', { exact: true }).fill('Давайте в 10:00');
    await page.getByLabel('Сообщение', { exact: true }).press('Enter');
    await expect(page.getByRole('log')).toContainText('Давайте в 10:00');
    expect(api.sent).toEqual([
      { chatId, message: 'Давайте в 10:00', quotedMessageId: 'history-1' },
    ]);
    await expect(page.getByLabel('Цитируемое сообщение')).not.toBeVisible();
    await expect(page.locator('.quoted-message')).toContainText('Обсудим проект завтра');
    await page.getByRole('button', { name: 'Загрузить больше', exact: true }).click();
    await expect.poll(() => api.historyRequests.at(-1)?.count).toBe(500);
    await expect(page.getByRole('log').locator('.bubble')).toHaveCount(3);
    await page.screenshot({
      path: testInfo.outputPath(`${messenger}-features.png`),
      fullPage: true,
    });
    await page.reload();
    await page.getByRole('combobox', { name: 'Мессенджер' }).selectOption(messenger);
    await page.getByLabel('idInstance', { exact: true }).fill(providerFixtures[messenger].instance);
    await page.getByLabel('apiTokenInstance', { exact: true }).fill('test-token');
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    await createChat(page);
    await expect(page.getByRole('log')).toContainText('Обсудим проект завтра');
  });
}
test('history failure is recoverable and preserves a quote and draft after send failure', async ({
  page,
}) => {
  const api = await mockApi(page, { failHistory: true, failSend: true });
  await login(page);
  await createChat(page);
  await expect(page.getByRole('alert')).toContainText('Текущая переписка доступна');
  api.options.failHistory = false;
  api.options.history = [
    {
      type: 'incoming',
      idMessage: 'history-1',
      timestamp: 1763115112,
      typeMessage: 'textMessage',
      textMessage: 'Сохранить цитату',
    },
  ];
  await page.getByRole('button', { name: 'Повторить загрузку истории' }).click();
  await expect(page.getByRole('log')).toContainText('Сохранить цитату');
  await page
    .getByRole('button', { name: 'Ответить на сообщение: Сохранить цитату', exact: true })
    .click();
  await page.getByLabel('Сообщение', { exact: true }).fill('Ответ');
  await page.getByLabel('Сообщение', { exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('Текст сохранен');
  await expect(page.getByLabel('Цитируемое сообщение')).toContainText('Сохранить цитату');
  await expect(page.getByLabel('Сообщение', { exact: true })).toHaveValue('Ответ');
  await page.getByRole('button', { name: 'Отменить ответ' }).click();
  await expect(page.getByLabel('Цитируемое сообщение')).not.toBeVisible();
});

type NotificationHarness = {
  permissionRequests: number;
  created: { title: string; body: string; tag: string }[];
  closed: number;
  background: boolean;
  clickLast: () => void;
};
async function mockNotifications(page: Page, result: 'granted' | 'denied') {
  await page.addInitScript((permissionResult) => {
    const state = {
      permissionRequests: 0,
      created: [] as { title: string; body: string; tag: string }[],
      closed: 0,
      background: false,
      clickLast: () => {},
    };
    class FakeNotification {
      static permission = 'default';
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      static async requestPermission() {
        state.permissionRequests++;
        FakeNotification.permission = permissionResult;
        return permissionResult;
      }
      constructor(title: string, options: { body: string; tag: string }) {
        state.created.push({ title, ...options });
        state.clickLast = () => this.onclick?.();
      }
      close() {
        state.closed++;
      }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: FakeNotification });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (state.background ? 'hidden' : 'visible'),
    });
    document.hasFocus = () => !state.background;
    window.focus = () => {
      state.background = false;
    };
    (window as typeof window & { notificationTest: typeof state }).notificationTest = state;
  }, result);
}
test('notifications require opt-in, ignore history and duplicates, open the chat and close on logout', async ({
  page,
}) => {
  await mockNotifications(page, 'granted');
  const api = await mockApi(page);
  await login(page);
  await createChat(page);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { notificationTest: NotificationHarness }).notificationTest
          .permissionRequests,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: 'Включить уведомления', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Выключить уведомления', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { notificationTest: NotificationHarness }).notificationTest
          .permissionRequests,
    ),
  ).toBe(1);
  const incoming = (id: string) => ({
    typeWebhook: 'incomingMessageReceived',
    idMessage: id,
    timestamp: Math.floor(Date.now() / 1000),
    senderData: { chatId: '87654321', senderName: 'Борис', senderPhoneNumber: 79992223344 },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: 'Пришел новый ответ' },
    },
  });
  api.queue.push(incoming('visible'));
  await expect.poll(() => api.deleted.length).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { notificationTest: NotificationHarness }).notificationTest
          .created.length,
    ),
  ).toBe(0);
  await page.evaluate(() => {
    (
      window as typeof window & { notificationTest: NotificationHarness }
    ).notificationTest.background = true;
  });
  api.options.history = [
    {
      type: 'incoming',
      idMessage: 'old-history',
      timestamp: 1763115100,
      typeMessage: 'textMessage',
      textMessage: 'Ранее полученный текст',
    },
  ];
  await openHistoryTools(page);
  await page.getByRole('button', { name: 'Обновить историю', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Ранее полученный текст');
  api.queue.push(
    { ...incoming('stale'), timestamp: 1763115100 },
    incoming('background'),
    incoming('background'),
  );
  await expect.poll(() => api.deleted.length).toBe(4);
  const created = await page.evaluate(
    () =>
      (window as typeof window & { notificationTest: NotificationHarness }).notificationTest
        .created,
  );
  expect(created).toHaveLength(1);
  expect(created[0].title).toBe('Борис');
  expect(created[0].body).toBe('Пришел новый ответ');
  await page.evaluate(() => {
    (
      window as typeof window & { notificationTest: NotificationHarness }
    ).notificationTest.clickLast();
  });
  await expect(page.getByRole('heading', { name: 'Борис', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { notificationTest: NotificationHarness }).notificationTest
            .closed,
      ),
    )
    .toBe(1);
  await page.evaluate(() => {
    (
      window as typeof window & { notificationTest: NotificationHarness }
    ).notificationTest.background = true;
  });
  api.queue.push(incoming('logout'));
  await expect.poll(() => api.deleted.length).toBe(5);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { notificationTest: NotificationHarness }).notificationTest
            .closed,
      ),
    )
    .toBe(2);
});
test('denied notification permission explains how to enable it without breaking chat', async ({
  page,
}) => {
  await mockNotifications(page, 'denied');
  await mockApi(page);
  await login(page);
  await page.getByRole('button', { name: 'Включить уведомления', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Уведомления заблокированы' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть подсказку уведомлений' }).click();
  await createChat(page);
  await page.getByLabel('Сообщение', { exact: true }).fill('Можно продолжить');
  await page.getByLabel('Сообщение', { exact: true }).press('Enter');
  await expect(page.getByRole('log')).toContainText('Можно продолжить');
});
test('late history merges with a live response while preserving the active chat', async ({
  page,
}) => {
  let releaseHistory!: () => void;
  const holdHistory = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  const api = await mockApi(page, {
    holdHistory,
    history: [
      {
        type: 'incoming',
        idMessage: 'live-first',
        timestamp: 1763115112,
        typeMessage: 'textMessage',
        textMessage: 'Ответ до истории',
      },
      {
        type: 'incoming',
        idMessage: 'older',
        timestamp: 1763115100,
        typeMessage: 'textMessage',
        textMessage: 'Более раннее сообщение',
      },
    ],
  });
  await login(page);
  await createChat(page);
  api.queue.push({
    typeWebhook: 'incomingMessageReceived',
    idMessage: 'live-first',
    timestamp: 1763115112,
    senderData: { chatId: '12345678', senderName: 'Анна' },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: 'Ответ до истории' },
    },
  });
  await expect(page.getByRole('log')).toContainText('Ответ до истории');
  releaseHistory();
  await expect(page.getByRole('log')).toContainText('Более раннее сообщение');
  await expect(page.getByRole('log').getByText('Ответ до истории', { exact: true })).toHaveCount(1);
  await expect(page.locator('.chat-item')).toHaveCount(1);
});

test('history expansion preserves the visible message for older and newer additions', async ({
  page,
}) => {
  const history = Array.from({ length: 35 }, (_, index) => ({
    type: 'incoming',
    idMessage: `anchor-${index}`,
    timestamp: 1763115112 + index,
    typeMessage: 'textMessage',
    textMessage: `История ${index}\nСтрока два\nСтрока три`,
  }));
  const api = await mockApi(page, { history });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await createChat(page);
  await expect(page.getByRole('log')).toContainText('История 34');
  await openHistoryTools(page);
  await page.getByRole('log').evaluate((element) => {
    element.scrollTop = 150;
  });
  await expect.poll(() => page.getByRole('log').evaluate((element) => element.scrollTop)).toBe(150);
  const anchor = page
    .getByRole('log')
    .getByText('История 2\nСтрока два\nСтрока три', { exact: true });
  const before = (await anchor.boundingBox())!.y;
  api.options.history = [
    {
      type: 'incoming',
      idMessage: 'much-older',
      timestamp: 1763115000,
      typeMessage: 'textMessage',
      textMessage: 'Самое раннее сообщение',
    },
    ...history,
    {
      type: 'incoming',
      idMessage: 'newer',
      timestamp: 1763116000,
      typeMessage: 'textMessage',
      textMessage: 'Ответ из обновленной истории',
    },
  ];
  await openHistoryTools(page);
  await page.getByRole('button', { name: 'Обновить историю', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Самое раннее сообщение');
  await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(2);
  const beforeAppend = (await anchor.boundingBox())!.y;
  api.options.history.push({
    type: 'incoming',
    idMessage: 'newest',
    timestamp: 1763116001,
    typeMessage: 'textMessage',
    textMessage: 'Только новое сообщение снизу',
  });
  await openHistoryTools(page);
  await page.getByRole('button', { name: 'Обновить историю', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Только новое сообщение снизу');
  await expect
    .poll(async () => Math.abs((await anchor.boundingBox())!.y - beforeAppend))
    .toBeLessThan(2);
});
test('mobile search and quote controls stay accessible and cancellation restores focus', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, {
    history: [
      {
        type: 'incoming',
        idMessage: 'mobile-source',
        timestamp: 1763115112,
        typeMessage: 'textMessage',
        textMessage: 'Проверка мобильного поиска',
      },
    ],
  });
  await login(page);
  await createChat(page);
  await expect(page.getByRole('log')).toContainText('Проверка мобильного поиска');
  await openChatSearch(page);
  await page.getByLabel('Текст для поиска').fill('мобильного');
  await expect(page.locator('.search-count')).toHaveText('1 из 1');
  await page.getByRole('button', { name: 'Закрыть поиск сообщений' }).click();
  await page
    .getByRole('button', { name: 'Ответить на сообщение: Проверка мобильного поиска', exact: true })
    .click();
  await expect(page.getByLabel('Сообщение', { exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('mobile-features.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Отменить ответ' }).click();
  await expect(page.getByLabel('Сообщение', { exact: true })).toBeFocused();
});

test('chat actions keep the main screen simple and support keyboard dismissal', async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await createChat(page);
  await expect(page.locator('.history-toolbar')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Поиск по сообщениям', exact: true }),
  ).not.toBeVisible();
  const trigger = page.getByLabel('Действия чата', { exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('button', { name: 'Управление историей' })).toBeVisible();
  await trigger.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('.chat-tools')).not.toHaveAttribute('open', '');
  await trigger.click();
  await page.getByLabel('Сообщение', { exact: true }).click();
  await expect(page.locator('.chat-tools')).not.toHaveAttribute('open', '');
  await openHistoryTools(page);
  await expect(page.getByRole('button', { name: 'Обновить историю', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть управление историей' }).click();
  await expect(page.locator('.history-toolbar')).not.toBeVisible();
});
test('captures desktop, mobile, search and login presentation screens', async ({
  page,
}, testInfo) => {
  const base = Math.floor(Date.now() / 1000) - 3600;
  const api = await mockApi(page, {
    history: [
      {
        type: 'incoming',
        idMessage: 'show-1',
        timestamp: base,
        typeMessage: 'textMessage',
        textMessage: 'Привет! Посмотрела фотографии с выходных. Очень красиво получилось.',
      },
      {
        type: 'outgoing',
        idMessage: 'show-2',
        timestamp: base + 120,
        typeMessage: 'textMessage',
        textMessage: 'Спасибо! В следующий раз давай съездим вместе.',
        statusMessage: 'read',
      },
      {
        type: 'incoming',
        idMessage: 'show-3',
        timestamp: base + 180,
        typeMessage: 'textMessage',
        textMessage:
          'Давай сегодня обсудим планы на следующую поездку?\nБуду свободна после 16:00.',
      },
      {
        type: 'outgoing',
        idMessage: 'show-4',
        timestamp: base + 240,
        typeMessage: 'quotedMessage',
        extendedTextMessage: {
          text: 'Да, договорились. Пришлю ссылку ближе к четырём.',
          stanzaId: 'show-3',
        },
        statusMessage: 'read',
      },
    ],
  });
  await page.goto('/');
  const connect = await page
    .getByRole('button', { name: 'Подключиться', exact: true })
    .boundingBox();
  expect(connect!.y + connect!.height).toBeLessThanOrEqual(720);
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
  await login(page);
  await createChat(page);
  await expect(page.getByRole('log')).toContainText('Пришлю ссылку');
  api.queue.push({
    typeWebhook: 'incomingMessageReceived',
    idMessage: 'show-5',
    timestamp: base + 300,
    senderData: { chatId: '12345678', senderName: 'Анна Смирнова', senderPhoneNumber: 79991234567 },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: 'Отлично, до встречи!' },
    },
  });
  await expect(page.getByRole('heading', { name: 'Анна Смирнова', exact: true })).toBeVisible();
  await expect(page.getByRole('log')).toContainText('Отлично, до встречи!');
  await page.getByLabel('Сообщение', { exact: true }).fill('До встречи, Анна');
  await page.screenshot({ path: testInfo.outputPath('chat-desktop.png'), fullPage: true });
  await openChatSearch(page);
  await page.getByLabel('Текст для поиска').fill('ссылку');
  await expect(page.locator('.search-count')).toHaveText('1 из 1');
  await page.screenshot({ path: testInfo.outputPath('message-search.png'), fullPage: true });
  await page.getByRole('button', { name: 'Закрыть поиск сообщений' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Ответить на сообщение: Отлично, до встречи!', exact: true })
    .click();
  await expect(page.getByLabel('Цитируемое сообщение')).toBeVisible();
  await page.getByRole('log').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.screenshot({ path: testInfo.outputPath('chat-mobile.png'), fullPage: true });
  await page.getByLabel('Действия чата', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Включить уведомления', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('chat-menu-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
