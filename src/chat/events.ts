export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export interface Message {
  id: string;
  text: string;
  timestamp: number;
  outgoing: boolean;
  status?: MessageStatus;
  quote?: { id: string; text: string; outgoing?: boolean };
}
// Domain events contain no GREEN-API webhook fields or messenger-specific payloads.
export type ChatEvent =
  | { type: 'message'; chatId: string; name?: string; phone?: string; message: Message }
  | {
      type: 'delivery';
      chatId: string;
      messageId?: string;
      status: MessageStatus;
      errorMessage?: string;
    }
  | { type: 'state'; state: string };
