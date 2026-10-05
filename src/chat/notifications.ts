export interface NotificationMessage {
  id: string;
  text: string;
}
export interface NotificationContext {
  chatId: string;
  name: string;
}

export function isNotificationSupported(): boolean {
  return globalThis.isSecureContext === true && typeof Notification !== 'undefined';
}

// Invoke only from an explicit user gesture, never while receiving messages.
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  try {
    if (Notification.permission !== 'default') return Notification.permission;
    return await Notification.requestPermission();
  } catch {
    return 'default';
  }
}

function preview(text: string, limit: number): string {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length > limit
    ? `${characters.slice(0, limit - 1).join('')}…`
    : characters.join('');
}

// Feed only new live incoming replies; history and outgoing messages are excluded by callers.
export function createNotificationManager(onOpenChat: (chatId: string) => void) {
  const seen = new Set<string>();
  const active = new Map<string, Notification>();
  let disposed = false;

  function close(tag: string, notification: Notification) {
    active.delete(tag);
    notification.onclick = null;
    notification.onclose = null;
    try {
      notification.close();
    } catch {
      // Unsupported notification backends must not interrupt the chat lifecycle.
    }
  }

  return {
    notify(message: NotificationMessage, context: NotificationContext): void {
      if (disposed) return;
      const tag = JSON.stringify([context.chatId, message.id]);
      if (seen.has(tag)) return;
      seen.add(tag);
      if (
        !isNotificationSupported() ||
        typeof document === 'undefined' ||
        Notification.permission !== 'granted' ||
        (document.visibilityState === 'visible' && document.hasFocus())
      )
        return;
      try {
        const notification = new Notification(preview(context.name, 80) || 'Новое сообщение', {
          body: preview(message.text, 180),
          tag,
        });
        active.set(tag, notification);
        notification.onclick = () => {
          if (disposed) return;
          try {
            window.focus();
          } catch {
            // Some browsers restrict focusing a background window.
          }
          try {
            onOpenChat(context.chatId);
          } finally {
            close(tag, notification);
          }
        };
        notification.onclose = () => {
          active.delete(tag);
          notification.onclick = null;
          notification.onclose = null;
        };
      } catch {
        // Browsers may expose the API but reject desktop notifications at runtime.
      }
    },
    dispose(): void {
      disposed = true;
      for (const [tag, notification] of active) close(tag, notification);
      active.clear();
      seen.clear();
    },
  };
}
