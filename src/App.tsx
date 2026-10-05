import {
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowDown,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  LogOut,
  MessageCircle,
  Plus,
  Reply,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { createMessengerAdapter, messengerInfo, messengers } from './messengers/adapters';
import type { MessengerAdapter, MessengerId } from './messengers/types';
import { pollNotifications, type PollState } from './api/polling';
import { chatReducer, initialState, type Message } from './chat/state';
import {
  createNotificationManager,
  isNotificationSupported,
  requestNotificationPermission,
} from './chat/notifications';

const time = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const date = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Произошла ошибка. Попробуйте еще раз.';
function Logo({
  small = false,
  messenger = 'telegram',
}: {
  small?: boolean;
  messenger?: MessengerId;
}) {
  const Icon = messenger === 'telegram' ? Send : MessageCircle;
  return (
    <span className={`logo ${small ? 'small' : ''}`}>
      <Icon
        size={small ? 23 : 37}
        fill={messenger === 'telegram' ? 'currentColor' : 'none'}
        strokeWidth={1.4}
      />
    </span>
  );
}
function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <CircleAlert size={18} />
      <span>{children}</span>
    </div>
  );
}
function Highlight({ text, query }: { text: string; query: string }) {
  const term = query.trim().toLowerCase();
  if (!term) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let start = 0;
  let index = lower.indexOf(term);
  while (index !== -1) {
    parts.push(text.slice(start, index));
    parts.push(<mark key={index}>{text.slice(index, index + term.length)}</mark>);
    start = index + term.length;
    index = lower.indexOf(term, start);
  }
  parts.push(text.slice(start));
  return parts;
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    (
      dialog.querySelector<HTMLInputElement>('input:not([disabled])') ??
      dialog.querySelector<HTMLButtonElement>('button')
    )?.focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Закрыть">
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Login({ onConnect }: { onConnect: (api: MessengerAdapter, warnings: string[]) => void }) {
  const [messenger, setMessenger] = useState<MessengerId>('telegram');
  const info = messengerInfo[messenger];
  const [idInstance, setId] = useState('');
  const [apiTokenInstance, setToken] = useState('');
  const [apiUrl, setUrl] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const suggestedUrl = /^\d{4}/.test(idInstance.trim())
    ? `https://${idInstance.trim().slice(0, 4)}.api.green-api.com`
    : info.defaultApiUrl;
  useEffect(() => {
    document.title = `${info.label} — GREEN-API Chat`;
  }, [info.label]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      const api = createMessengerAdapter(messenger, {
        idInstance,
        apiTokenInstance,
        apiUrl: apiUrl || suggestedUrl,
      });
      const warnings = await api.connect(signal);
      if (!signal.aborted) onConnect(api, warnings);
    } catch (error) {
      if (!signal.aborted) setError(errorText(error));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <header className="landing-header">
        <div className="brand">
          <Logo small messenger={info.id} />
          <span>
            {info.label} <span className="brand-divider">/</span>{' '}
            <span className="muted">GREEN-API</span>
          </span>
        </div>
        <a href={info.docsUrl} target="_blank" rel="noreferrer">
          Документация <ChevronRight size={16} />
        </a>
      </header>
      <section className="login-card">
        <Logo messenger={info.id} />
        <h1>Начните разговор</h1>
        <p className="intro">
          Подключите {info.label} через GREEN-API,
          <br />
          чтобы отправлять и получать сообщения.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="messenger">Мессенджер</label>
          <select
            id="messenger"
            value={messenger}
            disabled={busy}
            onChange={(event) => {
              setMessenger(event.target.value as MessengerId);
              setId('');
              setToken('');
              setShowToken(false);
              setUrl('');
              setError('');
            }}
          >
            {messengers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <p className="field-hint">Используйте данные инстанса выбранного мессенджера.</p>
          <label htmlFor="instance">idInstance</label>
          <input
            id="instance"
            inputMode="numeric"
            placeholder={`Например, ${info.exampleInstance}`}
            value={idInstance}
            onChange={(e) => setId(e.target.value)}
            required
            disabled={busy}
            autoComplete="off"
          />
          <label htmlFor="token">apiTokenInstance</label>
          <div className="token-input">
            <input
              id="token"
              type={showToken ? 'text' : 'password'}
              placeholder="Ваш токен доступа"
              value={apiTokenInstance}
              onChange={(e) => setToken(e.target.value)}
              required
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
              onClick={() => setShowToken(!showToken)}
            >
              {showToken ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
          <details>
            <summary>Адрес сервера API</summary>
            <label htmlFor="api-url">apiUrl из личного кабинета</label>
            <input
              id="api-url"
              type="url"
              value={apiUrl}
              placeholder={suggestedUrl}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
            <p className="field-hint">
              По умолчанию определяется по первым четырем цифрам idInstance. При необходимости
              укажите адрес из кабинета.
            </p>
          </details>
          {error && <Alert>{error}</Alert>}
          <button className="primary login-submit" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" />
                Подключение…
              </>
            ) : (
              <>
                Подключиться <ChevronRight size={18} />
              </>
            )}
          </button>
        </form>
        <p className="privacy">
          <ShieldCheck size={16} />
          Токен, чаты и черновики удаляются при обновлении вкладки.
        </p>
        <div className="login-help">
          Еще нет инстанса?{' '}
          <a href="https://console.green-api.com/" target="_blank" rel="noreferrer">
            Открыть GREEN-API ↗
          </a>
        </div>
      </section>
      <footer className="landing-footer">
        Только текст. Только самое нужное.<span>React · GREEN-API</span>
      </footer>
    </main>
  );
}
function Delivery({ message }: { message: Message }) {
  if (!message.outgoing) return null;
  const status = message.status ?? 'queued';
  const labels = {
    queued: 'В очереди',
    sent: 'Отправлено',
    delivered: 'Доставлено',
    read: 'Прочитано',
    failed: 'Не доставлено',
  };
  return (
    <span className={`delivery ${status}`} aria-label={labels[status]} title={labels[status]}>
      {status === 'failed' ? (
        <CircleAlert size={14} />
      ) : ['delivered', 'read'].includes(status) ? (
        <CheckCheck size={15} />
      ) : status === 'queued' ? (
        <span className="queued">◷</span>
      ) : (
        <Check size={15} />
      )}
    </span>
  );
}
function Messenger({
  api,
  warnings,
  logout,
}: {
  api: MessengerAdapter;
  warnings: string[];
  logout: () => void;
}) {
  const info = api.info;
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [search, setSearch] = useState('');
  const [newChat, setNewChat] = useState(false);
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [chatError, setChatError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replies, setReplies] = useState<Record<string, Message | undefined>>({});
  const [history, setHistory] = useState<
    Record<string, { loading: boolean; count: number; error?: string }>
  >({});
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageQuery, setMessageQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [notificationMode, setNotificationMode] = useState<'off' | 'on' | 'denied' | 'unsupported'>(
    () => (isNotificationSupported() ? 'off' : 'unsupported'),
  );
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [notificationNotice, setNotificationNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [unseenBelow, setUnseenBelow] = useState(false);
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [pollState, setPollState] = useState<PollState>('connected');
  const [pollError, setPollError] = useState('');
  const [pollAttempt, setPollAttempt] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastViewedChat = useRef<string | undefined>(undefined);
  const lastViewedCount = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messageViewport = useRef<HTMLDivElement>(null);
  const messageElements = useRef(new Map<string, HTMLDivElement>());
  const searchField = useRef<HTMLInputElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const historyRequests = useRef(new Set<string>());
  const historyScroll = useRef<{
    chatId: string;
    messageId?: string;
    offset: number;
    top: number;
  } | null>(null);
  const notificationManager = useRef<ReturnType<typeof createNotificationManager> | null>(null);
  const submitting = useRef(false);
  const resolving = useRef(false);
  const chat = state.chats.find((item) => item.id === state.activeId);
  const draft = chat ? (drafts[chat.id] ?? '') : '';
  const reply = chat ? replies[chat.id] : undefined;
  const matchingMessages =
    chat?.messages.filter((message) =>
      messageQuery.trim()
        ? message.text.toLowerCase().includes(messageQuery.trim().toLowerCase())
        : false,
    ) ?? [];
  const activeMatch = matchingMessages[Math.min(matchIndex, matchingMessages.length - 1)];
  const activeMatchId = activeMatch?.id;
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (notificationMode !== 'on') return;
    const manager = createNotificationManager((id) => {
      const target = stateRef.current.chats.find(
        (item) => item.id === id || item.aliases.includes(id),
      );
      if (target) dispatch({ type: 'select', id: target.id });
    });
    notificationManager.current = manager;
    return () => {
      notificationManager.current = null;
      manager.dispose();
    };
  }, [notificationMode]);
  useEffect(() => {
    const controller = new AbortController();
    setPollState('connected');
    setPollError('');
    const startedAt = Math.floor(Date.now() / 1000) * 1000;
    void pollNotifications(
      api,
      controller.signal,
      async (body) => {
        const event = api.decodeNotification(body);
        if (!event) return;
        if (
          event.type === 'state' &&
          event.state !== 'authorized' &&
          (await api.getStateInstance(controller.signal)) !== 'authorized'
        ) {
          if (controller.signal.aborted) return;
          setPollState('stopped');
          setPollError(
            'Инстанс отключен. Авторизуйте мессенджер в кабинете GREEN-API и возобновите получение.',
          );
          return false;
        }
        if (
          event.type === 'message' &&
          !event.message.outgoing &&
          event.message.timestamp >= startedAt
        ) {
          const existing = stateRef.current.chats.find(
            (item) => item.id === event.chatId || item.aliases.includes(event.chatId),
          );
          if (!existing?.messages.some((message) => message.id === event.message.id))
            notificationManager.current?.notify(event.message, {
              chatId: existing?.id ?? event.chatId,
              name: event.name || existing?.name || event.chatId,
            });
        }
        dispatch({ type: 'event', event });
      },
      (status, message) => {
        setPollState(status);
        setPollError(message ?? '');
      },
    );
    return () => controller.abort();
  }, [api, pollAttempt]);
  useLayoutEffect(() => {
    const changedChat = lastViewedChat.current !== chat?.id;
    const countChanged = lastViewedCount.current !== (chat?.messages.length ?? 0);
    lastViewedChat.current = chat?.id;
    lastViewedCount.current = chat?.messages.length ?? 0;
    const restore = historyScroll.current;
    if (!changedChat && restore && restore.chatId === chat?.id && messageViewport.current) {
      const viewport = messageViewport.current;
      const anchor =
        restore.messageId &&
        messageElements.current.get(restore.messageId)?.querySelector('.message-row');
      viewport.scrollTop = anchor
        ? viewport.scrollTop +
          anchor.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          restore.offset
        : restore.top;
      historyScroll.current = null;
      return;
    }
    if (changedChat) historyScroll.current = null;
    if (changedChat || (countChanged && nearBottom.current)) {
      nearBottom.current = true;
      setUnseenBelow(false);
      end.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }
    if (!changedChat && countChanged && !nearBottom.current) setUnseenBelow(true);
  }, [chat?.id, chat?.messages]);
  useEffect(() => {
    setMessageQuery('');
    setMatchIndex(0);
    setMessageSearchOpen(false);
    if (chat?.id && !historyRequests.current.has(chat.id)) void loadHistory(chat.id, 100);
    // Each chat's history loads once on first selection; refresh and expansion are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);
  useEffect(() => {
    if (messageSearchOpen) searchField.current?.focus();
  }, [messageSearchOpen]);
  useEffect(() => {
    if (!messageSearchOpen || !activeMatchId) return;
    messageElements.current
      .get(activeMatchId)
      ?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [activeMatchId, messageSearchOpen, chat?.id]);
  useEffect(() => {
    textarea.current?.focus();
  }, [chat?.id]);
  useEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight + field.offsetHeight - field.clientHeight, 160)}px`;
  }, [draft, chat?.id]);
  async function toggleNotifications() {
    setNotificationNotice('');
    if (notificationMode === 'on') {
      setNotificationMode('off');
      return;
    }
    if (!isNotificationSupported()) {
      setNotificationMode('unsupported');
      setNotificationNotice(
        'Этот браузер не поддерживает уведомления. Используйте HTTPS или localhost.',
      );
      return;
    }
    setRequestingPermission(true);
    const permission = await requestNotificationPermission();
    if (lifetime.current?.signal.aborted) return;
    setRequestingPermission(false);
    setNotificationMode(
      permission === 'granted' ? 'on' : permission === 'denied' ? 'denied' : 'off',
    );
    if (permission !== 'granted')
      setNotificationNotice(
        permission === 'denied'
          ? 'Уведомления заблокированы. Разрешите их в настройках сайта в браузере.'
          : 'Разрешение на уведомления не получено. Их можно включить позже.',
      );
  }
  const notificationLabel =
    notificationMode === 'on' ? 'Выключить уведомления' : 'Включить уведомления';
  const notificationButton = (mobile = false) => (
    <button
      className={`icon-button ${mobile ? 'mobile-notifications' : ''}`}
      aria-label={notificationLabel}
      aria-pressed={notificationMode === 'on'}
      title={
        notificationMode === 'unsupported'
          ? 'Уведомления недоступны в этом браузере'
          : notificationLabel
      }
      disabled={requestingPermission}
      onClick={() => void toggleNotifications()}
    >
      {notificationMode === 'on' ? <Bell size={20} /> : <BellOff size={20} />}
    </button>
  );
  async function loadHistory(chatId: string, count: number) {
    if (historyRequests.current.has(`pending:${chatId}`)) return;
    historyRequests.current.add(chatId);
    historyRequests.current.add(`pending:${chatId}`);
    setHistory((previous) => ({ ...previous, [chatId]: { loading: true, count } }));
    const signal = lifetime.current!.signal;
    try {
      const messages = await api.getChatHistory(chatId, count, signal);
      if (signal.aborted) return;
      const existing = stateRef.current.chats.find(
        (item) => item.id === chatId || item.aliases.includes(chatId),
      );
      if (stateRef.current.activeId === chatId && !nearBottom.current && messageViewport.current) {
        const viewport = messageViewport.current;
        const top = viewport.getBoundingClientRect().top;
        const anchor = existing?.messages.find((message) => {
          const element = messageElements.current.get(message.id)?.querySelector('.message-row');
          return element && element.getBoundingClientRect().bottom > top;
        });
        const element =
          anchor && messageElements.current.get(anchor.id)?.querySelector('.message-row');
        historyScroll.current = {
          chatId,
          messageId: anchor?.id,
          offset: element ? element.getBoundingClientRect().top - top : 0,
          top: viewport.scrollTop,
        };
      }
      dispatch({ type: 'history', chatId, messages });
      setHistory((previous) => ({ ...previous, [chatId]: { loading: false, count } }));
    } catch (error) {
      if (!signal.aborted)
        setHistory((previous) => ({
          ...previous,
          [chatId]: { loading: false, count, error: errorText(error) },
        }));
    } finally {
      historyRequests.current.delete(`pending:${chatId}`);
    }
  }
  async function createChat(event: FormEvent) {
    event.preventDefault();
    if (resolving.current) return;
    resolving.current = true;
    setChatError('');
    setCreating(true);
    const signal = lifetime.current!.signal;
    try {
      const recipient = await api.resolvePhone(phone, signal);
      if (!signal.aborted) {
        dispatch({
          type: 'open',
          id: recipient.chatId,
          name: `+${recipient.phone}`,
          phone: recipient.phone,
          aliases: recipient.aliases,
        });
        setNewChat(false);
        setPhone('');
      }
    } catch (error) {
      if (!signal.aborted) setChatError(errorText(error));
    } finally {
      resolving.current = false;
      if (!signal.aborted) setCreating(false);
    }
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!chat || submitting.current || !draft.trim() || draft.length > info.maxTextLength) return;
    submitting.current = true;
    setSending(true);
    const chatId = chat.id;
    setSendErrors((previous) => ({ ...previous, [chatId]: '' }));
    const text = draft;
    const signal = lifetime.current!.signal;
    try {
      const id = await api.sendMessage(chatId, text, signal, reply?.id);
      if (!signal.aborted) {
        dispatch({
          type: 'sent',
          chatId,
          message: {
            id,
            text,
            timestamp: Date.now(),
            outgoing: true,
            status: 'queued',
            quote: reply ? { id: reply.id, text: reply.text, outgoing: reply.outgoing } : undefined,
          },
        });
        setDrafts((previous) => ({
          ...previous,
          [chatId]: previous[chatId] === text ? '' : previous[chatId],
        }));
        setReplies((previous) => ({
          ...previous,
          [chatId]: previous[chatId]?.id === reply?.id ? undefined : previous[chatId],
        }));
      }
    } catch (error) {
      if (!signal.aborted)
        setSendErrors((previous) => ({
          ...previous,
          [chatId]: `${errorText(error)} Текст сохранен. При сетевой ошибке проверьте ${info.label} перед повторной отправкой.`,
        }));
    } finally {
      submitting.current = false;
      if (!signal.aborted) {
        setSending(false);
        textarea.current?.focus();
      }
    }
  }
  const visibleChats = state.chats.filter((item) =>
    `${item.name} ${item.phone ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );
  const sortedChats = [...visibleChats].sort(
    (a, b) => (b.messages.at(-1)?.timestamp ?? 0) - (a.messages.at(-1)?.timestamp ?? 0),
  );
  return (
    <main className={`messenger ${chat ? 'chat-open' : ''}`}>
      <div className="global-notices">
        {notificationNotice && (
          <div className="notice notification-notice" role="status">
            <BellOff size={18} />
            <span>{notificationNotice}</span>
            <button
              className="icon-button"
              aria-label="Закрыть подсказку уведомлений"
              onClick={() => setNotificationNotice('')}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {state.deliveryError && (
          <div className="delivery-error" role="alert">
            <CircleAlert size={18} />
            <div>
              <strong>
                Ошибка отправки ·{' '}
                {state.chats.find(
                  (item) =>
                    item.id === state.deliveryError?.chatId ||
                    item.aliases.includes(state.deliveryError?.chatId ?? ''),
                )?.name ?? state.deliveryError.chatId}
              </strong>
              <p>
                {state.deliveryError.message} Сервис не указал ID сообщения, поэтому проверьте
                результат в {info.label}.
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Закрыть ошибку отправки"
              onClick={() => dispatch({ type: 'dismissDeliveryError' })}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="notice">
            <CircleAlert size={18} />
            <div>
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
            <a href="https://console.green-api.com/" target="_blank" rel="noreferrer">
              Настройки ↗
            </a>
          </div>
        )}
        {pollError && (
          <div className="poll-error" role="status">
            <span>
              {pollError}
              {pollState === 'reconnecting' && ' Повторяем подключение автоматически.'}
            </span>
            {pollState === 'stopped' && (
              <button className="secondary" onClick={() => setPollAttempt((value) => value + 1)}>
                Возобновить получение
              </button>
            )}
          </div>
        )}
      </div>
      <div className="chat-layout">
        <aside className="sidebar">
          <header className="sidebar-header">
            <div className="brand">
              <Logo small messenger={info.id} />
              <div>
                <strong>{info.label}</strong>
                <span className="account-label">GREEN-API · {api.credentials.idInstance}</span>
              </div>
            </div>
            {notificationButton()}
            <button
              className="icon-button"
              aria-label="Выйти"
              title="Выйти"
              onClick={() => setConfirmExit(true)}
            >
              <LogOut size={20} />
            </button>
          </header>
          <div className="sidebar-tools">
            <div className="search-input">
              <Search size={19} />
              <input
                aria-label="Поиск чатов"
                placeholder="Поиск"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button
              className="new-chat-button"
              onClick={() => {
                setChatError('');
                setNewChat(true);
              }}
            >
              <Plus size={20} />
              Новый чат
            </button>
          </div>
          <div className="chat-list" aria-label="Чаты">
            {sortedChats.map((item) => {
              const last = item.messages.at(-1);
              return (
                <button
                  className={`chat-item ${chat?.id === item.id ? 'selected' : ''}`}
                  key={item.id}
                  onClick={() => dispatch({ type: 'select', id: item.id })}
                >
                  <span className="avatar">
                    {item.name.startsWith('+')
                      ? item.name.slice(-2)
                      : item.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="chat-item-content">
                    <span className="chat-item-top">
                      <strong>{item.name}</strong>
                      <time>{last ? time(last.timestamp) : ''}</time>
                    </span>
                    <span className="chat-item-bottom">
                      <span>
                        {last ? `${last.outgoing ? 'Вы: ' : ''}${last.text}` : 'Начните разговор'}
                      </span>
                      {item.unread > 0 && <span className="unread">{item.unread}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
            {!state.chats.length && (
              <div className="sidebar-empty">
                <MessageCircle size={30} />
                <strong>Здесь будут ваши чаты</strong>
                <p>Добавьте собеседника по номеру телефона.</p>
              </div>
            )}
            {state.chats.length > 0 && !visibleChats.length && (
              <p className="no-results">Чаты не найдены</p>
            )}
          </div>
          <footer className="connection" role="status" aria-live="polite">
            <span className={`status-dot ${pollState}`} />
            <span>
              {pollState === 'connected'
                ? 'Получение сообщений включено'
                : pollState === 'reconnecting'
                  ? 'Переподключение…'
                  : 'Получение приостановлено'}
            </span>
            {pollState === 'stopped' && (
              <button onClick={() => setPollAttempt((value) => value + 1)}>Повторить</button>
            )}
          </footer>
        </aside>
        <section className="conversation">
          {chat ? (
            <>
              <header className="conversation-header">
                <button
                  className="icon-button back"
                  aria-label="Назад к чатам"
                  onClick={() => dispatch({ type: 'select', id: null })}
                >
                  <ArrowLeft size={23} />
                </button>
                <span className="avatar header-avatar">
                  {chat.name.startsWith('+')
                    ? chat.name.slice(-2)
                    : chat.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <h1 title={chat.name}>{chat.name}</h1>
                  <p>
                    {chat.phone && chat.name !== `+${chat.phone}` && <span>+{chat.phone}</span>}
                    <span role="status" aria-live="polite">
                      {info.label} ·{' '}
                      {pollState === 'connected'
                        ? 'Получение включено'
                        : pollState === 'reconnecting'
                          ? 'Переподключение…'
                          : 'Получение приостановлено'}
                    </span>
                  </p>
                </div>
                {notificationButton(true)}
                <button
                  className="icon-button"
                  aria-label="Поиск по сообщениям"
                  title="Поиск по сообщениям"
                  aria-expanded={messageSearchOpen}
                  onClick={() => setMessageSearchOpen((value) => !value)}
                >
                  <Search size={20} />
                </button>
              </header>
              {messageSearchOpen && (
                <div className="message-search" role="search" aria-label="Поиск в переписке">
                  <div className="search-input">
                    <Search size={18} />
                    <input
                      ref={searchField}
                      aria-label="Текст для поиска"
                      placeholder="Поиск в загруженных сообщениях"
                      value={messageQuery}
                      onChange={(event) => {
                        setMessageQuery(event.target.value);
                        setMatchIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Escape') {
                          setMessageSearchOpen(false);
                          setMessageQuery('');
                          textarea.current?.focus();
                        }
                        if (event.key === 'Enter' && matchingMessages.length) {
                          event.preventDefault();
                          setMatchIndex(
                            (value) =>
                              (value + (event.shiftKey ? matchingMessages.length - 1 : 1)) %
                              matchingMessages.length,
                          );
                        }
                      }}
                    />
                  </div>
                  <span className="search-count" role="status">
                    {messageQuery.trim()
                      ? matchingMessages.length
                        ? `${Math.min(matchIndex, matchingMessages.length - 1) + 1} из ${matchingMessages.length}`
                        : 'Не найдено'
                      : 'Поиск по тексту'}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Предыдущее совпадение"
                    disabled={!matchingMessages.length}
                    onClick={() =>
                      setMatchIndex(
                        (value) => (value + matchingMessages.length - 1) % matchingMessages.length,
                      )
                    }
                  >
                    <ChevronUp size={20} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Следующее совпадение"
                    disabled={!matchingMessages.length}
                    onClick={() => setMatchIndex((value) => (value + 1) % matchingMessages.length)}
                  >
                    <ChevronDown size={20} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Закрыть поиск сообщений"
                    onClick={() => {
                      setMessageSearchOpen(false);
                      setMessageQuery('');
                      textarea.current?.focus();
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>
              )}
              <div className="history-toolbar">
                <span role="status">
                  {history[chat.id]?.loading
                    ? 'Загрузка истории…'
                    : `История: до ${history[chat.id]?.count ?? 100} сообщений`}
                </span>
                <button
                  className="history-button"
                  disabled={history[chat.id]?.loading}
                  onClick={() => void loadHistory(chat.id, history[chat.id]?.count ?? 100)}
                >
                  <RefreshCw size={14} />
                  {history[chat.id]?.error ? 'Повторить загрузку истории' : 'Обновить историю'}
                </button>
                {(history[chat.id]?.count ?? 100) < 5000 && (
                  <button
                    className="history-button"
                    disabled={history[chat.id]?.loading}
                    onClick={() =>
                      void loadHistory(
                        chat.id,
                        Math.min((history[chat.id]?.count ?? 100) * 5, 5000),
                      )
                    }
                  >
                    Загрузить больше
                  </button>
                )}
              </div>
              {history[chat.id]?.error && (
                <div className="history-error" role="alert">
                  {history[chat.id].error} Текущая переписка доступна; можно продолжить отправку.
                </div>
              )}
              <div
                ref={messageViewport}
                className="messages"
                role="log"
                aria-label="Сообщения"
                aria-live="polite"
                onScroll={(event) => {
                  const element = event.currentTarget;
                  nearBottom.current =
                    element.scrollHeight - element.clientHeight - element.scrollTop < 80;
                  if (nearBottom.current) setUnseenBelow(false);
                }}
              >
                <div className="message-column">
                  {!chat.messages.length && !history[chat.id]?.loading && (
                    <div className="chat-start">
                      <MessageCircle size={28} />
                      <strong>Первое сообщение — за вами</strong>
                      <p>Напишите собеседнику. Его ответ появится здесь.</p>
                    </div>
                  )}
                  {chat.messages.map((message, index) => (
                    <div
                      key={message.id}
                      ref={(element) => {
                        if (element) messageElements.current.set(message.id, element);
                        else messageElements.current.delete(message.id);
                      }}
                    >
                      {(index === 0 ||
                        date(message.timestamp) !== date(chat.messages[index - 1].timestamp)) && (
                        <div className="date-separator">
                          <span>{date(message.timestamp)}</span>
                        </div>
                      )}
                      <div className={`message-row ${message.outgoing ? 'outgoing' : 'incoming'}`}>
                        <div
                          className={`bubble ${message.status === 'failed' ? 'failed' : ''} ${messageSearchOpen && activeMatch?.id === message.id ? 'search-match' : ''}`}
                        >
                          {message.quote && (
                            <button
                              className="quoted-message"
                              aria-label="Перейти к цитируемому сообщению"
                              disabled={
                                !chat.messages.some((item) => item.id === message.quote?.id)
                              }
                              title={
                                chat.messages.some((item) => item.id === message.quote?.id)
                                  ? 'Перейти к сообщению'
                                  : 'Исходное сообщение не загружено. Загрузите больше истории.'
                              }
                              onClick={() =>
                                messageElements.current
                                  .get(message.quote!.id)
                                  ?.scrollIntoView({ block: 'center', behavior: 'auto' })
                              }
                            >
                              <strong>Ответ на сообщение</strong>
                              <span>
                                {message.quote.text ||
                                  chat.messages.find((item) => item.id === message.quote?.id)
                                    ?.text ||
                                  'Исходное сообщение не загружено'}
                              </span>
                            </button>
                          )}
                          <p>
                            <Highlight
                              text={message.text}
                              query={messageSearchOpen ? messageQuery : ''}
                            />
                          </p>
                          <span className="message-meta">
                            {message.status === 'failed' && <span>Не доставлено</span>}
                            <time dateTime={new Date(message.timestamp).toISOString()}>
                              {time(message.timestamp)}
                            </time>
                            <Delivery message={message} />
                          </span>
                        </div>
                        <button
                          className="reply-button"
                          aria-label={`Ответить на сообщение: ${message.text.slice(0, 60)}`}
                          title="Ответить"
                          disabled={sending}
                          onClick={() => {
                            setReplies((previous) => ({ ...previous, [chat.id]: message }));
                            textarea.current?.focus();
                          }}
                        >
                          <Reply size={17} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div ref={end} />
                </div>
              </div>
              <div className="composer-area">
                {unseenBelow && (
                  <div className="jump-row">
                    <button
                      className="secondary"
                      onClick={() => {
                        nearBottom.current = true;
                        setUnseenBelow(false);
                        end.current?.scrollIntoView({
                          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'auto'
                            : 'smooth',
                        });
                      }}
                    >
                      <ArrowDown size={16} />К новым сообщениям
                    </button>
                  </div>
                )}
                {sendErrors[chat.id] && <Alert>{sendErrors[chat.id]}</Alert>}
                {reply && (
                  <div className="reply-preview" aria-label="Цитируемое сообщение">
                    <Reply size={20} />
                    <div>
                      <strong>Ответ {reply.outgoing ? 'на ваше сообщение' : chat.name}</strong>
                      <p>{reply.text}</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Отменить ответ"
                      disabled={sending}
                      onClick={() => {
                        setReplies((previous) => ({ ...previous, [chat.id]: undefined }));
                        textarea.current?.focus();
                      }}
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
                <form className="composer" onSubmit={send}>
                  <textarea
                    ref={textarea}
                    aria-label="Сообщение"
                    placeholder="Написать сообщение…"
                    rows={1}
                    maxLength={info.maxTextLength}
                    value={draft}
                    onChange={(event) =>
                      setDrafts((previous) => ({ ...previous, [chat.id]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    className="send-button"
                    aria-label="Отправить сообщение"
                    disabled={sending || !draft.trim()}
                  >
                    {sending ? (
                      <span className="spinner" />
                    ) : (
                      <Send size={23} fill="currentColor" strokeWidth={1.5} />
                    )}
                  </button>
                </form>
                <div className="composer-hint">
                  <span className="desktop-hint">
                    Enter — отправить · Shift + Enter — новая строка
                  </span>
                  <span className="mobile-hint">
                    Только текст · до {info.maxTextLength} символов
                  </span>
                  {draft.length > info.maxTextLength * 0.85 && (
                    <span>
                      {draft.length} / {info.maxTextLength}
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-icon">
                <Send size={48} strokeWidth={1.4} />
              </div>
              <span className="eyebrow">{info.label.toUpperCase()} · ТОЛЬКО ТЕКСТ</span>
              <h1>
                Разговор начинается
                <br />с одного сообщения
              </h1>
              <p>
                Создайте новый чат по номеру телефона
                <br />
                или выберите разговор слева.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setChatError('');
                  setNewChat(true);
                }}
              >
                <Plus size={19} />
                Создать чат
              </button>
              <span className="welcome-note">
                <ShieldCheck size={15} />
                После входа откройте чат по номеру — история загрузится снова
              </span>
            </div>
          )}
        </section>
      </div>
      {newChat && (
        <Modal
          title="Новый чат"
          close={() => {
            if (!creating) setNewChat(false);
          }}
        >
          <p className="modal-description">
            Введите номер собеседника, зарегистрированного в {info.label}.
          </p>
          <form onSubmit={createChat}>
            <label htmlFor="phone">Номер телефона</label>
            <input
              id="phone"
              type="tel"
              placeholder="+7 999 123-45-67"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
              disabled={creating}
              autoFocus
            />
            <p className="field-hint">{info.phoneHint}</p>
            {chatError && <Alert>{chatError}</Alert>}
            <button className="primary full-width" disabled={creating}>
              {creating ? (
                <>
                  <span className="spinner" />
                  Поиск аккаунта…
                </>
              ) : (
                'Создать чат'
              )}
            </button>
          </form>
        </Modal>
      )}
      {confirmExit && (
        <Modal title="Выйти из чата?" close={() => setConfirmExit(false)}>
          <p className="modal-description">
            Токен, переписка и черновики будут удалены из памяти этой вкладки. Сообщения останутся в
            {info.label}.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setConfirmExit(false)}>
              Остаться
            </button>
            <button className="primary" onClick={logout}>
              Выйти
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
export default function App() {
  const [connection, setConnection] = useState<{
    api: MessengerAdapter;
    warnings: string[];
  } | null>(null);
  return connection ? (
    <Messenger
      api={connection.api}
      warnings={connection.warnings}
      logout={() => setConnection(null)}
    />
  ) : (
    <Login onConnect={(api, warnings) => setConnection({ api, warnings })} />
  );
}
