import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { api } from "@/api";
import type { PublicMember } from "@/core/services/members.service";
import type { Subscription } from "@/core/services/subscriptions.service";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { MemberHeader } from "./header";
import { OutstandingStrip } from "./outstanding-strip";
import { SummaryStats } from "./summary-stats";
import { QuickActions, type QuickAction } from "./quick-actions";
import { MemberFormModal } from "@/components/members/member-form-modal";
import { AssignCardModal } from "@/components/cards/assign-card-modal";
import { SubscriptionFormModal } from "@/components/subscriptions/subscription-form-modal";
import { FreezeSubscriptionModal } from "@/components/subscriptions/freeze-subscription-modal";
import { RenewModal } from "./modals/renew-modal";
import { GuestInvitationsModal } from "@/components/subscriptions/guest-invitations-modal";
import { useMemberOverview } from "./helpers";
import type { MemberProfileContext, TabKey } from "./types";
import { OverviewTab } from "./tabs/overview-tab";
import { MembershipTab } from "./tabs/membership-tab";
import { PaymentsTab } from "./tabs/payments-tab";
import { AttendanceTab } from "./tabs/attendance-tab";
import { PtClassesTab } from "./tabs/pt-classes-tab";
import { NotesTab } from "./tabs/notes-tab";
import { ActivityTab } from "./tabs/activity-tab";
import { ReferralsTab } from "./tabs/referrals-tab";
import { LoyaltyTab } from "./tabs/loyalty-tab";
import { CheckinModal } from "./modals/checkin-modal";
import { AddNoteModal } from "./modals/add-note-modal";
import { TrainingPlanFormModal } from "./modals/training-plan-form-modal";
import { PaymentFormModal } from "@/components/finance/payment-form-modal";
import { SettleMemberDuesModal } from "@/components/finance/settle-member-dues-modal";
import type { Permission } from "@/core/permissions";

interface TabDef {
  key: TabKey;
  labelKey: string;
  perm?: Permission;
  anyPerm?: Permission[];
  featureFlag?: string;
  anyFeatureFlag?: string[];
}

const ALL_TABS: TabDef[] = [
  { key: "overview", labelKey: "members.tabOverview", perm: "members.view" },
  { key: "membership", labelKey: "members.tabMembership", anyPerm: ["cards.view", "subscriptions.view"], anyFeatureFlag: ["featureSubscriptionsEnabled", "featureCardsEnabled"] },
  { key: "payments", labelKey: "members.tabPayments", perm: "payments.view", featureFlag: "featureTreasuryEnabled" },
  { key: "attendance", labelKey: "members.tabAttendance", perm: "checkin.view_history", featureFlag: "featureAttendanceEnabled" },
  { key: "pt-classes", labelKey: "members.tabPtClasses", anyPerm: ["members.view", "classes.view"], featureFlag: "featureClassesEnabled" },
  { key: "notes", labelKey: "members.tabNotes", perm: "members.edit" },
  { key: "activity", labelKey: "members.tabActivity", perm: "audit.view" },
  { key: "referrals", labelKey: "referral.tabReferrals", perm: "referrals.view", featureFlag: "featureReferralsEnabled" },
  { key: "loyalty", labelKey: "members.tabLoyalty", perm: "loyalty.view", featureFlag: "featureLoyaltyEnabled" },
];

export function MemberProfilePage() {
  const t = useT();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { memberId = "" } = useParams();
  const { actor, hasPermission, isFeatureEnabled } = useAuth();

  const [member, setMember] = useState<PublicMember | null>(null);
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<TabKey>("overview");

  const [editOpen, setEditOpen] = useState(false);
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [subModalCategory, setSubModalCategory] = useState<"gym" | "academy">("gym");
  const [freezeModalOpen, setFreezeModalOpen] = useState(false);
  const [freezeSub, setFreezeSub] = useState<Subscription | null>(null);
  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [renewSub, setRenewSub] = useState<Subscription | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [ptOpen, setPtOpen] = useState(false);
  const [invitationsOpen, setInvitationsOpen] = useState(false);
  const [outstandingMinor, setOutstandingMinor] = useState(0);

  const { overview, loading: overviewLoading } = useMemberOverview(memberId, tick);

  const reload = useCallback(() => {
    if (!actor) return;
    let alive = true;
    api.members
      .get(memberId)
      .then((m) => {
        if (alive) {
          setMember(m);
          setMissing(false);
          setTick((v) => v + 1);
        }
      })
      .catch(() => {
        if (alive) setMissing(true);
      });
    api.finance
      .outstandingForMember(memberId)
      .then((r) => {
        if (alive) setOutstandingMinor(r.totalMinor);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [actor, memberId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!hasPermission("members.view")) {
      setTab("overview");
      return;
    }
    if (!ALL_TABS.find((t) => t.key === tab && canShowTab(t, hasPermission, isFeatureEnabled))) {
      const next = ALL_TABS.find((t) => canShowTab(t, hasPermission, isFeatureEnabled));
      if (next) setTab(next.key);
    }
  }, [hasPermission, isFeatureEnabled, tab]);

  if (missing) {
    return (
      <EmptyState
        icon={<ArrowRight className="rotate-180" />}
        title={t("errors.memberNotFound")}
        action={
          <Button variant="secondary" onClick={() => navigate("/members")}>
            {t("nav.members")}
          </Button>
        }
      />
    );
  }
  if (!member) {
    return <p className="py-16 text-center text-sm text-faint">{t("common.loading")}</p>;
  }

  const tabs = ALL_TABS.filter((tb) => canShowTab(tb, hasPermission, isFeatureEnabled)).map((tb) => ({
    value: tb.key,
    label: t(tb.labelKey),
  }));

  const ctx: MemberProfileContext = {
    member,
    overview,
    reloadTick: tick,
    reload,
    onAddSubscription: (cat?: "gym" | "academy") => {
      setSubModalCategory(cat ?? "gym");
      setSubModalOpen(true);
    },
  };

  const onQuickAction = (a: QuickAction) => {
    switch (a) {
      case "checkin": setCheckinOpen(true); break;
      case "renew":
        void (async () => {
          try {
            const subs = await api.subscriptions.listForMember(member.id);
            const activeId = overview?.activeSubscription?.id;
            const target =
              (activeId ? subs.find((s) => s.id === activeId) : null) ??
              subs.find((s) => s.status === "active") ??
              subs[0];
            if (target) {
              setRenewSub(target);
              setRenewModalOpen(true);
            } else {
              setSubModalCategory("gym");
              setSubModalOpen(true);
            }
          } catch {
            setSubModalCategory("gym");
            setSubModalOpen(true);
          }
        })();
        break;
      case "freeze":
        void (async () => {
          try {
            const subs = await api.subscriptions.listForMember(member.id);
            const activeId = overview?.activeSubscription?.id;
            const target =
              (activeId ? subs.find((s) => s.id === activeId) : null) ??
              subs.find((s) => s.status === "active");
            if (target) {
              setFreezeSub(target);
              setFreezeModalOpen(true);
            } else {
              toast("error", "لا يوجد اشتراك نشط لهذا العضو لإجراء التجميد");
            }
          } catch {
            toast("error", "تعذر جلب تفاصيل الاشتراك النشط للتجميد");
          }
        })();
        break;
      case "recordPayment": setPaymentOpen(true); break;
      case "inviteGuest": setInvitationsOpen(true); break;
      case "addNote": setNoteOpen(true); break;
      case "addPt": setPtOpen(true); break;
      case "assignCard": setCardModalOpen(true); break;
    }
  };

  return (
    <div className="space-y-4">
      <MemberHeader
        member={member}
        onReload={reload}
        onEdit={() => setEditOpen(true)}
        onNewSubscription={() => {
          setSubModalCategory("gym");
          setSubModalOpen(true);
        }}
        onRecordPayment={() => setPaymentOpen(true)}
        onInviteGuest={() => setInvitationsOpen(true)}
      />
      <SummaryStats
        overview={overview}
        outstandingMinor={outstandingMinor}
        loading={overviewLoading}
      />
      <OutstandingStrip memberId={member.id} version={tick} onPay={() => setPaymentOpen(true)} />
      <QuickActions
        onAction={onQuickAction}
        activeSubscriptionId={overview?.activeSubscription?.id ?? null}
        memberArchived={member.status === "archived"}
      />
      <Tabs items={tabs} value={tab} onChange={(v) => setTab(v as TabKey)} />
      {tab === "overview" && <OverviewTab ctx={ctx} />}
      {tab === "membership" && <MembershipTab ctx={ctx} />}
      {tab === "payments" && <PaymentsTab ctx={ctx} />}
      {tab === "attendance" && <AttendanceTab ctx={ctx} />}
      {tab === "pt-classes" && <PtClassesTab ctx={ctx} />}
      {tab === "notes" && <NotesTab ctx={ctx} />}
      {tab === "activity" && <ActivityTab ctx={ctx} />}
      {tab === "referrals" && <ReferralsTab ctx={ctx} />}
      {tab === "loyalty" && <LoyaltyTab ctx={ctx} />}

      <MemberFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={reload} member={member} />
      <AssignCardModal open={cardModalOpen} onClose={() => setCardModalOpen(false)} onDone={reload} presetMember={member} />
      <SubscriptionFormModal
        open={subModalOpen}
        onClose={() => setSubModalOpen(false)}
        onSaved={reload}
        presetMember={member}
        defaultCategory={subModalCategory}
      />
      <CheckinModal open={checkinOpen} onClose={() => setCheckinOpen(false)} member={member} onChecked={reload} />
      <AddNoteModal open={noteOpen} onClose={() => setNoteOpen(false)} member={member} onSaved={reload} />
      {outstandingMinor > 0 ? (
        <SettleMemberDuesModal
          open={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          member={member}
          onSaved={reload}
        />
      ) : (
        <PaymentFormModal
          open={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          presetMember={member}
          onSaved={reload}
        />
      )}
      <TrainingPlanFormModal
        open={ptOpen}
        onClose={() => setPtOpen(false)}
        member={member}
        onSaved={() => { setPtOpen(false); reload(); }}
      />
      <GuestInvitationsModal
        open={invitationsOpen}
        onClose={() => { setInvitationsOpen(false); reload(); }}
        memberId={member.id}
        memberName={member.fullName}
      />
      {freezeSub && (
        <FreezeSubscriptionModal
          open={freezeModalOpen}
          onClose={() => {
            setFreezeModalOpen(false);
            setFreezeSub(null);
          }}
          subscription={freezeSub}
          onSaved={() => {
            setFreezeModalOpen(false);
            setFreezeSub(null);
            reload();
          }}
        />
      )}
      {renewSub && (
        <RenewModal
          sub={renewSub}
          member={member}
          open={renewModalOpen}
          onClose={() => {
            setRenewModalOpen(false);
            setRenewSub(null);
          }}
          onDone={() => {
            setRenewModalOpen(false);
            setRenewSub(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

type HasPermFn = (p: Permission) => boolean;
type IsFlagEnabledFn = (flag: string) => boolean;

function canShowTab(tab: TabDef, hasPermission: HasPermFn, isFeatureEnabled: IsFlagEnabledFn): boolean {
  if (tab.featureFlag && !isFeatureEnabled(tab.featureFlag)) return false;
  if (tab.anyFeatureFlag && !tab.anyFeatureFlag.some((f) => isFeatureEnabled(f))) return false;
  if (tab.perm) return hasPermission(tab.perm);
  if (tab.anyPerm) return tab.anyPerm.some((p) => hasPermission(p));
  return true;
}