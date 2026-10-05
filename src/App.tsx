import { useEffect, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
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
import { GreenApi, normalizePhone, validateCredentials } from './api/green-api';
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
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? 'small' : ''}`}>
      <Send size={small ? 23 : 37} fill="currentColor" strokeWidth={1.4} />
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
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Закрыть">
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Login({ onConnect }: { onConnect: (api: GreenApi, warnings: string[]) => void }) {
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
    : 'https://4100.api.green-api.com';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      const api = new GreenApi(
        validateCredentials({ idInstance, apiTokenInstance, apiUrl: apiUrl || suggestedUrl }),
      );
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
          <Logo small />
          <span>
            Telegram <span className="brand-divider">/</span>{' '}
            <span className="muted">GREEN-API</span>
          </span>
        </div>
        <a href="https://green-api.com/telegram/docs/" target="_blank" rel="noreferrer">
          Документация <ChevronRight size={16} />
        </a>
      </header>
      <section className="login-card">
        <Logo />
        <h1>Начните разговор</h1>
        <p className="intro">
          Подключите Telegram через GREEN-API,
          <br />
          чтобы отправлять и получать сообщения.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="instance">idInstance</label>
          <input
            id="instance"
            inputMode="numeric"
            placeholder="Например, 4100000000"
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
          Токен хранится только в памяти этой вкладки.
        </p>
        <div className="login-help">
          Еще нет инстанса?{' '}
          <a href="https://console.green-api.com/" target="_blank" rel="noreferrer">
            Открыть GREEN-API ↗
          </a>
        </div>
      </section>
      <footer className="landing-footer">
        Только текст. Только самое нужное.<span>React · Telegram · GREEN-API</span>
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
  api: GreenApi;
  warnings: string[];
  logout: () => void;
}) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [search, setSearch] = useState('');
  const [newChat, setNewChat] = useState(false);
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [chatError, setChatError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [pollState, setPollState] = useState<PollState>('connected');
  const [pollError, setPollError] = useState('');
  const [pollAttempt, setPollAttempt] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
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
      (body) => {
        if (body.typeWebhook === 'stateInstanceChanged' && body.stateInstance !== 'authorized') {
          setPollState('stopped');
          setPollError(
            'Инстанс отключен. Авторизуйте Telegram в кабинете GREEN-API и возобновите получение.',
          );
          return false;
        }
        dispatch({ type: 'notification', body });
      },
      (status, message) => {
        setPollState(status);
        setPollError(message ?? '');
      },
    );
    return () => controller.abort();
  }, [api, pollAttempt]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.id, chat?.messages.length]);
  useEffect(() => {
    setSendError('');
    textarea.current?.focus();
  }, [chat?.id]);
  async function createChat(event: FormEvent) {
    event.preventDefault();
    if (resolving.current) return;
    resolving.current = true;
    setChatError('');
    setCreating(true);
    const signal = lifetime.current!.signal;
    try {
      const normalized = normalizePhone(phone);
      const id = await api.resolvePhone(normalized, signal);
      if (!signal.aborted) {
        dispatch({ type: 'open', id, name: `+${normalized}`, phone: normalized });
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
    if (!chat || submitting.current || !draft.trim() || draft.length > 4096) return;
    submitting.current = true;
    setSending(true);
    setSendError('');
    const chatId = chat.id;
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
        setSendError(
          `${errorText(error)} Текст сохранен. При сетевой ошибке проверьте Telegram перед повторной отправкой.`,
        );
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
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="brand">
            <Logo small />
            <div>
              <strong>Telegram</strong>
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
        <footer className="connection">
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
            {pollError}
            {pollState === 'reconnecting' && ' Повторяем подключение автоматически.'}
          </div>
        )}
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
                <h1>{chat.name}</h1>
                <p>
                  {chat.phone && chat.name !== `+${chat.phone}` ? `+${chat.phone} · ` : ''}Telegram
                  · текстовые сообщения
                </p>
              </div>
            </header>
            <div className="messages" role="log" aria-label="Сообщения" aria-live="polite">
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
              {sendError && <Alert>{sendError}</Alert>}
              <form className="composer" onSubmit={send}>
                <textarea
                  ref={textarea}
                  aria-label="Сообщение"
                  placeholder="Написать сообщение…"
                  rows={1}
                  maxLength={4096}
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
                <span>Enter — отправить · Shift + Enter — новая строка</span>
                {draft.length > 3500 && <span>{draft.length} / 4096</span>}
              </div>
            </div>
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-icon">
              <Send size={48} strokeWidth={1.4} />
            </div>
            <span className="eyebrow">ВАШ TELEGRAM, МИНИМАЛИСТИЧНО</span>
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
              Сообщения отправляются через GREEN-API
            </span>
          </div>
        )}
      </section>
      {newChat && (
        <Modal
          title="Новый чат"
          close={() => {
            if (!creating) setNewChat(false);
          }}
        >
          <p className="modal-description">
            Введите номер собеседника, зарегистрированного в Telegram.
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
            <p className="field-hint">Международный формат с кодом страны.</p>
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
            Telegram.
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
  const [connection, setConnection] = useState<{ api: GreenApi; warnings: string[] } | null>(null);
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
