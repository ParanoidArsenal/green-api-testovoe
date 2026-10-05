export interface Credentials {
  idInstance: string;
  apiTokenInstance: string;
  apiUrl: string;
}
export type Json = Record<string, unknown>;
export function record(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}
export function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function normalizePhone(input: string): string {
  if (!/^\+?[\d\s()-]+$/.test(input.trim()))
    throw new Error('Введите номер телефона в международном формате.');
  const phone = input.replace(/\D/g, '');
  if (!/^[1-9]\d{6,14}$/.test(phone))
    throw new Error('Номер должен содержать от 7 до 15 цифр и код страны.');
  return phone;
}
export function validateCredentials(credentials: Credentials): Credentials {
  const idInstance = credentials.idInstance.trim();
  const apiTokenInstance = credentials.apiTokenInstance.trim();
  if (!/^\d+$/.test(idInstance)) throw new Error('idInstance должен содержать только цифры.');
  if (!/^[a-zA-Z0-9_-]+$/.test(apiTokenInstance)) throw new Error('Проверьте apiTokenInstance.');
  let url: URL;
  try {
    url = new URL(credentials.apiUrl.trim());
  } catch {
    throw new Error('Укажите корректный apiUrl из личного кабинета.');
  }
  if (
    url.protocol !== 'https:' ||
    !/^(?:[a-z0-9-]+\.)*green-api\.com$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'apiUrl должен быть HTTPS-адресом сервера green-api.com без пути и параметров.',
    );
  }
  return { idInstance, apiTokenInstance, apiUrl: url.origin };
}
export class GreenApi {
  constructor(public credentials: Credentials) {}
  async request(
    method: string,
    verb: 'GET' | 'POST' | 'DELETE',
    signal: AbortSignal,
    body?: Json,
    suffix = '',
  ): Promise<unknown> {
    const { apiUrl, idInstance, apiTokenInstance } = this.credentials;
    const url = `${apiUrl}/waInstance${idInstance}/${method}/${encodeURIComponent(apiTokenInstance)}${suffix}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: verb,
        signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiError(
        'Не удалось связаться с GREEN-API. Проверьте apiUrl и подключение к Интернету.',
      );
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: 'GREEN-API отклонил запрос. Проверьте введенные данные.',
        401: 'Неверные учетные данные GREEN-API.',
        403: 'Доступ запрещен. Проверьте токен и состояние инстанса.',
        429: 'Превышен лимит запросов. Повторите попытку позже.',
        469: 'Telegram временно ограничил поиск контактов. Повторите попытку позже.',
      };
      // Do not expose upstream bodies or URLs: they may contain credentials.
      throw new ApiError(
        messages[response.status] ?? `Ошибка GREEN-API (${response.status}). Попробуйте позже.`,
        response.status,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new ApiError('GREEN-API вернул некорректный ответ.');
    }
  }
  async connect(signal: AbortSignal): Promise<string[]> {
    const state = record(await this.request('getStateInstance', 'GET', signal));
    if (state.stateInstance !== 'authorized')
      throw new ApiError(
        'Инстанс не авторизован. Подключите Telegram в личном кабинете GREEN-API.',
      );
    const settings = record(await this.request('getSettings', 'GET', signal));
    if (settings.typeInstance !== 'telegram')
      throw new ApiError('Нужен инстанс Telegram. Проверьте данные в личном кабинете GREEN-API.');
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
  async resolvePhone(phone: string, signal: AbortSignal): Promise<string> {
    const data = record(
      await this.request('checkAccount', 'POST', signal, {
        phoneNumber: Number(normalizePhone(phone)),
      }),
    );
    if (data.status === false)
      throw new ApiError(
        'Telegram не смог проверить номер. Инстанс может быть не готов или достигнут лимит поиска контактов.',
      );
    if (data.exist !== true || !str(data.chatId))
      throw new ApiError('Аккаунт Telegram не найден или номер скрыт настройками приватности.');
    return str(data.chatId);
  }
  async sendMessage(chatId: string, message: string, signal: AbortSignal): Promise<string> {
    if (!message.trim() || message.length > 4096)
      throw new Error('Введите текст длиной от 1 до 4096 символов.');
    const data = record(await this.request('sendMessage', 'POST', signal, { chatId, message }));
    if (!str(data.idMessage))
      throw new ApiError(
        'GREEN-API не вернул идентификатор сообщения. Проверьте результат в Telegram перед повторной отправкой.',
      );
    return str(data.idMessage);
  }
  receive(signal: AbortSignal) {
    return this.request('receiveNotification', 'GET', signal, undefined, '?receiveTimeout=30');
  }
  async acknowledge(receiptId: number, signal: AbortSignal) {
    const result = record(
      await this.request('deleteNotification', 'DELETE', signal, undefined, `/${receiptId}`),
    );
    if (result.result !== true) throw new ApiError('Не удалось подтвердить обработку уведомления.');
  }
}
