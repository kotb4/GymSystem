import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Lock, ShieldAlert, UserCheck } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type ManagerOverrideResult } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ManagerOverrideModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: ManagerOverrideResult) => void;
  title?: string;
  description?: string;
  reason?: string;
  memberDept?: string;
  userDept?: string;
  entityType?: string;
  entityId?: string;
}

function formatDeptName(dept?: string | null): string {
  if (!dept || dept === "general") return "عام";
  if (dept === "men") return "رجال";
  if (dept === "women") return "سيدات";
  return dept;
}

export function ManagerOverrideModal({
  open,
  onClose,
  onSuccess,
  title,
  description,
  reason: initialReason = "",
  memberDept,
  userDept,
  entityType = "department_access",
  entityId,
}: ManagerOverrideModalProps) {
  const t = useT();
  const { toast } = useToast();

  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [hasPinConfigured, setHasPinConfigured] = useState<boolean>(true);
  const [pin, setPin] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState(initialReason);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPin("");
      setUsername("");
      setPassword("");
      setError(null);
      setSubmitting(false);
      return;
    }

    setReason(initialReason);
    let alive = true;
    void api.managerOverride
      .hasPin()
      .then((hasPin) => {
        if (!alive) return;
        setHasPinConfigured(hasPin);
        setMode(hasPin ? "pin" : "password");
      })
      .catch(() => {
        if (!alive) return;
        setMode("password");
      });

    return () => {
      alive = false;
    };
  }, [open, initialReason]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (mode === "pin" && !pin.trim()) return;
    if (mode === "password" && (!username.trim() || !password.trim())) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await api.managerOverride.verify({
        pin: mode === "pin" ? pin.trim() : undefined,
        username: mode === "password" ? username.trim() : undefined,
        password: mode === "password" ? password : undefined,
        reason: reason.trim() || undefined,
        entityType,
        entityId,
      });

      toast("success", t("managerOverride.successToast", { manager: res.authorizedBy }));
      onSuccess(res);
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? t("managerOverride.title")}
      widthClass="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface/70 p-3.5 backdrop-blur-md">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-neon/15 text-neon">
            <ShieldAlert className="size-5" />
          </div>
          <div className="flex flex-col text-xs leading-relaxed">
            <span className="font-bold text-ink">
              {title ?? t("managerOverride.title")}
            </span>
            <span className="text-subtle">
              {description ?? t("managerOverride.desc")}
            </span>
          </div>
        </div>

        {Boolean(memberDept && userDept) && (
          <div className="flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
            <Lock className="size-4 shrink-0" />
            <span>
              {t("managerOverride.departmentCollision", {
                memberDept: formatDeptName(memberDept),
                userDept: formatDeptName(userDept),
              })}
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red/40 bg-red/10 px-3.5 py-2 text-xs font-semibold text-red">
            {error}
          </div>
        )}

        {mode === "pin" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-ink">
              {t("managerOverride.pinLabel")}
            </label>
            <div className="relative">
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder={t("managerOverride.pinPlaceholder")}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="text-center font-mono tracking-widest text-lg font-bold"
                disabled={submitting}
              />
              <KeyRound className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-faint pointer-events-none" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-ink">
                {t("managerOverride.username")}
              </label>
              <Input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-ink">
                {t("managerOverride.password")}
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-subtle">
            {t("managerOverride.reason")}
          </label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("managerOverride.reasonPlaceholder")}
            disabled={submitting}
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          {hasPinConfigured ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode((m) => (m === "pin" ? "password" : "pin"));
              }}
              className="text-xs text-neon hover:underline"
              disabled={submitting}
            >
              {mode === "pin"
                ? t("managerOverride.usePasswordInstead")
                : t("managerOverride.usePinInstead")}
            </button>
          ) : (
            <span className="text-xs text-faint">
              {t("managerOverride.usePasswordInstead")}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line/60 pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            {t("managerOverride.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={
              submitting ||
              (mode === "pin" ? !pin.trim() : !username.trim() || !password.trim())
            }
            className="gap-2 font-bold shadow-glow-sm"
          >
            <UserCheck className="size-4" />
            <span>{t("managerOverride.authorizeBtn")}</span>
          </Button>
        </div>
      </form>
    </Modal>
  );
}
