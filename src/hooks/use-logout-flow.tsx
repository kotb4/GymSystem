import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function useLogoutFlow() {
  const navigate = useNavigate();
  const t = useT();
  const { logout } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = () => setOpen(true);

  const confirm = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 350));
    setBusy(false);
    setOpen(false);
    logout();
    toast("success", t("toast.loggedOut"));
    navigate("/login", { replace: true });
  };

  const dialog = (
    <ConfirmDialog
      open={open}
      title={t("dialogs.logoutTitle")}
      message={t("dialogs.logoutMsg")}
      confirmLabel={t("common.logout")}
      tone="danger"
      loading={busy}
      onConfirm={confirm}
      onClose={() => setOpen(false)}
    />
  );

  return { request, dialog };
}
