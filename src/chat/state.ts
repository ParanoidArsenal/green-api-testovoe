import type { ChatEvent, Message, MessageStatus } from './events';
export type { Message, MessageStatus } from './events';
export interface Chat {
  id: string;
  name: string;
  phone?: string;
  aliases: string[];
  messages: Message[];
  unread: number;
}
export interface ChatState {
  chats: Chat[];
  activeId: string | null;
  statuses: Record<string, MessageStatus>;
  deliveryError: { chatId: string; message: string } | null;
}
export const initialState: ChatState = {
  chats: [],
  activeId: null,
  statuses: {},
  deliveryError: null,
};
export type Action =
  | { type: 'open'; id: string; name: string; phone: string; aliases?: string[] }
  | { type: 'select'; id: string | null }
  | { type: 'sent'; chatId: string; message: Message }
  | { type: 'history'; chatId: string; messages: Message[] }
  | { type: 'event'; event: ChatEvent }
  | { type: 'dismissDeliveryError' };
const statuses: MessageStatus[] = ['queued', 'sent', 'delivered', 'read', 'failed'];
function mergeStatus(current: MessageStatus | undefined, next: MessageStatus): MessageStatus {
  if (next === 'failed' || current === 'failed') return 'failed';
  return current && statuses.indexOf(current) > statuses.indexOf(next) ? current : next;
}
function matches(chat: Chat, id: string) {
  return chat.id === id || chat.aliases.includes(id);
}
function mergeQuote(existing: Message['quote'], next: Message['quote']): Message['quote'] {
  if (!existing) return next;
  if (!next || existing.id !== next.id) return existing;
  const text = existing.text || next.text;
  const outgoing = existing.outgoing ?? next.outgoing;
  return text === existing.text && outgoing === existing.outgoing
    ? existing
    : { ...existing, text, outgoing };
}
function sortMessages(messages: Message[]) {
  return messages.sort((a, b) => Math.floor(a.timestamp / 1000) - Math.floor(b.timestamp / 1000));
}
function knownStatus(
  state: ChatState,
  chat: Chat,
  messageId: string,
  initial?: MessageStatus,
): MessageStatus | undefined {
  return [chat.id, ...chat.aliases].reduce((status, id) => {
    const value = state.statuses[`${id}:${messageId}`];
    return value ? mergeStatus(status, value) : status;
  }, initial);
}
function addMessage(
  state: ChatState,
  chatId: string,
  message: Message,
  name?: string,
  phone?: string,
): ChatState {
  let chats = state.chats;
  let chat = chats.find((item) => matches(item, chatId));
  if (!chat) {
    chat = {
      id: chatId,
      name: name || (phone ? `+${phone}` : chatId),
      phone,
      aliases: [],
      messages: [],
      unread: 0,
    };
    chats = [...chats, chat];
  }
  const existing = chat.messages.find((item) => item.id === message.id);
  if (existing) {
    const status =
      message.outgoing && existing.outgoing && message.status
        ? knownStatus(state, chat, message.id, mergeStatus(existing.status, message.status))
        : existing.status;
    const quote = mergeQuote(existing.quote, message.quote);
    if (status === existing.status && quote === existing.quote) return state;
    return {
      ...state,
      chats: chats.map((item) =>
        item.id !== chat.id
          ? item
          : {
              ...item,
              messages: item.messages.map((value) =>
                value.id === message.id ? { ...value, status, quote } : value,
              ),
            },
      ),
    };
  }
  return {
    ...state,
    chats: chats.map((item) =>
      item.id !== chat.id
        ? item
        : {
            ...item,
            name: name || item.name,
            phone: phone || item.phone,
            messages: sortMessages([
              ...item.messages,
              { ...message, status: knownStatus(state, item, message.id, message.status) },
            ]),
            unread: item.unread + (!message.outgoing && state.activeId !== item.id ? 1 : 0),
          },
    ),
  };
}
export function chatReducer(state: ChatState, action: Action): ChatState {
  if (action.type === 'history') {
    const chat = state.chats.find((item) => matches(item, action.chatId));
    if (!chat) return state;
    const merged = new Map(chat.messages.map((message) => [message.id, message]));
    for (const message of action.messages) {
      const existing = merged.get(message.id);
      const status = message.status
        ? mergeStatus(existing?.status, message.status)
        : existing?.status;
      merged.set(message.id, {
        ...message,
        ...existing,
        status: knownStatus(state, chat, message.id, status),
        quote: mergeQuote(existing?.quote, message.quote),
      });
    }
    return {
      ...state,
      chats: state.chats.map((item) =>
        item.id === chat.id ? { ...item, messages: sortMessages([...merged.values()]) } : item,
      ),
    };
  }
  if (action.type === 'dismissDeliveryError') return { ...state, deliveryError: null };
  if (action.type === 'select')
    return {
      ...state,
      activeId: action.id,
      chats: state.chats.map((chat) => (chat.id === action.id ? { ...chat, unread: 0 } : chat)),
    };
  if (action.type === 'open') {
    const identifiers = [action.id, ...(action.aliases ?? [])];
    const related = state.chats.filter((chat) => identifiers.some((id) => matches(chat, id)));
    // Keep an existing ID stable for drafts and requests already in flight; aliases route both forms.
    const target =
      related.find((chat) => chat.id === state.activeId) ??
      related.find((chat) => chat.id === action.id) ??
      related[0];
    const id = target?.id ?? action.id;
    const aliases = [
      ...new Set([...identifiers, ...related.flatMap((chat) => [chat.id, ...chat.aliases])]),
    ].filter((value) => value !== id);
    const merged = new Map<string, Message>();
    for (const chat of related)
      for (const message of chat.messages) {
        const existing = merged.get(message.id);
        merged.set(
          message.id,
          existing && message.status
            ? { ...existing, status: mergeStatus(existing.status, message.status) }
            : (existing ?? message),
        );
      }
    const chat: Chat = {
      id,
      aliases,
      name: target?.name || action.name,
      phone: action.phone,
      messages: sortMessages([...merged.values()]),
      unread: 0,
    };
    chat.messages = chat.messages.map((message) => ({
      ...message,
      status: knownStatus(state, chat, message.id, message.status),
    }));
    return {
      ...state,
      activeId: id,
      chats: [...state.chats.filter((chat) => !related.includes(chat)), chat],
    };
  }
  if (action.type === 'sent') return addMessage(state, action.chatId, action.message);
  const event = action.event;
  if (event.type === 'state') return state;
  if (event.type === 'message')
    return addMessage(state, event.chatId, event.message, event.name, event.phone);
  const chat = state.chats.find((item) => matches(item, event.chatId));
  const chatId = chat?.id ?? event.chatId;
  if (!event.messageId)
    return event.status === 'failed'
      ? {
          ...state,
          deliveryError: {
            chatId,
            message: event.errorMessage || 'Мессенджер сообщил об ошибке отправки.',
          },
        }
      : state;
  const key = `${chatId}:${event.messageId}`;
  const next = mergeStatus(state.statuses[key], event.status);
  return {
    ...state,
    statuses: { ...state.statuses, [key]: next },
    chats: state.chats.map((item) =>
      item.id !== chatId
        ? item
        : {
            ...item,
            messages: item.messages.map((message) =>
              message.id === event.messageId
                ? { ...message, status: mergeStatus(message.status, next) }
                : message,
            ),
          },
    ),
  };
}
