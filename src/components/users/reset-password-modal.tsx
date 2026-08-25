import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import type { PublicUser } from "@/core/services/users.service";
import { api } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

interface ResetPasswordModalProps {
  open: boolean;
  onClose: () => void;
  target: PublicUser | null;
}

export function ResetPasswordModal({ open, onClose, target }: ResetPasswordModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError(null);
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor || !target) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.users.resetPassword(target.id, password);
      toast("success", t("users.passwordResetToast"));
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
      title={t("users.resetPassword")}
      widthClass="max-w-sm"
      footer={
        <>
          <Button type="submit" form="reset-password-form" loading={submitting} disabled={submitting}>
            {t("common.confirm")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <p className="text-sm text-subtle">
          {target?.fullName} — <span dir="ltr">{target?.username}</span>
        </p>
        <div className="space-y-1.5">
          <label htmlFor="reset-new-password" className="block text-[13px] font-semibold text-subtle">
            {t("users.newPassword")}
          </label>
          <PasswordInput
            id="reset-new-password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
