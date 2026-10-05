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
export class GreenApiClient {
  readonly credentials: Credentials;
  constructor(credentials: Credentials) {
    this.credentials = validateCredentials(credentials);
  }
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
        469: 'Мессенджер временно ограничил поиск контактов. Повторите попытку позже.',
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
  async getStateInstance(signal: AbortSignal): Promise<string> {
    const state = record(await this.request('getStateInstance', 'GET', signal));
    if (!str(state.stateInstance)) throw new ApiError('GREEN-API не вернул состояние инстанса.');
    return str(state.stateInstance);
  }
  async getSettings(signal: AbortSignal): Promise<Json> {
    return record(await this.request('getSettings', 'GET', signal));
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
