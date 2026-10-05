import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowDown,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { createMessengerAdapter, messengerInfo, messengers } from './messengers/adapters';
import type { MessengerAdapter, MessengerId } from './messengers/types';
import { pollNotifications, type PollState } from './api/polling';
import { chatReducer, initialState, type Message } from './chat/state';

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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const resolving = useRef(false);
  const chat = state.chats.find((item) => item.id === state.activeId);
  const draft = chat ? (drafts[chat.id] ?? '') : '';
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setPollState('connected');
    setPollError('');
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
        dispatch({ type: 'event', event });
      },
      (status, message) => {
        setPollState(status);
        setPollError(message ?? '');
      },
    );
    return () => controller.abort();
  }, [api, pollAttempt]);
  useEffect(() => {
    const changedChat = lastViewedChat.current !== chat?.id;
    if (changedChat || nearBottom.current) {
      nearBottom.current = true;
      setUnseenBelow(false);
      end.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }
    if (!changedChat && !nearBottom.current) setUnseenBelow(true);
    lastViewedChat.current = chat?.id;
  }, [chat?.id, chat?.messages.length]);
  useEffect(() => {
    textarea.current?.focus();
  }, [chat?.id]);
  useEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight + field.offsetHeight - field.clientHeight, 160)}px`;
  }, [draft, chat?.id]);
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
      const id = await api.sendMessage(chatId, text, signal);
      if (!signal.aborted) {
        dispatch({
          type: 'sent',
          chatId,
          message: { id, text, timestamp: Date.now(), outgoing: true, status: 'queued' },
        });
        setDrafts((previous) => ({
          ...previous,
          [chatId]: previous[chatId] === text ? '' : previous[chatId],
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
              </header>
              <div
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
                  {!chat.messages.length && (
                    <div className="chat-start">
                      <MessageCircle size={28} />
                      <strong>Первое сообщение — за вами</strong>
                      <p>Напишите собеседнику. Его ответ появится здесь.</p>
                    </div>
                  )}
                  {chat.messages.map((message, index) => (
                    <div key={message.id}>
                      {(index === 0 ||
                        date(message.timestamp) !== date(chat.messages[index - 1].timestamp)) && (
                        <div className="date-separator">
                          <span>{date(message.timestamp)}</span>
                        </div>
                      )}
                      <div className={`message-row ${message.outgoing ? 'outgoing' : 'incoming'}`}>
                        <div className={`bubble ${message.status === 'failed' ? 'failed' : ''}`}>
                          <p>{message.text}</p>
                          <span className="message-meta">
                            {message.status === 'failed' && <span>Не доставлено</span>}
                            <time dateTime={new Date(message.timestamp).toISOString()}>
                              {time(message.timestamp)}
                            </time>
                            <Delivery message={message} />
                          </span>
                        </div>
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
                Чаты и черновики доступны до обновления вкладки
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
