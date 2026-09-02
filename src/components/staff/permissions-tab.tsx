import { useCallback, useEffect, useState } from "react";
import { Save, ShieldCheck, Check } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { ROLES, type RoleId, type Permission } from "@/core/permissions";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/utils/cn";

type PermMap = Record<RoleId, Permission[]>;

const PERM_GROUPS = [
  { label: "الأعضاء", perms: ["members.view","members.create","members.edit","members.delete","members.restore","members.purge","members.change_status","members.view_all_departments"] as Permission[] },
  { label: "الكروت", perms: ["cards.view","cards.register","cards.assign","cards.unassign","cards.report_lost","cards.block"] as Permission[] },
  { label: "الباقات", perms: ["plans.view","plans.create","plans.edit"] as Permission[] },
  { label: "الاشتراكات", perms: ["subscriptions.view","subscriptions.create","subscriptions.edit","subscriptions.cancel","subscriptions.freeze","subscriptions.purge"] as Permission[] },
  { label: "الحضور والانصراف", perms: ["checkin.create","checkin.view_history","checkin.checkout","checkin.delete"] as Permission[] },
  { label: "التأهيل", perms: ["assessments.view","assessments.manage"] as Permission[] },
  { label: "المدفوعات", perms: ["payments.view","payments.create","payments.discount","payments.refund","payments.void"] as Permission[] },
  { label: "المصروفات", perms: ["expenses.view","expenses.create","expenses.edit","expenses.attachments"] as Permission[] },
  { label: "الخزينة", perms: ["cash.open","cash.close","cash.purge"] as Permission[] },
  { label: "التقارير", perms: ["reports.view","reports.export"] as Permission[] },
  { label: "المتجر", perms: ["store.view","store.products","store.sell","store.credit","store.repayments","store.void_sale","store.inventory","store.profit","store.purge"] as Permission[] },
  { label: "الحصص", perms: ["classes.view","classes.manage","classes.checkin"] as Permission[] },
  { label: "المدربون", perms: ["trainers.view","trainers.manage","training.manage"] as Permission[] },
  { label: "الموظفون والرواتب", perms: ["employees.view","employees.manage","employees.purge","salaries.view","salaries.manage"] as Permission[] },
  { label: "الرسائل", perms: ["crm.send","crm.templates"] as Permission[] },
  { label: "النسخ الاحتياطي والصيانة", perms: ["backup.create","backup.restore","diagnostics.view"] as Permission[] },
  { label: "النظام", perms: ["users.view","users.manage","audit.view","settings.view","settings.edit"] as Permission[] },
];

const ROLE_KEYS = ROLES.map((r) => ({ value: r, key: `roles.${r}` }));

export function PermissionsTab() {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();

  const [activeRole, setActiveRole] = useState<RoleId>("manager");
  const [permMap, setPermMap] = useState<PermMap | null>(null);
  const [draft, setDraft] = useState<PermMap | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const map = (await api.permissions.getRolePermissions()) as unknown as PermMap;
    setPermMap(map);
    setDraft(map);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const isOwner = activeRole === "owner";
  const currentPerms = draft?.[activeRole] ?? [];

  function toggle(perm: Permission) {
    if (!draft || isOwner) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      const set = new Set(next[activeRole]);
      if (set.has(perm)) set.delete(perm); else set.add(perm);
      return { ...next, [activeRole]: Array.from(set) as Permission[] };
    });
  }

  function toggleGroup(perms: Permission[]) {
    if (!draft || isOwner) return;
    const all = perms.every((p) => currentPerms.includes(p));
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      next[activeRole] = all
        ? (next[activeRole].filter((p) => !perms.includes(p)) as Permission[])
        : ([...new Set([...next[activeRole], ...perms])] as Permission[]);
      return next;
    });
  }

  async function save() {
    if (!draft || !actor) return;
    setSaving(true);
    try {
      await api.permissions.setRolePermissions(activeRole, draft[activeRole]);
      setPermMap(draft);
      toast("success", t("permPage.saved"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSaving(false);
    }
  }

  const savedKey = [...(permMap?.[activeRole] ?? [])].sort().join("|");
  const draftKey = [...currentPerms].sort().join("|");
  const changed = savedKey !== draftKey;

  if (!draft) {
    return <EmptyState icon={<ShieldCheck />} title={t("permPage.title")} />;
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title={t("permPage.title")} description={t("permPage.desc")} />
        <Tabs
          items={ROLE_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
          value={activeRole}
          onChange={(v) => setActiveRole(v as RoleId)}
          className="mb-4"
        />

        {isOwner ? (
          <p className="px-1 text-sm text-subtle">{t("permPage.ownerLocked")}</p>
        ) : (
          <div className="space-y-4">
            {PERM_GROUPS.map((group) => {
              const all = group.perms.every((p) => currentPerms.includes(p));
              const some = !all && group.perms.some((p) => currentPerms.includes(p));
              return (
                <div key={group.label} className="rounded-xl border border-line bg-panel p-3">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.perms)}
                    className="mb-2 flex items-center gap-2 text-sm font-bold text-ink"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-[18px] place-items-center rounded-md border transition-colors",
                        all ? "border-neon bg-neon" : some ? "border-neon bg-neon/30" : "border-line-strong bg-surface",
                      )}
                    >
                      {all && <Check className="size-3 text-neon-ink" strokeWidth={3.5} />}
                    </span>
                    {group.label}
                  </button>
                  <div className="grid gap-1 ps-7 sm:grid-cols-2 lg:grid-cols-3">
                    {group.perms.map((perm) => (
                      <Checkbox
                        key={perm}
                        checked={currentPerms.includes(perm)}
                        onCheckedChange={() => toggle(perm)}
                      >
                        {t(`perms.${perm}`)}
                      </Checkbox>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {!isOwner && (
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={!changed || saving}>
            <Save className="ms-1.5 size-4" />
            {t("permPage.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
