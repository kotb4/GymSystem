import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api } from "@/api";
import { formatDateShort, formatTime } from "@/services/format";
import { formatMinor } from "@/core/money";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ScanLine, MessageCircle, Scale, Dumbbell, Activity as ActivityIcon } from "lucide-react";
import { subStatusMeta } from "@/utils/status-meta";
import { Badge } from "@/components/ui/badge";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

interface OverviewItem {
  id: string;
  date: string;
  label: string;
}

export function OverviewTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();

  if (!hasPermission("members.view")) {
    return permissionDeniedNode(t);
  }

  const active = ctx.overview?.activeSubscription ?? null;
  const kind = active?.kind ?? "time";
  const sessionsLeft =
    kind === "sessions" && active?.sessionsTotal != null
      ? Math.max(0, active.sessionsTotal - active.sessionsUsed)
      : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("subs.tabSubs")} />
          <div className="px-5 pb-4 text-sm">
            {active ? (
              <div className="space-y-1.5">
                <div className="flex justify-between"><span className="text-subtle">{t("common.plan")}</span><span className="font-bold">{active.planName ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-subtle">{t("subs.period")}</span><span dir="ltr" className="tabnum">{active.startDate} ← {active.endDate}</span></div>
                <div className="flex justify-between"><span className="text-subtle">{t("members.statDaysLeft")}</span><span className="font-bold tabnum">{ctx.overview?.nextSubDaysLeft ?? "—"} {t("subs.daysUnit")}</span></div>
                {sessionsLeft != null && (
                  <div className="flex justify-between"><span className="text-subtle">{t("members.statVisitsLeft")}</span><span className="font-bold tabnum">{sessionsLeft}</span></div>
                )}
                <div className="flex justify-between"><span className="text-subtle">{t("common.status")}</span><Badge variant={subStatusMeta(t, "active").variant} dot>{subStatusMeta(t, "active").label}</Badge></div>
              </div>
            ) : (
              <EmptyState icon={<ActivityIcon />} title={t("members.statNoActiveSub")} />
            )}
          </div>
        </Card>
        <RecentAttendanceCard memberId={ctx.member.id} reloadTick={ctx.reloadTick} />
        <RecentInbodyCard memberId={ctx.member.id} reloadTick={ctx.reloadTick} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RecentCommsCard memberId={ctx.member.id} reloadTick={ctx.reloadTick} />
        <RecentTrainingCard memberId={ctx.member.id} reloadTick={ctx.reloadTick} />
        <RecentPaymentCard memberId={ctx.member.id} reloadTick={ctx.reloadTick} />
      </div>
    </div>
  );
}

function RecentAttendanceCard({ memberId, reloadTick }: { memberId: string; reloadTick: number }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<OverviewItem[]>([]);
  useEffect(() => {
    if (!hasPermission("checkin.view_history")) return;
    let alive = true;
    api.attendance
      .forMember(memberId, 5)
      .then((rows) => {
        if (!alive) return;
        const typed = rows as Array<{ id: string; checkin_at: string }>;
        setItems(
          typed.map((r) => ({
            id: r.id,
            date: r.checkin_at,
            label: formatDateShort(new Date(r.checkin_at)) + " " + formatTime(new Date(r.checkin_at)),
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasPermission, memberId, reloadTick]);
  if (!hasPermission("checkin.view_history")) return null;
  return (
    <Card>
      <CardHeader title={t("members.tabAttendance")} />
      <div className="px-5 pb-4 text-sm">
        {items.length === 0 ? (
          <EmptyState icon={<ScanLine />} title={t("members.statNeverVisited")} />
        ) : (
          <ul className="space-y-1.5">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span className="text-subtle">{t("common.date")}</span>
                <span dir="ltr" className="tabnum font-semibold">{i.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function RecentInbodyCard({ memberId, reloadTick }: { memberId: string; reloadTick: number }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<Array<{ id: string; assessmentDate: string; weightKg: number | null }>>([]);
  useEffect(() => {
    if (!hasPermission("assessments.view")) return;
    let alive = true;
    api.inbody
      .list(memberId, 3)
      .then((rows) => {
        if (!alive) return;
        setItems(rows as Array<{ id: string; assessmentDate: string; weightKg: number | null }>);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasPermission, memberId, reloadTick]);
  if (!hasPermission("assessments.view")) return null;
  return (
    <Card>
      <CardHeader title={t("inbody.tabTitle")} />
      <div className="px-5 pb-4 text-sm">
        {items.length === 0 ? (
          <EmptyState icon={<Scale />} title={t("inbody.empty")} />
        ) : (
          <ul className="space-y-1.5">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span dir="ltr" className="tabnum text-subtle">{i.assessmentDate}</span>
                <span className="font-bold tabnum">{i.weightKg ?? "—"} {t("members.formWeight")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function RecentCommsCard({ memberId, reloadTick }: { memberId: string; reloadTick: number }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<Array<{ id: string; createdAt: string; templateCode: string; status: string }>>([]);
  useEffect(() => {
    if (!hasPermission("crm.send")) return;
    let alive = true;
    api.crm
      .listMessages({ memberId, limit: 3 } as never)
      .then((rows) => {
        if (!alive) return;
        const typed = rows as Array<{ id: string; createdAt: string; templateCode: string; status: string }>;
        setItems(typed);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasPermission, memberId, reloadTick]);
  if (!hasPermission("crm.send")) return null;
  return (
    <Card>
      <CardHeader title={t("members.tabComms")} />
      <div className="px-5 pb-4 text-sm">
        {items.length === 0 ? (
          <EmptyState icon={<MessageCircle />} title={t("members.commsEmpty")} />
        ) : (
          <ul className="space-y-1.5">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span className="font-semibold">{i.templateCode}</span>
                <span dir="ltr" className="tabnum text-faint">{formatDateShort(new Date(i.createdAt))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function RecentTrainingCard({ memberId, reloadTick }: { memberId: string; reloadTick: number }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<Array<{ id: string; startDate: string; endDate: string; status: string }>>([]);
  useEffect(() => {
    if (!hasPermission("members.view")) return;
    let alive = true;
    api.trainingPlans
      .list({ memberId, limit: 3 } as never)
      .then((res) => {
        if (!alive) return;
        const typed = (res.items as Array<{ id: string; startDate: string; endDate: string; status: string }>);
        setItems(typed);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasPermission, memberId, reloadTick]);
  if (!hasPermission("members.view")) return null;
  return (
    <Card>
      <CardHeader title={t("members.tabTraining")} />
      <div className="px-5 pb-4 text-sm">
        {items.length === 0 ? (
          <EmptyState icon={<Dumbbell />} title={t("trainers.plansEmptyTitle")} />
        ) : (
          <ul className="space-y-1.5">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span dir="ltr" className="tabnum text-subtle">{i.startDate} → {i.endDate}</span>
                <span className="font-semibold">{i.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function RecentPaymentCard({ memberId, reloadTick }: { memberId: string; reloadTick: number }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<Array<{ id: string; paidAt: string; paidAmountMinor: number }>>([]);
  useEffect(() => {
    if (!hasPermission("payments.view")) return;
    let alive = true;
    api.payments
      .list({ memberId, pageSize: 3, page: 1 } as never)
      .then((res) => {
        if (!alive) return;
        const typed = (res.items as Array<{ id: string; paidAt: string; paidAmountMinor: number }>);
        setItems(typed);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasPermission, memberId, reloadTick]);
  if (!hasPermission("payments.view")) return null;
  return (
    <Card>
      <CardHeader title={t("members.tabPayments")} />
      <div className="px-5 pb-4 text-sm">
        {items.length === 0 ? (
          <p className="text-faint text-center py-3 text-[12px]">{t("members.paymentsEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span dir="ltr" className="tabnum text-subtle">{i.paidAt.slice(0, 10)}</span>
                <span className="font-bold tabnum text-neon">{formatMinor(i.paidAmountMinor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
