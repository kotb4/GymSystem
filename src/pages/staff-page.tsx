import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { Tabs } from "@/components/ui/tabs";
import { UsersTab } from "@/components/staff/users-tab";
import { PermissionsTab } from "@/components/staff/permissions-tab";

type StaffTab = "users" | "permissions";

export function StaffPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<StaffTab>("users");

  const showUsers = hasPermission("users.view");
  const showPerms = hasPermission("users.view");

  useEffect(() => {
    if (tab === "users" && !showUsers && showPerms) setTab("permissions");
    if (tab === "permissions" && !showPerms && showUsers) setTab("users");
  }, [tab, showUsers, showPerms]);

  if (!showUsers && !showPerms) return null;

  return (
    <div className="space-y-4">
      <Tabs
        items={[
          { value: "users", label: t("nav.users") },
          { value: "permissions", label: t("nav.permissions") },
        ]}
        value={tab}
        onChange={(v) => setTab(v as StaffTab)}
      />
      {tab === "users" && showUsers && <UsersTab />}
      {tab === "permissions" && showPerms && <PermissionsTab />}
    </div>
  );
}
