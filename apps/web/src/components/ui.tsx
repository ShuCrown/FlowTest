import type { ReactNode } from "react";
import { create } from "zustand";

export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-forge-700 pb-5">
      <div className="ff-fade-up">
        <div className="ff-kicker">{kicker}</div>
        <h1 className="ff-display mt-2 text-[34px] leading-none text-paper">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-[13px] leading-6 text-forge-300/80">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({ index, children }: { index?: string; children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      {index ? <span className="ff-kicker text-ember-500">{index}</span> : null}
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-forge-300">
        {children}
      </span>
      <span className="h-px flex-1 bg-forge-700" />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="ff-label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-forge-400">{hint}</span> : null}
    </label>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ff-card flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-ember-500">// empty</div>
      <div className="ff-display text-xl text-paper">{title}</div>
      {hint ? <div className="max-w-md text-[13px] leading-6 text-forge-400">{hint}</div> : null}
      {action}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  pass: "ff-badge-good",
  healed: "ff-badge-ember",
  finished: "ff-badge-good",
  failed: "ff-badge-bad",
  canceled: "ff-badge-bad",
  skipped: "ff-badge",
  running: "ff-badge-ember",
  preparing: "ff-badge-ember",
  queued: "ff-badge",
  fail: "ff-badge-bad",
  recording: "ff-badge-bad",
  stopped: "ff-badge",
  open: "ff-badge-good",
  closed: "ff-badge",
};

export function StatusBadge({ status }: { status: string; children?: ReactNode }) {
  return <span className={`ff-badge ${STATUS_STYLE[status] ?? "ff-badge"}`}>{status}</span>;
}

export function ReadinessBadge({ level }: { level: number }) {
  const tone =
    level >= 5
      ? "ff-badge-good"
      : level >= 4
        ? "ff-badge-ember"
        : level >= 2
          ? "ff-badge"
          : "ff-badge-bad";
  return <span className={`ff-badge ${tone}`}>L{level}</span>;
}

export interface ToastItem {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
}

interface ToastStore {
  toasts: ToastItem[];
  push: (message: string, kind?: ToastItem["kind"]) => void;
  remove: (id: number) => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (message, kind = "info") => {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => get().remove(id), 3800);
  },
  remove: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}));

export function toast(message: string, kind: ToastItem["kind"] = "info"): void {
  useToastStore.getState().push(message, kind);
}

export function Toasts() {
  const toasts = useToastStore((state) => state.toasts);
  const remove = useToastStore((state) => state.remove);
  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[100] flex w-[340px] flex-col gap-2">
      {toasts.map((item) => (
        <button
          key={item.id}
          onClick={() => remove(item.id)}
          className={`pointer-events-auto border px-4 py-3 text-left text-[12px] leading-5 shadow-2xl ${
            item.kind === "error"
              ? "border-rust-500/60 bg-[#2a1210] text-[#f0a58f]"
              : item.kind === "success"
                ? "border-moss-400/50 bg-[#0f211d] text-[#9fd8c9]"
                : "border-forge-600 bg-forge-850 text-paper"
          }`}
        >
          {item.message}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-forge-700/60 py-2 last:border-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-forge-400">
        {label}
      </span>
      <span className="text-right text-[12px] text-forge-300">{children}</span>
    </div>
  );
}
