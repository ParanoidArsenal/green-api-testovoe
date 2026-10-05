import { expect, it } from 'vitest';
import { chatReducer, initialState } from './state';
import type { ChatEvent, Message } from './events';
const message = (id = 'm1', outgoing = false, status?: Message['status']): Message => ({
  id,
  text: 'Привет!',
  timestamp: 1763115112000,
  outgoing,
  status,
});
const incoming = (chatId = '123', id = 'm1'): ChatEvent => ({
  type: 'message',
  chatId,
  name: 'Анна',
  phone: '79991234567',
  message: message(id),
});
it('routes a reply into the phone-created chat', () => {
  const opened = chatReducer(initialState, {
    type: 'open',
    id: '123',
    name: '+79991234567',
    phone: '79991234567',
  });
  const received = chatReducer(opened, { type: 'event', event: incoming() });
  expect(received.chats).toHaveLength(1);
  expect(received.chats[0].name).toBe('Анна');
  expect(received.chats[0].messages[0].text).toBe('Привет!');
  expect(received.chats[0].unread).toBe(0);
});
it('deduplicates redelivery without incrementing unread counts', () => {
  const received = chatReducer(initialState, { type: 'event', event: incoming() });
  expect(chatReducer(received, { type: 'event', event: incoming() })).toBe(received);
  expect(received.chats[0].unread).toBe(1);
  expect(chatReducer(received, { type: 'select', id: '123' }).chats[0].unread).toBe(0);
});
it('handles early delivery status without regressing read status', () => {
  const status = chatReducer(initialState, {
    type: 'event',
    event: { type: 'delivery', chatId: '123', messageId: 'm1', status: 'read' },
  });
  const sent = chatReducer(status, {
    type: 'sent',
    chatId: '123',
    message: message('m1', true, 'queued'),
  });
  expect(sent.chats[0].messages[0].status).toBe('read');
  const late = chatReducer(sent, {
    type: 'event',
    event: { type: 'delivery', chatId: '123', messageId: 'm1', status: 'sent' },
  });
  expect(late.chats[0].messages[0].status).toBe('read');
});
it('preserves send-before-reply order within a second', () => {
  const sent = chatReducer(initialState, {
    type: 'sent',
    chatId: '123',
    message: { ...message('outgoing', true, 'queued'), timestamp: 1763115112999 },
  });
  const reply = chatReducer(sent, { type: 'event', event: incoming() });
  expect(reply.chats[0].messages.map((value) => value.id)).toEqual(['outgoing', 'm1']);
});
it('merges late outgoing echoes without duplicates or status regression', () => {
  const sent = chatReducer(initialState, {
    type: 'sent',
    chatId: '123',
    message: message('m1', true, 'queued'),
  });
  const echo: ChatEvent = { type: 'message', chatId: '123', message: message('m1', true, 'sent') };
  const echoed = chatReducer(sent, { type: 'event', event: echo });
  expect(echoed.chats[0].messages).toHaveLength(1);
  expect(echoed.chats[0].messages[0].status).toBe('sent');
  const read = chatReducer(echoed, {
    type: 'event',
    event: { type: 'delivery', chatId: '123', messageId: 'm1', status: 'read' },
  });
  expect(chatReducer(read, { type: 'event', event: echo }).chats[0].messages[0].status).toBe(
    'read',
  );
});
it('reports and dismisses a failure without guessing a message ID', () => {
  const result = chatReducer(initialState, {
    type: 'event',
    event: {
      type: 'delivery',
      chatId: '123',
      status: 'failed',
      errorMessage: 'Ошибка мессенджера',
    },
  });
  expect(result.deliveryError).toEqual({ chatId: '123', message: 'Ошибка мессенджера' });
  expect(result.statuses).toEqual({});
  expect(chatReducer(result, { type: 'dismissDeliveryError' }).deliveryError).toBeNull();
});
it('routes phone and LID replies and delivery statuses to the same chat', () => {
  const opened = chatReducer(initialState, {
    type: 'open',
    id: '12345@lid',
    name: '+79991234567',
    phone: '79991234567',
    aliases: ['79991234567@c.us'],
  });
  const reply = chatReducer(opened, { type: 'event', event: incoming('79991234567@c.us') });
  expect(reply.chats).toHaveLength(1);
  expect(reply.chats[0].unread).toBe(0);
  const sent = chatReducer(reply, {
    type: 'sent',
    chatId: '12345@lid',
    message: message('sent', true, 'queued'),
  });
  const delivered = chatReducer(sent, {
    type: 'event',
    event: { type: 'delivery', chatId: '79991234567@c.us', messageId: 'sent', status: 'delivered' },
  });
  expect(delivered.chats[0].messages[1].status).toBe('delivered');
});
it('keeps early alias delivery statuses until a canonical message arrives', () => {
  const status = chatReducer(initialState, {
    type: 'event',
    event: { type: 'delivery', chatId: '79991234567@c.us', messageId: 'sent', status: 'read' },
  });
  const opened = chatReducer(status, {
    type: 'open',
    id: '12345@lid',
    name: '+79991234567',
    phone: '79991234567',
    aliases: ['79991234567@c.us'],
  });
  const sent = chatReducer(opened, {
    type: 'sent',
    chatId: '12345@lid',
    message: message('sent', true, 'queued'),
  });
  expect(sent.chats[0].messages[0].status).toBe('read');
});
it('merges phone and LID chats already created by incoming notifications', () => {
  const phoneChat = chatReducer(initialState, {
    type: 'event',
    event: incoming('79991234567@c.us'),
  });
  const lidChat = chatReducer(phoneChat, { type: 'event', event: incoming('12345@lid', 'm2') });
  const opened = chatReducer(lidChat, {
    type: 'open',
    id: '12345@lid',
    name: '+79991234567',
    phone: '79991234567',
    aliases: ['79991234567@c.us'],
  });
  expect(opened.chats).toHaveLength(1);
  expect(opened.chats[0].messages).toHaveLength(2);
  expect(opened.chats[0].unread).toBe(0);
  expect(
    chatReducer(opened, { type: 'event', event: incoming('79991234567@c.us') }).chats[0].messages,
  ).toHaveLength(2);
  const activePhone = chatReducer(lidChat, { type: 'select', id: '79991234567@c.us' });
  const mergedActive = chatReducer(activePhone, {
    type: 'open',
    id: '12345@lid',
    name: '+79991234567',
    phone: '79991234567',
    aliases: ['79991234567@c.us'],
  });
  expect(mergedActive.activeId).toBe('79991234567@c.us');
  expect(mergedActive.chats[0].aliases).toContain('12345@lid');
  expect(
    chatReducer(mergedActive, {
      type: 'sent',
      chatId: '79991234567@c.us',
      message: message('pending', true, 'queued'),
    }).chats,
  ).toHaveLength(1);
});

it('merges history with live messages without duplicating messages or unread counts', () => {
  const live = chatReducer(initialState, { type: 'event', event: incoming() });
  const loaded = chatReducer(live, {
    type: 'history',
    chatId: '123',
    messages: [message(), { ...message('older'), timestamp: 1763115012000 }],
  });
  expect(loaded.chats[0].messages.map((item) => item.id)).toEqual(['older', 'm1']);
  expect(loaded.chats[0].unread).toBe(1);
  expect(chatReducer(loaded, { type: 'history', chatId: 'unknown', messages: [message()] })).toBe(
    loaded,
  );
});
it('keeps advanced statuses and quote details when stale history arrives', () => {
  const sent = chatReducer(initialState, {
    type: 'sent',
    chatId: '123',
    message: {
      ...message('sent', true, 'read'),
      quote: { id: 'original', text: 'Локальная цитата' },
    },
  });
  const loaded = chatReducer(sent, {
    type: 'history',
    chatId: '123',
    messages: [message('sent', true, 'sent')],
  });
  expect(loaded.chats[0].messages[0].status).toBe('read');
  expect(loaded.chats[0].messages[0].quote?.text).toBe('Локальная цитата');
});
it('applies early alias statuses to a history message without marking history unread', () => {
  const early = chatReducer(initialState, {
    type: 'event',
    event: {
      type: 'delivery',
      chatId: '79991234567@c.us',
      messageId: 'sent',
      status: 'read',
    },
  });
  const opened = chatReducer(early, {
    type: 'open',
    id: '123@lid',
    phone: '79991234567',
    name: 'Анна',
    aliases: ['79991234567@c.us'],
  });
  const loaded = chatReducer(opened, {
    type: 'history',
    chatId: '79991234567@c.us',
    messages: [message('sent', true, 'queued')],
  });
  expect(loaded.chats).toHaveLength(1);
  expect(loaded.chats[0].messages[0].status).toBe('read');
  expect(loaded.chats[0].unread).toBe(0);
});

it('preserves a local reply quote when the outgoing echo beats the send response', () => {
  const echo = chatReducer(initialState, {
    type: 'event',
    event: {
      type: 'message',
      chatId: '123',
      message: message('sent', true, 'sent'),
    },
  });
  const local = chatReducer(echo, {
    type: 'sent',
    chatId: '123',
    message: {
      ...message('sent', true, 'queued'),
      quote: { id: 'original', text: 'Исходный текст', outgoing: false },
    },
  });
  expect(local.chats[0].messages).toHaveLength(1);
  expect(local.chats[0].messages[0].status).toBe('sent');
  expect(local.chats[0].messages[0].quote?.text).toBe('Исходный текст');
});
it('fills a partial webhook quote from history without losing live data', () => {
  const live = chatReducer(initialState, {
    type: 'event',
    event: {
      type: 'message',
      chatId: '123',
      message: { ...message(), quote: { id: 'original', text: '' } },
    },
  });
  const loaded = chatReducer(live, {
    type: 'history',
    chatId: '123',
    messages: [
      { ...message(), quote: { id: 'original', text: 'Текст из истории', outgoing: true } },
    ],
  });
  expect(loaded.chats[0].messages[0].quote).toEqual({
    id: 'original',
    text: 'Текст из истории',
    outgoing: true,
  });
  expect(loaded.chats[0].unread).toBe(1);
});
