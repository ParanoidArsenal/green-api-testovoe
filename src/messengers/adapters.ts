import {
  ApiError,
  GreenApiClient,
  normalizePhone,
  record,
  str,
  type Credentials,
  type Json,
} from '../api/green-api';
import type { ChatEvent, MessageStatus } from '../chat/events';
import type { MessengerAdapter, MessengerId, MessengerInfo, Recipient } from './types';

export const messengerInfo: Record<MessengerId, MessengerInfo> = {
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    maxTextLength: 4096,
    docsUrl: 'https://green-api.com/telegram/docs/',
    defaultApiUrl: 'https://4100.api.green-api.com',
    exampleInstance: '4100000000',
    phoneHint: 'Международный формат с кодом страны.',
    instanceTypes: ['telegram'],
  },
  max: {
    id: 'max',
    label: 'MAX',
    maxTextLength: 4000,
    docsUrl: 'https://green-api.com/v3/docs/',
    defaultApiUrl: 'https://3100.api.green-api.com',
    exampleInstance: '3100000000',
    phoneHint: 'Номер РФ (+7) или Беларуси (+375).',
    instanceTypes: ['v3'],
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    maxTextLength: 20000,
    docsUrl: 'https://green-api.com/docs/',
    defaultApiUrl: 'https://api.green-api.com',
    exampleInstance: '1101000000',
    phoneHint: 'Международный формат с кодом страны.',
    instanceTypes: ['whatsapp'],
  },
};
export const messengers = Object.values(messengerInfo);
const deliveryStatuses: MessageStatus[] = ['queued', 'sent', 'delivered', 'read', 'failed'];

abstract class GreenApiAdapter implements MessengerAdapter {
  protected readonly client: GreenApiClient;
  abstract readonly info: MessengerInfo;
  constructor(credentials: Credentials) {
    this.client = new GreenApiClient(credentials);
  }
  get credentials() {
    return this.client.credentials;
  }
  getStateInstance(signal: AbortSignal) {
    return this.client.getStateInstance(signal);
  }
  receive(signal: AbortSignal) {
    return this.client.receive(signal);
  }
  acknowledge(receiptId: number, signal: AbortSignal) {
    return this.client.acknowledge(receiptId, signal);
  }
  protected matchesSettings(settings: Json): boolean {
    return this.info.instanceTypes.includes(str(settings.typeInstance));
  }
  async connect(signal: AbortSignal): Promise<string[]> {
    if ((await this.getStateInstance(signal)) !== 'authorized')
      throw new ApiError(
        `Инстанс не авторизован. Подключите ${this.info.label} в личном кабинете GREEN-API.`,
      );
    const settings = await this.client.getSettings(signal);
    if (!this.matchesSettings(settings))
      throw new ApiError(
        `Нужен инстанс ${this.info.label}. Проверьте выбранный мессенджер и учетные данные GREEN-API.`,
      );
    const warnings: string[] = [];
    if (settings.incomingWebhook !== 'yes')
      warnings.push(
        'Включите «Получать уведомления о входящих сообщениях и файлах» в настройках инстанса GREEN-API.',
      );
    if (settings.webhookUrl)
      warnings.push(
        'Для HTTP API очистите Webhook URL в настройках инстанса, чтобы уведомления поступали в этот чат.',
      );
    return warnings;
  }
  abstract resolvePhone(phone: string, signal: AbortSignal): Promise<Recipient>;
  async sendMessage(chatId: string, text: string, signal: AbortSignal): Promise<string> {
    if (!text.trim() || text.length > this.info.maxTextLength)
      throw new Error(`Введите текст длиной от 1 до ${this.info.maxTextLength} символов.`);
    const data = record(
      await this.client.request('sendMessage', 'POST', signal, { chatId, message: text }),
    );
    if (!str(data.idMessage))
      throw new ApiError(
        `GREEN-API не вернул идентификатор сообщения. Проверьте результат в ${this.info.label} перед повторной отправкой.`,
      );
    return str(data.idMessage);
  }
  protected async checkAccount(phone: string, signal: AbortSignal): Promise<Recipient> {
    const data = record(
      await this.client.request('checkAccount', 'POST', signal, { phoneNumber: Number(phone) }),
    );
    if (data.status === false)
      throw new ApiError(
        `${this.info.label} не смог проверить номер. Инстанс может быть не готов или достигнут лимит поиска контактов.`,
      );
    if (data.exist !== true || !/^\d+$/.test(str(data.chatId)))
      throw new ApiError(
        `Аккаунт ${this.info.label} не найден или номер скрыт настройками приватности.`,
      );
    return { chatId: str(data.chatId), phone, aliases: [] };
  }
  protected incomingPhone(sender: Json, outgoing: boolean): string | undefined {
    const phone = str(sender.senderPhoneNumber);
    return !outgoing &&
      (!sender.chatType || sender.chatType === 'user') &&
      /^[1-9]\d{6,14}$/.test(phone)
      ? phone
      : undefined;
  }
  decodeNotification(body: Json): ChatEvent | null {
    const instanceType = str(record(body.instanceData).typeInstance);
    if (instanceType && !this.info.instanceTypes.includes(instanceType)) return null;
    const type = str(body.typeWebhook);
    if (type === 'stateInstanceChanged')
      return str(body.stateInstance) ? { type: 'state', state: str(body.stateInstance) } : null;
    const id = str(body.idMessage);
    if (type === 'outgoingMessageStatus') {
      const rawStatus = str(body.status);
      const status = (rawStatus === 'noAccount' ? 'failed' : rawStatus) as MessageStatus;
      const chatId = str(body.chatId);
      if (!chatId || !deliveryStatuses.includes(status) || (!id && status !== 'failed'))
        return null;
      const errorMessage =
        rawStatus === 'noAccount'
          ? `Аккаунт ${this.info.label} получателя не найден или номер скрыт настройками приватности.`
          : body.description === 'chatId unresolvable on this session'
            ? `${this.info.label} не смог определить получателя. Создайте чат заново по номеру телефона для проверки актуального идентификатора.`
            : `GREEN-API сообщил об ошибке отправки. Проверьте переписку в ${this.info.label}.`;
      return {
        type: 'delivery',
        chatId,
        messageId: id || undefined,
        status,
        errorMessage: status === 'failed' ? errorMessage : undefined,
      };
    }
    if (
      ![
        'incomingMessageReceived',
        'outgoingMessageReceived',
        'outgoingAPIMessageReceived',
      ].includes(type)
    )
      return null;
    const sender = record(body.senderData);
    const data = record(body.messageData);
    const text =
      data.typeMessage === 'textMessage'
        ? str(record(data.textMessageData).textMessage)
        : ['extendedTextMessage', 'quotedMessage'].includes(str(data.typeMessage))
          ? str(record(data.extendedTextMessageData).text)
          : '';
    const chatId = str(sender.chatId);
    const timestamp = body.timestamp;
    if (
      !id ||
      !chatId ||
      !text ||
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      !Number.isFinite(new Date(timestamp * 1000).getTime())
    )
      return null;
    const outgoing = type !== 'incomingMessageReceived';
    return {
      type: 'message',
      chatId,
      name:
        str(sender.chatName) ||
        (outgoing ? undefined : str(sender.senderContactName) || str(sender.senderName)) ||
        undefined,
      phone: this.incomingPhone(sender, outgoing),
      message: {
        id,
        text,
        timestamp: timestamp * 1000,
        outgoing,
        status: outgoing ? 'sent' : undefined,
      },
    };
  }
}
export class TelegramAdapter extends GreenApiAdapter {
  readonly info = messengerInfo.telegram;
  resolvePhone(phone: string, signal: AbortSignal) {
    return this.checkAccount(normalizePhone(phone), signal);
  }
}
export class MaxAdapter extends GreenApiAdapter {
  readonly info = messengerInfo.max;
  async resolvePhone(input: string, signal: AbortSignal): Promise<Recipient> {
    const phone = normalizePhone(input);
    if (!/^(?:7\d{10}|375\d{9})$/.test(phone))
      throw new Error('Для MAX укажите номер РФ (+7, 11 цифр) или Беларуси (+375, 12 цифр).');
    return this.checkAccount(phone, signal);
  }
}
export class WhatsAppAdapter extends GreenApiAdapter {
  readonly info = messengerInfo.whatsapp;
  protected matchesSettings(settings: Json): boolean {
    // WhatsApp's documented GetSettings does not include typeInstance.
    return settings.typeInstance
      ? super.matchesSettings(settings)
      : /^\d+@(c\.us|lid)$/.test(str(settings.wid));
  }
  async resolvePhone(input: string, signal: AbortSignal): Promise<Recipient> {
    const phone = normalizePhone(input);
    const phoneId = `${phone}@c.us`;
    const data = record(
      await this.client.request('checkWhatsapp', 'POST', signal, { chatId: phoneId }),
    );
    if (data.status === false)
      throw new ApiError('WhatsApp не смог проверить номер. Повторите попытку позже.');
    if (data.existsWhatsapp !== true)
      throw new ApiError('Аккаунт WhatsApp на этом номере не найден.');
    const chatId = str(data.chatId) || phoneId;
    if (!/^\d+@(c\.us|lid)$/.test(chatId))
      throw new ApiError('GREEN-API вернул некорректный идентификатор WhatsApp.');
    return { chatId, phone, aliases: chatId === phoneId ? [] : [phoneId] };
  }
  protected incomingPhone(sender: Json, outgoing: boolean): string | undefined {
    if (outgoing || !/^\d+@(c\.us|lid)$/.test(str(sender.chatId))) return undefined;
    return str(sender.chatId).match(/^(\d+)@c\.us$/)?.[1] || super.incomingPhone(sender, outgoing);
  }
}
export function createMessengerAdapter(
  id: MessengerId,
  credentials: Credentials,
): MessengerAdapter {
  switch (id) {
    case 'telegram':
      return new TelegramAdapter(credentials);
    case 'max':
      return new MaxAdapter(credentials);
    case 'whatsapp':
      return new WhatsAppAdapter(credentials);
  }
}
