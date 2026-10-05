import { expect, it, vi } from 'vitest';
import { ApiError } from './green-api';
import { pollNotifications } from './polling';
it('processes each notification before deleting it, including unsupported events', async () => {
  const controller = new AbortController();
  const sequence: string[] = [];
  const api = {
    receive: vi.fn().mockResolvedValue({ receiptId: 42, body: { typeWebhook: 'unsupported' } }),
    acknowledge: vi.fn(async () => {
      sequence.push('delete');
      controller.abort();
    }),
  };
  await pollNotifications(
    api,
    controller.signal,
    () => {
      sequence.push('process');
    },
    vi.fn(),
  );
  expect(sequence).toEqual(['process', 'delete']);
  expect(api.receive).toHaveBeenCalledTimes(1);
});
it('retries a failed acknowledgement without dropping the notification', async () => {
  const controller = new AbortController();
  const state = vi.fn();
  const api = {
    receive: vi.fn().mockResolvedValue({ receiptId: 42, body: { idMessage: '1' } }),
    acknowledge: vi
      .fn()
      .mockRejectedValueOnce(new Error('Network'))
      .mockImplementationOnce(async () => controller.abort()),
  };
  const process = vi.fn();
  await pollNotifications(api, controller.signal, process, state, async () => {});
  expect(process).toHaveBeenCalledTimes(2);
  expect(api.acknowledge).toHaveBeenCalledTimes(2);
  expect(state).toHaveBeenCalledWith('reconnecting', 'Network');
});
it('backs off transient errors and stops on invalid credentials', async () => {
  const api = {
    receive: vi
      .fn()
      .mockRejectedValueOnce(new ApiError('offline'))
      .mockRejectedValueOnce(new ApiError('offline'))
      .mockRejectedValueOnce(new ApiError('unauthorized', 401)),
    acknowledge: vi.fn(),
  };
  const wait = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  const state = vi.fn();
  await pollNotifications(api, new AbortController().signal, vi.fn(), state, wait);
  expect(wait.mock.calls.map((call) => call[0])).toEqual([1000, 2000]);
  expect(state).toHaveBeenLastCalledWith('stopped', 'unauthorized');
});
it('does not process or delete a response arriving after logout', async () => {
  const controller = new AbortController();
  const process = vi.fn();
  const api = {
    receive: vi.fn(async () => {
      controller.abort();
      return { receiptId: 1, body: {} };
    }),
    acknowledge: vi.fn(),
  };
  await pollNotifications(api, controller.signal, process, vi.fn());
  expect(process).not.toHaveBeenCalled();
  expect(api.acknowledge).not.toHaveBeenCalled();
});
it('acknowledges an account-state event before stopping the consumer', async () => {
  const api = {
    receive: vi.fn().mockResolvedValue({
      receiptId: 9,
      body: { typeWebhook: 'stateInstanceChanged', stateInstance: 'notAuthorized' },
    }),
    acknowledge: vi.fn().mockResolvedValue(undefined),
  };
  await pollNotifications(api, new AbortController().signal, () => false, vi.fn());
  expect(api.acknowledge).toHaveBeenCalledWith(9, expect.any(AbortSignal));
  expect(api.receive).toHaveBeenCalledTimes(1);
});
