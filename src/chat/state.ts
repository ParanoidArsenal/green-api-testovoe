import { record, str, type Json } from '../api/green-api';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export interface Message {
  id: string;
  text: string;
  timestamp: number;
  outgoing: boolean;
  status?: MessageStatus;
}
export interface Chat {
  id: string;
  name: string;
  phone?: string;
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
  | { type: 'open'; id: string; name: string; phone: string }
  | { type: 'select'; id: string | null }
  | { type: 'sent'; chatId: string; message: Message }
  | { type: 'notification'; body: Json }
  | { type: 'dismissDeliveryError' };
const statuses: MessageStatus[] = ['queued', 'sent', 'delivered', 'read', 'failed'];
function mergeStatus(current: MessageStatus | undefined, next: MessageStatus): MessageStatus {
  if (next === 'failed' || current === 'failed') return 'failed';
  return current && statuses.indexOf(current) > statuses.indexOf(next) ? current : next;
}
function addMessage(
  state: ChatState,
  chatId: string,
  message: Message,
  name?: string,
  phone?: string,
): ChatState {
  let chats = state.chats;
  if (!chats.some((chat) => chat.id === chatId))
    chats = [
      ...chats,
      { id: chatId, name: name || (phone ? `+${phone}` : chatId), phone, messages: [], unread: 0 },
    ];
  const chat = chats.find((chat) => chat.id === chatId)!;
  const existing = chat.messages.find((item) => item.id === message.id);
  if (existing) {
    if (!message.outgoing || !existing.outgoing || !message.status) return state;
    const status = mergeStatus(existing.status, message.status);
    if (status === existing.status) return state;
    return {
      ...state,
      chats: chats.map((item) =>
        item.id !== chatId
          ? item
          : {
              ...item,
              messages: item.messages.map((value) =>
                value.id === message.id ? { ...value, status } : value,
              ),
            },
      ),
    };
  }
  const knownStatus = state.statuses[`${chatId}:${message.id}`];
  return {
    ...state,
    chats: chats.map((item) =>
      item.id !== chatId
        ? item
        : {
            ...item,
            name: name || item.name,
            phone: phone || item.phone,
            messages: [
              ...item.messages,
              { ...message, status: knownStatus ?? message.status },
            ].sort((a, b) => Math.floor(a.timestamp / 1000) - Math.floor(b.timestamp / 1000)),
            unread: item.unread + (!message.outgoing && state.activeId !== chatId ? 1 : 0),
          },
    ),
  };
}
export function chatReducer(state: ChatState, action: Action): ChatState {
  if (action.type === 'dismissDeliveryError') return { ...state, deliveryError: null };
  if (action.type === 'select')
    return {
      ...state,
      activeId: action.id,
      chats: state.chats.map((chat) => (chat.id === action.id ? { ...chat, unread: 0 } : chat)),
    };
  if (action.type === 'open') {
    const exists = state.chats.some((chat) => chat.id === action.id);
    return {
      ...state,
      activeId: action.id,
      chats: exists
        ? state.chats.map((chat) =>
            chat.id === action.id ? { ...chat, phone: action.phone, unread: 0 } : chat,
          )
        : [
            ...state.chats,
            { id: action.id, name: action.name, phone: action.phone, messages: [], unread: 0 },
          ],
    };
  }
  if (action.type === 'sent') return addMessage(state, action.chatId, action.message);
  const body = action.body;
  const type = str(body.typeWebhook);
  const id = str(body.idMessage);
  if (type === 'outgoingMessageStatus') {
    const rawStatus = str(body.status);
    const status = (rawStatus === 'noAccount' ? 'failed' : rawStatus) as MessageStatus;
    const chatId = str(body.chatId);
    if (!chatId || !statuses.includes(status)) return state;
    if (!id) {
      if (status !== 'failed') return state;
      const message =
        rawStatus === 'noAccount'
          ? 'Аккаунт Telegram получателя не найден или номер скрыт настройками приватности.'
          : body.description === 'chatId unresolvable on this session'
            ? 'Telegram не смог определить получателя. Создайте чат заново по номеру телефона для проверки актуального идентификатора.'
            : 'GREEN-API сообщил об ошибке отправки. Проверьте переписку в Telegram.';
      return { ...state, deliveryError: { chatId, message } };
    }
    const key = `${chatId}:${id}`;
    const next = mergeStatus(state.statuses[key], status);
    return {
      ...state,
      statuses: { ...state.statuses, [key]: next },
      chats: state.chats.map((chat) =>
        chat.id !== chatId
          ? chat
          : {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === id
                  ? { ...message, status: mergeStatus(message.status, next) }
                  : message,
              ),
            },
      ),
    };
  }
  if (
    !['incomingMessageReceived', 'outgoingMessageReceived', 'outgoingAPIMessageReceived'].includes(
      type,
    )
  )
    return state;
  const sender = record(body.senderData);
  const data = record(body.messageData);
  const text =
    data.typeMessage === 'textMessage'
      ? str(record(data.textMessageData).textMessage)
      : data.typeMessage === 'extendedTextMessage'
        ? str(record(data.extendedTextMessageData).text)
        : '';
  const chatId = str(sender.chatId);
  if (!id || !chatId || !text || typeof body.timestamp !== 'number') return state;
  const outgoing = type !== 'incomingMessageReceived';
  return addMessage(
    state,
    chatId,
    { id, text, timestamp: body.timestamp * 1000, outgoing, status: outgoing ? 'sent' : undefined },
    str(sender.chatName) ||
      (outgoing ? undefined : str(sender.senderContactName) || str(sender.senderName)),
    !outgoing &&
      (!sender.chatType || sender.chatType === 'user') &&
      str(sender.senderPhoneNumber) !== '0'
      ? str(sender.senderPhoneNumber) || undefined
      : undefined,
  );
}
