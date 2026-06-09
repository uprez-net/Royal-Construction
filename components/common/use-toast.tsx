import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Check, Bell, X } from "lucide-react";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "info";
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: "success" | "info" = "success") => {
    const id = uuidv4();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4000,
    );
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
                  ? "rgba(22,163,74,0.1)"
                  : "rgba(37,99,235,0.1)",
              color: toast.type === "success" ? "#16A34A" : "#2563EB",
            }}
          >
            {toast.type === "success" ? (
              <Check size={15} />
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