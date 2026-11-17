import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Check, Bell, X, AlertTriangle } from "lucide-react";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "info" | "error";
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, []);

  const showToast = (
    message: string,
    type: "success" | "info" | "error" = "success",
  ) => {
    const id = uuidv4();
    setToasts((prev) => [...prev, { id, message, type }]);
    const timeoutId = setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4000,
    );
    timeoutsRef.current.push(timeoutId);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { toasts, showToast, dismissToast };
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item toast-${toast.type}`}>
          <div
            className="toast-icon-wrapper"
            style={{
              background:
                toast.type === "success"
                  ? "var(--success-light)"
                  : toast.type === "error"
                    ? "var(--destructive-light)"
                    : "var(--info-light)",
              color:
                toast.type === "success"
                  ? "var(--success-ink)"
                  : toast.type === "error"
                    ? "var(--destructive-ink)"
                    : "var(--info-ink)",
            }}
          >
            {toast.type === "success" ? (
              <Check size={15} />
            ) : toast.type === "error" ? (
              <AlertTriangle size={15} />
            ) : (
              <Bell size={15} />
            )}
          </div>
          <span className="toast-msg">{toast.message}</span>
          <button className="toast-close" onClick={() => onDismiss(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
