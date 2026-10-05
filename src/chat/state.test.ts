import { expect, it } from 'vitest';
import { chatReducer, initialState } from './state';
import type { Json } from '../api/green-api';
const incoming = (chatId = '123', idMessage = 'm1'): Json => ({
  typeWebhook: 'incomingMessageReceived',
  idMessage,
  timestamp: 1763115112,
  senderData: { chatId, senderName: 'Анна', senderPhoneNumber: 79991234567 },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Привет!' } },
});
it('routes replies into the phone-created canonical Telegram chat', () => {
  const opened = chatReducer(initialState, {
    type: 'open',
    id: '123',
    name: '+79991234567',
    phone: '79991234567',
  });
  const received = chatReducer(opened, { type: 'notification', body: incoming() });
  expect(received.chats).toHaveLength(1);
  expect(received.chats[0].name).toBe('Анна');
  expect(received.chats[0].messages[0].text).toBe('Привет!');
  expect(received.chats[0].unread).toBe(0);
});
it('deduplicates redelivery without incrementing unread counts', () => {
  const received = chatReducer(initialState, { type: 'notification', body: incoming() });
  const repeated = chatReducer(received, { type: 'notification', body: incoming() });
  expect(repeated).toBe(received);
  expect(repeated.chats[0].unread).toBe(1);
  expect(chatReducer(repeated, { type: 'select', id: '123' }).chats[0].unread).toBe(0);
});
it('handles a status that arrives before the send response without regressing read status', () => {
  const status = chatReducer(initialState, {
    type: 'notification',
    body: { typeWebhook: 'outgoingMessageStatus', chatId: '123', idMessage: 'm1', status: 'read' },
  });
  const sent = chatReducer(status, {
    type: 'sent',
    chatId: '123',
    message: { id: 'm1', text: 'Hello', timestamp: 1, outgoing: true, status: 'queued' },
  });
  expect(sent.chats[0].messages[0].status).toBe('read');
  const late = chatReducer(sent, {
    type: 'notification',
    body: { typeWebhook: 'outgoingMessageStatus', chatId: '123', idMessage: 'm1', status: 'sent' },
  });
  expect(late.chats[0].messages[0].status).toBe('read');
});
it('ignores non-text messages and supports extended text with URLs', () => {
  const file = { ...incoming(), messageData: { typeMessage: 'imageMessage' } };
  expect(chatReducer(initialState, { type: 'notification', body: file })).toBe(initialState);
  const extended = {
    ...incoming(),
    messageData: {
      typeMessage: 'extendedTextMessage',
      extendedTextMessageData: { text: 'https://example.com' },
    },
  };
  expect(
    chatReducer(initialState, { type: 'notification', body: extended }).chats[0].messages[0].text,
  ).toBe('https://example.com');
});
it('preserves send-before-reply order within a second because incoming timestamps have second precision', () => {
  const sent = chatReducer(initialState, {
    type: 'sent',
    chatId: '123',
    message: {
      id: 'outgoing',
      text: 'Hello',
      timestamp: 1763115112999,
      outgoing: true,
      status: 'queued',
    },
  });
  const reply = chatReducer(sent, { type: 'notification', body: incoming() });
  expect(reply.chats[0].messages.map((message) => message.id)).toEqual(['outgoing', 'm1']);
});
