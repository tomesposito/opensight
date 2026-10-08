import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** Scoped to the workspace, so notifications and timers cannot outlive a session. */
export function ToastProvider({ children, duration = 5000 }: { children: ReactNode; duration?: number }) {
  const [messages, setMessages] = useState<string[]>([]);
  const notify = useCallback((message: string) => {
    setMessages(current => current.includes(message) ? current : [...current, message]);
  }, []);
  const dismiss = useCallback((message: string) => setMessages(current => current.filter(item => item !== message)), []);
  return <ToastContext.Provider value={notify}>
    {children}
    <ToastHost messages={messages} dismiss={dismiss} duration={duration} />
  </ToastContext.Provider>;
}

function ToastHost({ messages, dismiss, duration }: { messages: string[]; dismiss: (message: string) => void; duration: number }) {
  // Keep the live region mounted before its text changes. Announce additions,
  // without re-reading the stack when another notification is removed.
  return <div className="toast-host" role="status" aria-label="Notifications" aria-live="polite" aria-atomic="false" aria-relevant="additions">
    {messages.map(message => <Toast key={message} message={message} dismiss={dismiss} duration={duration} />)}
  </div>;
}

function Toast({ message, dismiss, duration }: { message: string; dismiss: (message: string) => void; duration: number }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    setLeaving(false);
    if (hovered || focused) return;
    const fade = setTimeout(() => setLeaving(true), duration);
    const remove = setTimeout(() => dismiss(message), duration + 180);
    return () => { clearTimeout(fade); clearTimeout(remove); };
  }, [message, dismiss, duration, hovered, focused]);
  return <div className={`toast${leaving ? ' toast-leaving' : ''}`}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
    <span>{message}</span>
    <button type="button" aria-label={`Dismiss notification: ${message}`} onClick={() => dismiss(message)}>×</button>
  </div>;
}
