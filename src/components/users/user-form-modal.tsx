import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { ROLES, type RoleId } from "@/core/permissions";
import { api, type PublicUser } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface UserFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  user?: PublicUser | null;
}

export function UserFormModal({ open, onClose, onSaved, user }: UserFormModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState<RoleId>("reception");
  const [department, setDepartment] = useState<"general" | "men" | "women">("general");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsername(user?.username ?? "");
    setFullName(user?.fullName ?? "");
    setRoleId(user?.roleId ?? "reception");
    setDepartment(user?.department ?? "general");
    setEmail(user?.email ?? "");
    setPassword("");
    setError(null);
  }, [open, user]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      if (user) {
        await api.users.update(user.id, {
          fullName,
          roleId,
          email: email.trim() || null,
          department,
        });
      } else {
        await api.users.create({
          username,
          password,
          fullName,
          roleId,
          email: email.trim() || null,
          department,
        });
      }
      toast("success", user ? t("users.updatedToast") : t("users.createdToast"));
      onSaved();
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
      title={user ? t("users.editUser") : t("users.addUser")}
      footer={
        <>
          <Button type="submit" form="user-form" loading={submitting} disabled={submitting}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} noValidate className="space-y-3.5">
        {!user && (
          <Input
            label={t("users.username")}
            dir="ltr"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
            autoFocus
          />
        )}
        <Input
          label={t("users.fullName")}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={submitting}
        />
        <Select
          label={t("users.role")}
          value={roleId}
          onChange={(e) => setRoleId(e.target.value as RoleId)}
          disabled={submitting}
          options={ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) }))}
        />
        <Select
          label={t("users.department")}
          value={department}
          onChange={(e) => setDepartment(e.target.value as "general" | "men" | "women")}
          disabled={submitting}
          options={[
            { value: "general", label: t("members.deptGeneral") },
            { value: "men", label: t("members.deptMen") },
            { value: "women", label: t("members.deptWomen") },
          ]}
        />
        <Input
          label={`${t("common.email")} (${t("common.optional")})`}
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
        />
        {!user && (
          <Input
            label={t("auth.password")}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
