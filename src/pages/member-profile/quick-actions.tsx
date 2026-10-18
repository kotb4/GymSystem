import {
  BadgePlus,
  CreditCard,
  Dumbbell,
  ScanLine,
  Snowflake,
  StickyNote,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import type { Permission } from "@/core/permissions";

export type QuickAction =
  | "checkin"
  | "renew"
  | "freeze"
  | "recordPayment"
  | "inviteGuest"
  | "addNote"
  | "addPt"
  | "assignCard";

interface QuickActionsProps {
  onAction: (a: QuickAction) => void;
  activeSubscriptionId: string | null;
  memberArchived: boolean;
}

interface ActionDef {
  key: QuickAction;
  perm: Permission;
  featureFlag?: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

export function QuickActions({ onAction, activeSubscriptionId, memberArchived }: QuickActionsProps) {
  const t = useT();
  const { hasPermission, isFeatureEnabled } = useAuth();
  const archived = memberArchived;
  const hasActive = activeSubscriptionId != null;

  const actions: ActionDef[] = [
    {
      key: "checkin",
      perm: "checkin.create",
      featureFlag: "featureAttendanceEnabled",
      label: t("members.qaCheckin"),
      icon: <ScanLine className="size-4" />,
    },
    {
      key: "renew",
      perm: "subscriptions.create",
      featureFlag: "featureSubscriptionsEnabled",
      label: hasActive ? t("members.qaRenew") : t("subs.addSubscription"),
      icon: <CreditCard className="size-4" />,
      disabled: archived,
    },
    {
      key: "freeze",
      perm: "subscriptions.freeze",
      featureFlag: "featureSubscriptionsEnabled",
      label: t("members.qaFreeze"),
      icon: <Snowflake className="size-4" />,
      disabled: !hasActive || archived,
    },
    {
      key: "recordPayment",
      perm: "payments.create",
      featureFlag: "featureTreasuryEnabled",
      label: t("members.qaRecordPayment"),
      icon: <CreditCard className="size-4" />,
    },
    {
      key: "inviteGuest",
      perm: "invitations.manage",
      featureFlag: "featureSubscriptionsEnabled",
      label: t("members.qaInviteGuest"),
      icon: <UserPlus className="size-4" />,
      disabled: archived,
    },
    {
      key: "addNote",
      perm: "members.edit",
      label: t("members.qaAddNote"),
      icon: <StickyNote className="size-4" />,
      disabled: archived,
    },
    {
      key: "addPt",
      perm: "training.manage",
      featureFlag: "featureClassesEnabled",
      label: t("members.qaAddPt"),
      icon: <Dumbbell className="size-4" />,
      disabled: archived,
    },
    {
      key: "assignCard",
      perm: "cards.assign",
      featureFlag: "featureCardsEnabled",
      label: t("members.qaAssignCard"),
      icon: <BadgePlus className="size-4" />,
    },
  ];

  const visible = actions.filter((a) => {
    if (a.featureFlag && !isFeatureEnabled(a.featureFlag)) return false;
    return hasPermission(a.perm);
  });
  if (visible.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-3 bg-panel/30">
        <span className="text-[11px] font-bold text-faint ms-2 me-1 select-none">⚡ إجراءات سريعة:</span>
        {visible.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={a.disabled}
            onClick={() => onAction(a.key)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface/80 px-3 py-1.5 text-xs font-bold text-subtle transition-all hover:border-[#0055FF]/40 hover:text-white hover:bg-raised active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
