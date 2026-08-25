import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/utils/cn";

type ToastKind = "success" | "error" | "info" | "warning";

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLES: Record<ToastKind, { icon: ReactNode; className: string }> = {
  success: { icon: <CheckCircle2 />, className: "text-neon" },
  error: { icon: <XCircle />, className: "text-red" },
  warning: { icon: <AlertTriangle />, className: "text-amber" },
  info: { icon: <Info />, className: "text-cyan" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), 3800);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 start-6 flex w-[min(360px,calc(100vw-3rem))] flex-col gap-2"
          style={{ zIndex: "var(--z-toast)" }}
        >
          {items.map((item) => {
            const style = KIND_STYLES[item.kind];
            return (
              <div
                key={item.id}
                role="status"
                className="pointer-events-auto flex animate-slide-up items-center gap-3 rounded-xl border border-line-strong bg-raised px-4 py-3 shadow-pop"
              >
                <span aria-hidden className={cn("shrink-0 [&>svg]:size-5", style.className)}>
                  {style.icon}
                </span>
                <p className="flex-1 text-sm font-semibold leading-snug">{item.message}</p>
                <button
                  type="button"
                  aria-label="close"
                  onClick={() => dismiss(item.id)}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:text-subtle"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
