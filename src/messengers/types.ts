import type { Credentials, Json } from '../api/green-api';
import type { ChatEvent, Message } from '../chat/events';
export type MessengerId = 'telegram' | 'max' | 'whatsapp';
export interface MessengerInfo {
  id: MessengerId;
  label: string;
  maxTextLength: number;
  docsUrl: string;
  defaultApiUrl: string;
  exampleInstance: string;
  phoneHint: string;
  instanceTypes: readonly string[];
}
export interface Recipient {
  chatId: string;
  phone: string;
  aliases: string[];
}
export interface MessengerAdapter {
  readonly info: MessengerInfo;
  readonly credentials: Credentials;
  connect(signal: AbortSignal): Promise<string[]>;
  getStateInstance(signal: AbortSignal): Promise<string>;
  resolvePhone(phone: string, signal: AbortSignal): Promise<Recipient>;
  getChatHistory(chatId: string, count: number, signal: AbortSignal): Promise<Message[]>;
  sendMessage(
    chatId: string,
    text: string,
    signal: AbortSignal,
    quotedMessageId?: string,
  ): Promise<string>;
  receive(signal: AbortSignal): Promise<unknown>;
  acknowledge(receiptId: number, signal: AbortSignal): Promise<void>;
  decodeNotification(body: Json): ChatEvent | null;
}
