import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, GreenApiClient, normalizePhone, validateCredentials } from './green-api';
const credentials = {
  idInstance: '4100000000',
  apiTokenInstance: 'test-token',
  apiUrl: 'https://4100.api.green-api.com',
};
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
it('normalizes formatted international numbers without guessing a country code', () => {
  expect(normalizePhone('+7 (999) 123-45-67')).toBe('79991234567');
  for (const input of ['abc79991234567', '0123456789', '+7'])
    expect(() => normalizePhone(input)).toThrow();
});
it('restricts token destinations to GREEN-API HTTPS origins including direct construction', () => {
  expect(validateCredentials(credentials)).toEqual(credentials);
  for (const apiUrl of [
    'https://green-api.com.evil.com',
    'http://4100.api.green-api.com',
    'https://evil.com',
    'https://green-api.com/path',
    'https://user:secret@green-api.com',
    'https://green-api.com?token=foo',
  ]) {
    expect(() => new GreenApiClient({ ...credentials, apiUrl })).toThrow();
  }
});
it('does not reveal tokens from upstream error bodies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('sensitive test-token', { status: 401 })),
  );
  await expect(new GreenApiClient(credentials).receive(signal())).rejects.toEqual(
    new ApiError('Неверные учетные данные GREEN-API.', 401),
  );
});
it('uses GET long polling and DELETE receipt acknowledgement', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json(null))
    .mockResolvedValueOnce(Response.json({ result: true }));
  vi.stubGlobal('fetch', fetchMock);
  const api = new GreenApiClient(credentials);
  await api.receive(signal());
  await api.acknowledge(42, signal());
  expect(fetchMock.mock.calls[0][0]).toContain('/receiveNotification/test-token?receiveTimeout=30');
  expect(fetchMock.mock.calls[1][0]).toContain('/deleteNotification/test-token/42');
  expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
});
it('handles malformed JSON and missing state in successful API responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response('invalid JSON', { status: 200 }))
      .mockResolvedValueOnce(Response.json({})),
  );
  const api = new GreenApiClient(credentials);
  await expect(api.receive(signal())).rejects.toThrow('некорректный ответ');
  await expect(api.getStateInstance(signal())).rejects.toThrow('состояние инстанса');
});
