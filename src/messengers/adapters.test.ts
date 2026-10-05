import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessengerAdapter, messengerInfo } from './adapters';
import type { MessengerId } from './types';
import type { Json } from '../api/green-api';
const credentials = {
  idInstance: '4100000000',
  apiTokenInstance: 'test-token',
  apiUrl: 'https://4100.api.green-api.com',
};
const signal = () => new AbortController().signal;
const incoming = (id: MessengerId, outgoing = false): Json => ({
  typeWebhook: outgoing ? 'outgoingAPIMessageReceived' : 'incomingMessageReceived',
  instanceData: { typeInstance: messengerInfo[id].instanceTypes[0] },
  idMessage: 'm1',
  timestamp: 1763115112,
  senderData: {
    chatId: id === 'whatsapp' ? '79991234567@c.us' : '12345',
    chatType: 'user',
    senderName: 'Анна',
    senderPhoneNumber: outgoing ? 79876543210 : 79991234567,
  },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Привет!' } },
});
afterEach(() => vi.unstubAllGlobals());
describe.each(['telegram', 'max', 'whatsapp'] as const)('%s adapter', (id) => {
  it('sends quoted replies using the provider quote ID without adding it to ordinary messages', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ idMessage: 'reply' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createMessengerAdapter(id, credentials);
    await api.sendMessage('123', 'Ответ', signal(), 'original');
    await api.sendMessage('123', 'Обычный текст', signal());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      chatId: '123',
      message: 'Ответ',
      quotedMessageId: 'original',
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('quotedMessageId');
  });
  it('loads flat text history, extended text and quotes chronologically, excluding media and deletions', async () => {
    const entry = (idMessage: string, timestamp: number, extra: Json = {}) => ({
      type: 'incoming',
      idMessage,
      timestamp,
      chatId: '123',
      typeMessage: 'textMessage',
      textMessage: idMessage,
      ...extra,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json([
        entry('reply', 104, {
          type: 'outgoing',
          statusMessage: 'read',
          typeMessage: 'quotedMessage',
          textMessage: undefined,
          extendedTextMessage: { text: 'Ответ', stanzaId: 'original' },
          quotedMessage: { stanzaId: 'original' },
        }),
        entry('link', 103, {
          typeMessage: 'extendedTextMessage',
          textMessage: undefined,
          extendedTextMessage: { text: 'https://example.com' },
        }),
        entry('original', 102),
        entry('photo', 101, { typeMessage: 'imageMessage', caption: 'Медиа' }),
        entry('deleted', 100, { isDeleted: true }),
        entry('removed-original', 99),
        entry('delete-event', 105, {
          typeMessage: 'deletedMessage',
          deletedMessageId: 'removed-original',
        }),
        entry('bad-date', -1),
        entry('original', 102),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const messages = await createMessengerAdapter(id, credentials).getChatHistory(
      '123',
      100,
      signal(),
    );
    expect(fetchMock.mock.calls[0][0]).toContain('/getChatHistory/test-token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ chatId: '123', count: 100 });
    expect(messages.map((message) => message.id)).toEqual(['original', 'link', 'reply']);
    expect(messages[2]).toMatchObject({
      outgoing: true,
      status: 'read',
      text: 'Ответ',
      quote: { id: 'original', text: 'original', outgoing: false },
    });
    expect(messages[0].status).toBeUndefined();
  });
  it('rejects malformed history and invalid counts while normalizing pending and failed statuses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ messages: [] }))
      .mockResolvedValueOnce(
        Response.json(
          ['pending', 'yellowCard', 'noAccount', 'delivered'].map((statusMessage, index) => ({
            type: 'outgoing',
            idMessage: String(index),
            timestamp: index + 1,
            typeMessage: 'textMessage',
            textMessage: 'Text',
            statusMessage,
          })),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = createMessengerAdapter(id, credentials);
    for (const count of [0, -1, 1.5, NaN, Infinity, 5001, Number.MAX_SAFE_INTEGER + 1])
      await expect(api.getChatHistory('123', count, signal())).rejects.toThrow('от 1 до 5000');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(api.getChatHistory('123', 100, signal())).rejects.toThrow('некорректную историю');
    const messages = await api.getChatHistory('123', 5000, signal());
    expect(messages.map((message) => message.status)).toEqual([
      'queued',
      'queued',
      'failed',
      'delivered',
    ]);
  });
  it('preserves quote references with and without embedded text in notifications', () => {
    const api = createMessengerAdapter(id, credentials);
    const body = incoming(id);
    expect(
      api.decodeNotification({
        ...body,
        messageData: {
          ...(body.messageData as Json),
          quotedMessage: { stanzaId: 'original', participant: '123' },
        },
      }),
    ).toMatchObject({ message: { quote: { id: 'original', text: '' } } });
    expect(
      api.decodeNotification({
        ...body,
        messageData: {
          typeMessage: 'quotedMessage',
          extendedTextMessageData: { text: 'Ответ', stanzaId: 'original' },
          quotedMessage: {
            stanzaId: 'original',
            typeMessage: 'textMessage',
            textMessage: 'Цитата',
          },
        },
      }),
    ).toMatchObject({ message: { text: 'Ответ', quote: { id: 'original', text: 'Цитата' } } });
  });
  it('checks authorization and compatible instance settings', async () => {
    const settings =
      id === 'whatsapp'
        ? { wid: '79876543210@c.us' }
        : { typeInstance: messengerInfo[id].instanceTypes[0] };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ stateInstance: 'authorized' }))
        .mockResolvedValueOnce(
          Response.json({ ...settings, incomingWebhook: 'no', webhookUrl: 'https://example.com' }),
        ),
    );
    expect(await createMessengerAdapter(id, credentials).connect(signal())).toHaveLength(2);
  });
  it('rejects credentials for another messenger', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ stateInstance: 'authorized' }))
        .mockResolvedValueOnce(
          Response.json({ typeInstance: id === 'telegram' ? 'v3' : 'telegram' }),
        ),
    );
    await expect(createMessengerAdapter(id, credentials).connect(signal())).rejects.toThrow(
      `Нужен инстанс ${messengerInfo[id].label}`,
    );
  });
  it('resolves a phone and sends using the returned identifier', async () => {
    const chatId = id === 'whatsapp' ? '123456789012345@lid' : '12345';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          id === 'whatsapp' ? { existsWhatsapp: true, chatId } : { exist: true, chatId },
        ),
      )
      .mockResolvedValueOnce(Response.json({ idMessage: 'msg1' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createMessengerAdapter(id, credentials);
    const recipient = await api.resolvePhone('+7 999 123-45-67', signal());
    await api.sendMessage(recipient.chatId, 'Привет!', signal());
    expect(fetchMock.mock.calls[0][0]).toContain(
      id === 'whatsapp' ? '/checkWhatsapp/' : '/checkAccount/',
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
      id === 'whatsapp' ? { chatId: '79991234567@c.us' } : { phoneNumber: 79991234567 },
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ chatId, message: 'Привет!' });
    expect(recipient.aliases).toEqual(id === 'whatsapp' ? ['79991234567@c.us'] : []);
  });
  it('rejects unknown and rate-limited accounts', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ exist: false, existsWhatsapp: false }))
        .mockResolvedValueOnce(Response.json({ status: false })),
    );
    const api = createMessengerAdapter(id, credentials);
    await expect(api.resolvePhone('79991234567', signal())).rejects.toThrow('не найден');
    await expect(api.resolvePhone('79991234567', signal())).rejects.toThrow('проверить номер');
  });
  it('enforces its text limit and accepts exactly the boundary length', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ idMessage: 'm1' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createMessengerAdapter(id, credentials);
    await expect(api.sendMessage('123', ' ', signal())).rejects.toThrow();
    await expect(
      api.sendMessage('123', 'x'.repeat(api.info.maxTextLength + 1), signal()),
    ).rejects.toThrow(String(api.info.maxTextLength));
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      api.sendMessage('123', 'x'.repeat(api.info.maxTextLength), signal()),
    ).resolves.toBe('m1');
  });
  it('normalizes messages and ignores media, foreign instances and invalid dates', () => {
    const api = createMessengerAdapter(id, credentials);
    expect(api.decodeNotification(incoming(id))).toMatchObject({
      type: 'message',
      name: 'Анна',
      phone: '79991234567',
      message: { text: 'Привет!', outgoing: false, timestamp: 1763115112000 },
    });
    expect(api.decodeNotification(incoming(id, true))).toMatchObject({
      type: 'message',
      phone: undefined,
      message: { outgoing: true, status: 'sent' },
    });
    for (const timestamp of [NaN, Infinity, -1, 1e20])
      expect(api.decodeNotification({ ...incoming(id), timestamp })).toBeNull();
    expect(
      api.decodeNotification({ ...incoming(id), messageData: { typeMessage: 'imageMessage' } }),
    ).toBeNull();
    expect(
      api.decodeNotification({
        ...incoming(id),
        instanceData: { typeInstance: 'another-messenger' },
      }),
    ).toBeNull();
    const group = {
      ...incoming(id),
      senderData: {
        chatId: id === 'whatsapp' ? '12000000@g.us' : '-100123',
        chatType: 'group',
        chatName: 'Группа',
        senderPhoneNumber: 79991234567,
      },
    };
    expect(api.decodeNotification(group)).toMatchObject({ type: 'message', phone: undefined });
  });
  it('supports text with links and textual quoted replies', () => {
    const api = createMessengerAdapter(id, credentials);
    for (const typeMessage of ['extendedTextMessage', 'quotedMessage']) {
      expect(
        api.decodeNotification({
          ...incoming(id),
          messageData: { typeMessage, extendedTextMessageData: { text: 'https://example.com' } },
        }),
      ).toMatchObject({ type: 'message', message: { text: 'https://example.com' } });
    }
  });
  it('normalizes state and delivery failures including missing message IDs', () => {
    const api = createMessengerAdapter(id, credentials);
    expect(
      api.decodeNotification({
        typeWebhook: 'stateInstanceChanged',
        stateInstance: 'notAuthorized',
      }),
    ).toEqual({ type: 'state', state: 'notAuthorized' });
    for (const status of ['failed', 'noAccount'])
      expect(
        api.decodeNotification({ typeWebhook: 'outgoingMessageStatus', chatId: '123', status }),
      ).toMatchObject({
        type: 'delivery',
        status: 'failed',
        messageId: undefined,
        errorMessage: expect.stringContaining(api.info.label),
      });
    expect(
      api.decodeNotification({
        typeWebhook: 'outgoingMessageStatus',
        chatId: '123',
        idMessage: 'm1',
        status: 'noAccount',
      }),
    ).toMatchObject({ type: 'delivery', messageId: 'm1', status: 'failed' });
  });
});
it('MAX validates country and length before calling CheckAccount', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ exist: true, chatId: '123' }));
  vi.stubGlobal('fetch', fetchMock);
  const api = createMessengerAdapter('max', credentials);
  await expect(api.resolvePhone('+1 202 555 0123', signal())).rejects.toThrow('РФ');
  await expect(api.resolvePhone('+7 999 123', signal())).rejects.toThrow('11 цифр');
  expect(fetchMock).not.toHaveBeenCalled();
  await expect(api.resolvePhone('+375 29 123-45-67', signal())).resolves.toMatchObject({
    chatId: '123',
    phone: '375291234567',
  });
});
it('WhatsApp supports old responses without LID and rejects malformed newer identifiers', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ existsWhatsapp: true }))
      .mockResolvedValueOnce(Response.json({ existsWhatsapp: true, chatId: 'invalid' })),
  );
  const api = createMessengerAdapter('whatsapp', credentials);
  await expect(api.resolvePhone('79991234567', signal())).resolves.toEqual({
    chatId: '79991234567@c.us',
    phone: '79991234567',
    aliases: [],
  });
  await expect(api.resolvePhone('79991234567', signal())).rejects.toThrow('идентификатор');
});
