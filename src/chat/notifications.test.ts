import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createNotificationManager,
  isNotificationSupported,
  requestNotificationPermission,
} from './notifications';

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted');
  static instances: MockNotification[] = [];
  static fail = false;
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    if (MockNotification.fail) throw new Error('Notifications unavailable');
    MockNotification.instances.push(this);
  }
}
const message = { id: 'reply-1', text: 'Привет!\nКак дела?' };
const context = { chatId: 'chat-1', name: 'Анна' };
const focus = vi.fn();
beforeEach(() => {
  MockNotification.permission = 'granted';
  MockNotification.instances = [];
  MockNotification.fail = false;
  MockNotification.requestPermission.mockReset();
  MockNotification.requestPermission.mockResolvedValue('granted');
  focus.mockReset();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Notification', MockNotification);
  vi.stubGlobal('document', { visibilityState: 'hidden', hasFocus: () => false });
  vi.stubGlobal('window', { focus });
});
afterEach(() => vi.unstubAllGlobals());

it('requires a secure context and browser Notification support', async () => {
  expect(isNotificationSupported()).toBe(true);
  vi.stubGlobal('isSecureContext', false);
  expect(isNotificationSupported()).toBe(false);
  expect(await requestNotificationPermission()).toBe('denied');
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Notification', undefined);
  expect(isNotificationSupported()).toBe(false);
  expect(await requestNotificationPermission()).toBe('denied');
});
it('requests permission only explicitly and handles browser rejection', async () => {
  MockNotification.permission = 'default';
  createNotificationManager(vi.fn()).notify(message, context);
  expect(MockNotification.requestPermission).not.toHaveBeenCalled();
  expect(await requestNotificationPermission()).toBe('granted');
  MockNotification.requestPermission.mockRejectedValue(new Error('Blocked'));
  expect(await requestNotificationPermission()).toBe('default');
});
it('does not re-request settled permission or notify without permission', async () => {
  for (const permission of ['denied', 'granted'] as const) {
    MockNotification.permission = permission;
    expect(await requestNotificationPermission()).toBe(permission);
  }
  expect(MockNotification.requestPermission).not.toHaveBeenCalled();
  MockNotification.permission = 'denied';
  createNotificationManager(vi.fn()).notify(message, context);
  expect(MockNotification.instances).toHaveLength(0);
});
it('suppresses notifications in a visible focused tab, including later redelivery', () => {
  const manager = createNotificationManager(vi.fn());
  vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true });
  manager.notify(message, context);
  vi.stubGlobal('document', { visibilityState: 'hidden', hasFocus: () => false });
  manager.notify(message, context);
  expect(MockNotification.instances).toHaveLength(0);
});
it('notifies in visible unfocused tabs and hidden focused tabs', () => {
  for (const [visibilityState, hasFocus] of [
    ['visible', false],
    ['hidden', true],
  ] as const) {
    vi.stubGlobal('document', { visibilityState, hasFocus: () => hasFocus });
    createNotificationManager(vi.fn()).notify(message, context);
  }
  expect(MockNotification.instances).toHaveLength(2);
});
it('deduplicates by chat and message ID while preserving distinct chats', () => {
  const manager = createNotificationManager(vi.fn());
  manager.notify(message, context);
  manager.notify(message, context);
  manager.notify(message, { ...context, chatId: 'chat-2' });
  expect(MockNotification.instances).toHaveLength(2);
  expect(MockNotification.instances[0].options.tag).not.toBe(
    MockNotification.instances[1].options.tag,
  );
});
it('uses bounded plain text previews without splitting emoji', () => {
  const manager = createNotificationManager(vi.fn());
  manager.notify({ id: 'long', text: '😀'.repeat(250) }, { ...context, name: 'А'.repeat(100) });
  const notification = MockNotification.instances[0];
  expect(Array.from(notification.options.body ?? '')).toHaveLength(180);
  expect(notification.options.body).toBe(`${'😀'.repeat(179)}…`);
  expect(Array.from(notification.title)).toHaveLength(80);
  manager.notify({ id: 'plain', text: '<b>Текст</b>\n новая строка' }, context);
  expect(MockNotification.instances[1].options.body).toBe('<b>Текст</b> новая строка');
});
it('focuses the window, opens the correct chat and closes on click', () => {
  const onOpen = vi.fn();
  const manager = createNotificationManager(onOpen);
  manager.notify(message, context);
  const notification = MockNotification.instances[0];
  notification.onclick?.();
  expect(focus).toHaveBeenCalledOnce();
  expect(onOpen).toHaveBeenCalledWith('chat-1');
  expect(notification.close).toHaveBeenCalledOnce();
  expect(notification.onclick).toBeNull();
  expect(focus.mock.invocationCallOrder[0]).toBeLessThan(onOpen.mock.invocationCallOrder[0]);
});
it('closes active notifications on logout and prevents later callbacks', () => {
  const onOpen = vi.fn();
  const manager = createNotificationManager(onOpen);
  manager.notify(message, context);
  const notification = MockNotification.instances[0];
  const oldClick = notification.onclick;
  manager.dispose();
  manager.dispose();
  expect(notification.close).toHaveBeenCalledOnce();
  expect(notification.onclick).toBeNull();
  oldClick?.();
  manager.notify({ ...message, id: 'late' }, context);
  expect(onOpen).not.toHaveBeenCalled();
  expect(MockNotification.instances).toHaveLength(1);
});
it('removes closed notifications from the cleanup set without forgetting deduplication', () => {
  const manager = createNotificationManager(vi.fn());
  manager.notify(message, context);
  const notification = MockNotification.instances[0];
  notification.onclose?.();
  manager.notify(message, context);
  manager.dispose();
  expect(notification.close).not.toHaveBeenCalled();
  expect(MockNotification.instances).toHaveLength(1);
});
it('handles constructor and focus failures without interrupting incoming processing', () => {
  const manager = createNotificationManager(vi.fn());
  MockNotification.fail = true;
  expect(() => manager.notify(message, context)).not.toThrow();
  MockNotification.fail = false;
  focus.mockImplementationOnce(() => {
    throw new Error('Focus blocked');
  });
  manager.notify({ ...message, id: 'next' }, context);
  expect(() => MockNotification.instances[0].onclick?.()).not.toThrow();
  expect(MockNotification.instances[0].close).toHaveBeenCalledOnce();
});
