import { ApiError, record, type Json } from './green-api';
import type { MessengerAdapter } from '../messengers/types';
export type PollState = 'connected' | 'reconnecting' | 'stopped';
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}
// One sequential consumer; acknowledgements happen only after local processing succeeds.
export async function pollNotifications(
  api: Pick<MessengerAdapter, 'receive' | 'acknowledge'>,
  signal: AbortSignal,
  onNotification: (body: Json) => void | false | Promise<void | false>,
  onState: (state: PollState, message?: string) => void,
  wait = pause,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const raw = await api.receive(signal);
      if (signal.aborted) break;
      if (raw !== null) {
        const notification = record(raw);
        if (
          typeof notification.receiptId !== 'number' ||
          !Number.isFinite(notification.receiptId) ||
          !notification.body
        ) {
          throw new ApiError('Некорректное уведомление GREEN-API.');
        }
        const continuePolling = await onNotification(record(notification.body));
        if (signal.aborted) break;
        await api.acknowledge(notification.receiptId, signal);
        if (continuePolling === false) return;
      }
      if (signal.aborted) break;
      failures = 0;
      onState('connected');
      // Also prevents a busy loop if a server returns null without waiting.
      await wait(150, signal);
    } catch (error) {
      if (signal.aborted) break;
      const message = error instanceof Error ? error.message : 'Не удалось получить сообщения.';
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        onState('stopped', message);
        return;
      }
      onState('reconnecting', message);
      await wait(Math.min(1000 * 2 ** failures++, 30_000), signal);
    }
  }
}
