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
it('merges a late outgoing API echo without duplicate texts or loss of delivery status', () => {
  const sent = chatReducer(initialState, {
    type: 'sent',
    chatId: '123',
    message: {
      id: 'm1',
      text: 'Привет!',
      timestamp: 1763115112000,
      outgoing: true,
      status: 'queued',
    },
  });
  const echo = { ...incoming(), typeWebhook: 'outgoingAPIMessageReceived' };
  const echoed = chatReducer(sent, { type: 'notification', body: echo });
  expect(echoed.chats[0].messages).toHaveLength(1);
  expect(echoed.chats[0].messages[0].status).toBe('sent');
  const read = chatReducer(echoed, {
    type: 'notification',
    body: { typeWebhook: 'outgoingMessageStatus', chatId: '123', idMessage: 'm1', status: 'read' },
  });
  expect(chatReducer(read, { type: 'notification', body: echo }).chats[0].messages[0].status).toBe(
    'read',
  );
});
it('does not replace a recipient phone with an outgoing sender phone', () => {
  const opened = chatReducer(initialState, {
    type: 'open',
    id: '123',
    name: '+79991234567',
    phone: '79991234567',
  });
  const echo = {
    ...incoming(),
    typeWebhook: 'outgoingAPIMessageReceived',
    senderData: { chatId: '123', senderPhoneNumber: 79876543210 },
  };
  expect(chatReducer(opened, { type: 'notification', body: echo }).chats[0].phone).toBe(
    '79991234567',
  );
  const group = {
    ...incoming(),
    senderData: {
      chatId: '-1001234',
      chatType: 'supergroup',
      chatName: 'Группа',
      senderPhoneNumber: 79876543210,
    },
  };
  expect(
    chatReducer(initialState, { type: 'notification', body: group }).chats[0].phone,
  ).toBeUndefined();
});
it('reports unidentified failed and noAccount events without guessing a message ID', () => {
  for (const status of ['failed', 'noAccount']) {
    const result = chatReducer(initialState, {
      type: 'notification',
      body: {
        typeWebhook: 'outgoingMessageStatus',
        chatId: '123',
        status,
        description: 'chatId unresolvable on this session',
      },
    });
    expect(result.deliveryError?.chatId).toBe('123');
    expect(result.deliveryError?.message).toBeTruthy();
    expect(result.statuses).toEqual({});
    expect(chatReducer(result, { type: 'dismissDeliveryError' }).deliveryError).toBeNull();
  }
});
it('maps noAccount with a message ID to a failed delivery', () => {
  const status = chatReducer(initialState, {
    type: 'notification',
    body: {
      typeWebhook: 'outgoingMessageStatus',
      chatId: '123',
      idMessage: 'm1',
      status: 'noAccount',
    },
  });
  expect(status.statuses['123:m1']).toBe('failed');
});
