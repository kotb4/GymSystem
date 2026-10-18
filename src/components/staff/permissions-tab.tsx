import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Save,
  ShieldCheck,
  Check,
  Search,
  Lock,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { PERMS, ROLES, type RoleId, type Permission } from "@/core/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/utils/cn";

type PermMap = Record<RoleId, Permission[]>;

interface PermCategory {
  id: string;
  label: string;
  icon: string;
  perms: Permission[];
}

const STATIC_PERM_CATEGORIES: PermCategory[] = [
  {
    id: "members",
    label: "إدارة الأعضاء والولاء",
    icon: "Users",
    perms: [
      "members.view",
      "members.create",
      "members.edit",
      "members.delete",
      "members.restore",
      "members.purge",
      "members.change_status",
      "members.view_all_departments",
      "referrals.view",
      "referrals.manage",
      "loyalty.view",
      "loyalty.manage",
      "invitations.manage",
    ],
  },
  {
    id: "cards",
    label: "الكروت الذكية والباركود",
    icon: "CreditCard",
    perms: [
      "cards.view",
      "cards.register",
      "cards.assign",
      "cards.unassign",
      "cards.report_lost",
      "cards.block",
      "cards.send",
      "cards.delete",
    ],
  },
  {
    id: "subscriptions",
    label: "الباقات والاشتراكات",
    icon: "Calendar",
    perms: [
      "plans.view",
      "plans.create",
      "plans.edit",
      "packages.view",
      "packages.create",
      "packages.edit",
      "subscriptions.view",
      "subscriptions.create",
      "subscriptions.edit",
      "subscriptions.cancel",
      "subscriptions.freeze",
      "subscriptions.purge",
      "promo.view",
      "promo.manage",
    ],
  },
  {
    id: "reception",
    label: "الاستقبال والحضور السريع",
    icon: "Zap",
    perms: [
      "reception.view",
      "checkin.create",
      "checkin.view_history",
      "checkin.checkout",
      "checkin.delete",
      "quick_sessions.view",
      "quick_sessions.create",
    ],
  },
  {
    id: "leads",
    label: "العملاء المحتملون والتجارب",
    icon: "UserCheck",
    perms: [
      "leads.view",
      "leads.manage",
      "trials.view",
      "trials.create",
      "trials.manage",
    ],
  },
  {
    id: "finance",
    label: "المالية والخزينة والديون",
    icon: "DollarSign",
    perms: [
      "payments.view",
      "payments.create",
      "payments.discount",
      "payments.refund",
      "payments.void",
      "expenses.view",
      "expenses.create",
      "expenses.edit",
      "expenses.attachments",
      "cash.open",
      "cash.close",
      "cash.purge",
      "debts.view",
      "debts.manage",
      "pdf.receipt",
    ],
  },
  {
    id: "store",
    label: "المتجر ونقاط البيع والمشتريات",
    icon: "ShoppingBag",
    perms: [
      "store.view",
      "store.products",
      "store.sell",
      "store.credit",
      "store.repayments",
      "store.void_sale",
      "store.inventory",
      "store.profit",
      "store.return",
      "store.purge",
      "purchases.view",
      "purchases.manage",
      "suppliers.view",
      "suppliers.manage",
    ],
  },
  {
    id: "classes",
    label: "الحصص والتدريب الخاص والتأهيل",
    icon: "Dumbbell",
    perms: [
      "classes.view",
      "classes.manage",
      "classes.checkin",
      "classes.purge",
      "trainers.view",
      "trainers.manage",
      "trainers.purge",
      "training.manage",
      "private_training.view",
      "private_training.manage",
      "trainer_attendance.view",
      "trainer_attendance.manage",
      "assessments.view",
      "assessments.manage",
    ],
  },
  {
    id: "hr",
    label: "الموارد البشرية والرواتب والورديات",
    icon: "Users",
    perms: [
      "employees.view",
      "employees.manage",
      "employees.purge",
      "salaries.view",
      "salaries.manage",
      "hr.view",
      "hr.manage",
      "hr.approve_leaves",
      "hr.activity_view",
      "hr.employee_checkin",
      "shifts.view",
      "shifts.manage",
    ],
  },
  {
    id: "reports",
    label: "التقارير وسجل الرقابة والأمان",
    icon: "FileSpreadsheet",
    perms: [
      "reports.view",
      "reports.export",
      "audit.view",
      "diagnostics.view",
    ],
  },
  {
    id: "messaging",
    label: "الرسائل والإعلانات",
    icon: "MessageSquare",
    perms: [
      "messages.view",
      "messages.send",
      "announcements.view",
      "announcements.manage",
    ],
  },
  {
    id: "system",
    label: "إعدادات النظام والنسخ الاحتياطي",
    icon: "Settings",
    perms: [
      "users.view",
      "users.manage",
      "settings.view",
      "settings.edit",
      "backup.create",
      "backup.restore",
    ],
  },
];

export function PermissionsTab() {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();

  const [permMap, setPermMap] = useState<PermMap | null>(null);
  const [draft, setDraft] = useState<PermMap | null>(null);
  const [savingRole, setSavingRole] = useState<RoleId | null>(null);
  const [instantSave, setInstantSave] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      const map = (await api.permissions.getRolePermissions()) as unknown as PermMap;
      setPermMap(map);
      setDraft(map);
    } catch (err) {
      toast("error", describeError(err, t));
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ensure 100% of PERMS are covered by dynamically capturing any extras
  const categories = useMemo(() => {
    const categorized = new Set(STATIC_PERM_CATEGORIES.flatMap((c) => c.perms));
    const extraPerms = (PERMS as readonly Permission[]).filter((p) => !categorized.has(p));
    if (extraPerms.length === 0) return STATIC_PERM_CATEGORIES;

    return [
      ...STATIC_PERM_CATEGORIES,
      {
        id: "other",
        label: "صلاحيات إضافية",
        icon: "Sparkles",
        perms: extraPerms,
      },
    ];
  }, []);

  const totalPermsCount = PERMS.length;

  const isRoleEditable = useCallback(
    (roleId: RoleId) => {
      if (!actor) return false;
      if (roleId === "owner") return false;
      if (actor.roleId === "owner") return true;
      if (actor.roleId === "manager" && roleId !== "manager") return true;
      return false;
    },
    [actor]
  );

  const saveRolePermissions = useCallback(
    async (roleId: RoleId, permsToSave: Permission[]) => {
      if (!actor || !isRoleEditable(roleId)) return;
      setSavingRole(roleId);
      try {
        await api.permissions.setRolePermissions(roleId, permsToSave);
        setPermMap((prev) => (prev ? { ...prev, [roleId]: permsToSave } : prev));
        toast("success", `تم حفظ صلاحيات دور (${t(`roles.${roleId}`)}) بنجاح`);
      } catch (err) {
        toast("error", describeError(err, t));
        // Revert draft on error
        setDraft(permMap);
      } finally {
        setSavingRole(null);
      }
    },
    [actor, isRoleEditable, permMap, t, toast]
  );

  const togglePerm = useCallback(
    (roleId: RoleId, perm: Permission) => {
      if (!draft || !isRoleEditable(roleId)) return;
      const current = new Set(draft[roleId] ?? []);
      if (current.has(perm)) {
        current.delete(perm);
      } else {
        current.add(perm);
      }
      const nextList = Array.from(current) as Permission[];
      const nextDraft = { ...draft, [roleId]: nextList };
      setDraft(nextDraft);

      if (instantSave) {
        void saveRolePermissions(roleId, nextList);
      }
    },
    [draft, instantSave, isRoleEditable, saveRolePermissions]
  );

  const toggleCategoryForRole = useCallback(
    (roleId: RoleId, perms: Permission[], enableAll: boolean) => {
      if (!draft || !isRoleEditable(roleId)) return;
      const current = new Set(draft[roleId] ?? []);
      if (enableAll) {
        for (const p of perms) current.add(p);
      } else {
        for (const p of perms) current.delete(p);
      }
      const nextList = Array.from(current) as Permission[];
      const nextDraft = { ...draft, [roleId]: nextList };
      setDraft(nextDraft);

      if (instantSave) {
        void saveRolePermissions(roleId, nextList);
      }
    },
    [draft, instantSave, isRoleEditable, saveRolePermissions]
  );

  // Filter perms by search and selected category
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return categories
      .map((cat) => {
        if (selectedCategory !== "all" && cat.id !== selectedCategory) {
          return null;
        }
        const matchingPerms = cat.perms.filter((p) => {
          if (!q) return true;
          const label = t(`perms.${p}`).toLowerCase();
          return p.toLowerCase().includes(q) || label.includes(q);
        });
        if (matchingPerms.length === 0) return null;
        return {
          ...cat,
          perms: matchingPerms,
        };
      })
      .filter((c): c is PermCategory => c !== null);
  }, [categories, search, selectedCategory, t]);

  const hasUnsavedChanges = useMemo(() => {
    if (!draft || !permMap) return false;
    for (const r of ROLES) {
      if (!isRoleEditable(r)) continue;
      const d = [...(draft[r] ?? [])].sort().join("|");
      const s = [...(permMap[r] ?? [])].sort().join("|");
      if (d !== s) return true;
    }
    return false;
  }, [draft, isRoleEditable, permMap]);

  const handleSaveAll = async () => {
    if (!draft || !actor) return;
    for (const r of ROLES) {
      if (!isRoleEditable(r)) continue;
      const d = [...(draft[r] ?? [])].sort().join("|");
      const s = [...(permMap?.[r] ?? [])].sort().join("|");
      if (d !== s) {
        await saveRolePermissions(r, draft[r]);
      }
    }
  };

  if (!draft) {
    return (
      <div className="py-12">
        <EmptyState icon={<ShieldCheck className="size-8 text-slate-600" />} title={t("permPage.title")} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Matrix Controls & Search Hub Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F1420]/80 p-4 rounded-2xl border border-white/[0.08] shadow-lg backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-4 text-subtle absolute start-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن أي صلاحية بالاسم أو الكود (126 صلاحية)..."
              className="ps-9 h-9 text-xs bg-surface/70 border-white/[0.08] rounded-xl"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute end-2.5 top-1/2 -translate-y-1/2 text-xs text-subtle hover:text-ink"
              >
                مسح
              </button>
            )}
          </div>

          {/* Instant Save Toggle */}
          <label className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-xl border border-white/[0.08] bg-surface/50 text-xs font-semibold text-subtle hover:text-ink">
            <input
              type="checkbox"
              checked={instantSave}
              onChange={(e) => setInstantSave(e.target.checked)}
              className="accent-neon size-4 rounded"
            />
            <span>حفظ فوري تلقائي عند التبديل ⚡</span>
          </label>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDraft(permMap)}
                className="gap-1.5 text-xs h-9"
              >
                <RotateCcw className="size-3.5" />
                <span>تراجع</span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveAll}
                className="gap-1.5 text-xs h-9 shadow-glow-sm"
              >
                <Save className="size-3.5" />
                <span>حفظ التعديلات المعلقة</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Category Pills Strip */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-panel/50 backdrop-blur-md border border-white/[0.06]">
        <button
          type="button"
          onClick={() => setSelectedCategory("all")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
            selectedCategory === "all"
              ? "bg-neon/15 text-neon border border-neon/40 shadow-glow-sm"
              : "text-subtle hover:text-ink hover:bg-white/[0.05]"
          )}
        >
          <span>كافة الصلاحيات</span>
          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-black/40 border border-white/[0.08]">
            {totalPermsCount}
          </span>
        </button>

        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setSelectedCategory(cat.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
              selectedCategory === cat.id
                ? "bg-neon/15 text-neon border border-neon/40 shadow-glow-sm"
                : "text-subtle hover:text-ink hover:bg-white/[0.05]"
            )}
          >
            <span>{cat.label}</span>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-black/40 border border-white/[0.08]">
              {cat.perms.length}
            </span>
          </button>
        ))}
      </div>

      {/* Modern Role-Permission Toggle Matrix */}
      <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-panel/70 shadow-lg backdrop-blur-md">
        <table className="w-full border-collapse text-start text-xs">
          {/* Table Header: Roles Columns */}
          <thead>
            <tr className="border-b border-white/[0.08] bg-[#0F1420]/90">
              <th className="p-3.5 text-start font-bold text-ink min-w-[280px]">
                الصلاحية والوظيفة البرمجية ({totalPermsCount} إجمالي)
              </th>

              {ROLES.map((role) => {
                const isOwner = role === "owner";
                const editable = isRoleEditable(role);
                const rolePerms = draft[role] ?? [];
                const isSaving = savingRole === role;

                return (
                  <th
                    key={role}
                    className="p-3.5 text-center font-bold text-ink min-w-[130px] border-s border-white/[0.06]"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black">{t(`roles.${role}`)}</span>
                        {isOwner ? (
                          <span title="صلاحيات المالك كاملة وغير قابلة للتعديل" className="text-amber-400">
                            <Lock className="size-3" />
                          </span>
                        ) : !editable ? (
                          <span title="غير مصرح لك بتعديل هذا الدور" className="text-subtle">
                            <Lock className="size-3" />
                          </span>
                        ) : null}
                      </div>

                      <span className="font-mono text-[10px] font-semibold text-subtle px-2 py-0.5 rounded-full bg-white/[0.04]">
                        {isOwner ? `${totalPermsCount} صلاحية` : `${rolePerms.length} مفعّلة`}
                      </span>

                      {isSaving && (
                        <span className="text-[10px] text-neon animate-pulse font-medium">
                          جارِ الحفظ...
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Table Body: Grouped by Categories */}
          <tbody>
            {filteredCategories.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-subtle">
                  لا توجد صلاحيات مطابقة لمعايير البحث
                </td>
              </tr>
            ) : (
              filteredCategories.map((category) => {
                return (
                  <tr key={category.id} className="contents">
                    {/* Category Header Row */}
                    <tr className="border-t border-b border-white/[0.08] bg-white/[0.03]">
                      <td colSpan={5} className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-neon">
                              {category.label}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neon/10 border border-neon/20 text-neon font-bold">
                              {category.perms.length} صلاحية
                            </span>
                          </div>

                          <div className="flex items-center gap-4 text-[11px] text-subtle">
                            {ROLES.filter((r) => isRoleEditable(r)).map((r) => {
                              const current = draft[r] ?? [];
                              const allChecked = category.perms.every((p) => current.includes(p));
                              return (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => toggleCategoryForRole(r, category.perms, !allChecked)}
                                  className="text-subtle hover:text-neon underline text-[10px]"
                                >
                                  {allChecked ? `تعطيل (${t(`roles.${r}`)})` : `تفعيل الكل (${t(`roles.${r}`)})`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* Permission Rows */}
                    {category.perms.map((perm) => {
                      const permLabel = t(`perms.${perm}`);
                      return (
                        <tr
                          key={perm}
                          className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                        >
                          {/* Col 1: Permission Info */}
                          <td className="p-3 pe-4">
                            <div className="space-y-0.5">
                              <div className="font-bold text-foreground text-xs">{permLabel}</div>
                              <div className="font-mono text-[11px] text-subtle">{perm}</div>
                            </div>
                          </td>

                          {/* Role Toggle Cells */}
                          {ROLES.map((role) => {
                            const isOwner = role === "owner";
                            const isChecked = isOwner || (draft[role]?.includes(perm) ?? false);
                            const editable = isRoleEditable(role);

                            return (
                              <td
                                key={role}
                                className="p-2.5 text-center border-s border-white/[0.04] align-middle"
                              >
                                {isOwner ? (
                                  <div className="flex justify-center">
                                    <span
                                      className="size-6 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 grid place-items-center"
                                      title="مفعل دائماً للمالك"
                                    >
                                      <Check className="size-3.5" strokeWidth={3} />
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex justify-center">
                                    <button
                                      type="button"
                                      disabled={!editable}
                                      onClick={() => togglePerm(role, perm)}
                                      title={
                                        !editable
                                          ? "لا تملك صلاحية تعديل هذا الدور"
                                          : isChecked
                                            ? `تعطيل الصلاحية لدور ${t(`roles.${role}`)}`
                                            : `تفعيل الصلاحية لدور ${t(`roles.${role}`)}`
                                      }
                                      className={cn(
                                        "size-7 rounded-lg border flex items-center justify-center transition-all duration-150",
                                        isChecked
                                          ? "bg-neon/15 border-neon/40 text-neon shadow-glow-sm hover:bg-neon/25"
                                          : "bg-surface border-white/[0.08] text-transparent hover:border-white/20",
                                        !editable && "opacity-40 cursor-not-allowed"
                                      )}
                                    >
                                      <Check
                                        className={cn(
                                          "size-3.5 transition-transform",
                                          isChecked ? "scale-100" : "scale-0"
                                        )}
                                        strokeWidth={3}
                                      />
                                    </button>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
