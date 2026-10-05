import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, GreenApi, normalizePhone, validateCredentials } from './green-api';
const credentials = {
  idInstance: '4100000000',
  apiTokenInstance: 'test-token',
  apiUrl: 'https://4100.api.green-api.com',
};
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
describe('GREEN-API Telegram client', () => {
  it('normalizes formatted international numbers without guessing a country code', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('79991234567');
    expect(() => normalizePhone('abc79991234567')).toThrow();
    expect(() => normalizePhone('0123456789')).toThrow();
    expect(() => normalizePhone('+7')).toThrow();
  });
  it('restricts token destinations to GREEN-API HTTPS origins', () => {
    expect(validateCredentials(credentials)).toEqual(credentials);
    for (const apiUrl of [
      'https://green-api.com.evil.com',
      'http://4100.api.green-api.com',
      'https://evil.com',
      'https://green-api.com/path',
      'https://user:secret@green-api.com',
      'https://green-api.com?token=foo',
    ]) {
      expect(() => validateCredentials({ ...credentials, apiUrl })).toThrow();
    }
  });
  it('resolves a phone to a canonical Telegram chat ID before sending', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ exist: true, chatId: '12345' }))
      .mockResolvedValueOnce(Response.json({ idMessage: 'msg1' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new GreenApi(credentials);
    const chatId = await api.resolvePhone('+7 999 123-45-67', signal());
    await api.sendMessage(chatId, 'Привет!', signal());
    expect(fetchMock.mock.calls[0][0]).toContain('/checkAccount/test-token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ phoneNumber: 79991234567 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      chatId: '12345',
      message: 'Привет!',
    });
  });
  it('rejects hidden or missing Telegram accounts and messenger rate limits', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ exist: false, chatId: '' }))
        .mockResolvedValueOnce(Response.json({ status: false, reason: 'rate_limit_exceeded' })),
    );
    const api = new GreenApi(credentials);
    await expect(api.resolvePhone('79991234567', signal())).rejects.toThrow('приватности');
    await expect(api.resolvePhone('79991234567', signal())).rejects.toThrow('лимит');
  });
  it('checks the account state, instance type, and notification settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ stateInstance: 'authorized' }))
        .mockResolvedValueOnce(
          Response.json({
            typeInstance: 'telegram',
            incomingWebhook: 'no',
            webhookUrl: 'https://example.com',
          }),
        ),
    );
    expect(await new GreenApi(credentials).connect(signal())).toHaveLength(2);
  });
  it('does not reveal tokens from upstream error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('sensitive test-token', { status: 401 })),
    );
    await expect(new GreenApi(credentials).receive(signal())).rejects.toEqual(
      new ApiError('Неверные учетные данные GREEN-API.', 401),
    );
  });
  it('uses GET long polling and DELETE receipt acknowledgement', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(null))
      .mockResolvedValueOnce(Response.json({ result: true }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new GreenApi(credentials);
    await api.receive(signal());
    await api.acknowledge(42, signal());
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/receiveNotification/test-token?receiveTimeout=30',
    );
    expect(fetchMock.mock.calls[1][0]).toContain('/deleteNotification/test-token/42');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });
  it('rejects empty and oversized texts before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const api = new GreenApi(credentials);
    await expect(api.sendMessage('123', ' ', signal())).rejects.toThrow();
    await expect(api.sendMessage('123', 'x'.repeat(4097), signal())).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
it('handles malformed JSON and missing state in successful API responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response('invalid JSON', { status: 200 }))
      .mockResolvedValueOnce(Response.json({})),
  );
  const api = new GreenApi(credentials);
  await expect(api.receive(signal())).rejects.toThrow('некорректный ответ');
  await expect(api.getStateInstance(signal())).rejects.toThrow('состояние инстанса');
});
