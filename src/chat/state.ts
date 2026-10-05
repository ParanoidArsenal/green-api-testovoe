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
}
export const initialState: ChatState = { chats: [], activeId: null, statuses: {} };
export type Action =
  | { type: 'open'; id: string; name: string; phone: string }
  | { type: 'select'; id: string | null }
  | { type: 'sent'; chatId: string; message: Message }
  | { type: 'notification'; body: Json };
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
  if (chat.messages.some((item) => item.id === message.id)) return state;
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
    const status = str(body.status) as MessageStatus;
    const chatId = str(body.chatId);
    if (!id || !chatId || !statuses.includes(status)) return state;
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
    str(sender.senderPhoneNumber) || undefined,
  );
}
