import {
  BadgePlus,
  CreditCard,
  Dumbbell,
  ScanLine,
  Scale,
  Snowflake,
  StickyNote,
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
  | "addNote"
  | "addPt"
  | "addMeasurement"
  | "assignCard";

interface QuickActionsProps {
  onAction: (a: QuickAction) => void;
  activeSubscriptionId: string | null;
  memberArchived: boolean;
}

interface ActionDef {
  key: QuickAction;
  perm: Permission;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

export function QuickActions({ onAction, activeSubscriptionId, memberArchived }: QuickActionsProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const archived = memberArchived;
  const hasActive = activeSubscriptionId != null;

  const actions: ActionDef[] = [
    {
      key: "checkin",
      perm: "checkin.create",
      label: t("members.qaCheckin"),
      icon: <ScanLine className="size-4" />,
    },
    {
      key: "renew",
      perm: "subscriptions.create",
      label: t("members.qaRenew"),
      icon: <CreditCard className="size-4" />,
      disabled: !hasActive,
    },
    {
      key: "freeze",
      perm: "subscriptions.freeze",
      label: t("members.qaFreeze"),
      icon: <Snowflake className="size-4" />,
      disabled: !hasActive || archived,
    },
    {
      key: "recordPayment",
      perm: "payments.create",
      label: t("members.qaRecordPayment"),
      icon: <CreditCard className="size-4" />,
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
      label: t("members.qaAddPt"),
      icon: <Dumbbell className="size-4" />,
      disabled: archived,
    },
    {
      key: "addMeasurement",
      perm: "assessments.manage",
      label: t("members.qaAddMeasurement"),
      icon: <Scale className="size-4" />,
      disabled: archived,
    },
    {
      key: "assignCard",
      perm: "cards.assign",
      label: t("members.qaAssignCard"),
      icon: <BadgePlus className="size-4" />,
    },
  ];

  const visible = actions.filter((a) => hasPermission(a.perm));
  if (visible.length === 0) return null;

  return (
    <Card>
      <div className="flex flex-wrap gap-2 px-5 py-3.5">
        {visible.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={a.disabled}
            onClick={() => onAction(a.key)}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2 text-[12px] font-bold text-subtle transition-colors hover:border-neon/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
    </Card>
  );
}
