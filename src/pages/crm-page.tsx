import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, PhoneCall, TrendingUp, Users } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { api, type LeadStats, type TrialStats } from "@/api";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { LeadsTab } from "@/pages/leads-tab";
import { TrialsTab } from "@/pages/trials-tab";
import { formatNumber } from "@/services/format";
import { PageHeader } from "@/components/ui/page-header";

export function CrmPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [params] = useSearchParams();
  const [leadStats, setLeadStats] = useState<LeadStats | null>(null);
  const [trialStats, setTrialStats] = useState<TrialStats | null>(null);

  const initial = () => {
    const q = params.get("tab");
    if (q === "trials" && hasPermission("trials.view")) return "trials";
    return "leads";
  };
  const [tab, setTab] = useState<string>(initial);

  useEffect(() => {
    let alive = true;
    if (hasPermission("leads.view")) {
      api.lead.stats().then((res) => {
        if (alive) setLeadStats(res);
      }).catch(console.error);
    }
    if (hasPermission("trials.view")) {
      api.trials.stats().then((res) => {
        if (alive) setTrialStats(res);
      }).catch(console.error);
    }
    return () => {
      alive = false;
    };
  }, [hasPermission]);

  const tabItems = [];
  if (hasPermission("leads.view")) {
    tabItems.push({ value: "leads", label: t("leadsTab.title") });
  }
  if (hasPermission("trials.view")) {
    tabItems.push({ value: "trials", label: t("trialsTab.title") });
  }

  return (
    <div className="space-y-4">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={PhoneCall}
        title={t("crmPage.title")}
        subtitle={t("crmPage.leadsTrialsSubtitle")}
      />

      {/* 2. SUB-SECTION TABS SWITCHER */}
      {tabItems.length > 1 && (
        <div className="flex items-center justify-between">
          <Tabs items={tabItems} value={tab} onChange={setTab} />
        </div>
      )}

      {/* 4 Professional CRM KPI Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("crmPage.totalLeads")}
          subtitle={`${t("crmPage.newThisMonth")}: ${formatNumber(leadStats?.newThisMonth ?? 0)}`}
          value={formatNumber(leadStats?.total ?? 0)}
          icon={<Users className="size-5" />}
          accent="cyan"
        />
        <StatCard
          title={t("crmPage.conversionRate")}
          subtitle={t("crmPage.joinedCount", { count: formatNumber(leadStats?.joined ?? 0) })}
          value={`${leadStats?.conversionRate ?? 0}%`}
          icon={<TrendingUp className="size-5" />}
          accent="neon"
        />
        <StatCard
          title={t("crmPage.dueFollowups")}
          subtitle={t("crmPage.requireContact")}
          value={formatNumber(leadStats?.dueFollowups ?? 0)}
          icon={<PhoneCall className="size-5" />}
          accent="amber"
        />
        <StatCard
          title={t("crmPage.activeTrials")}
          subtitle={t("crmPage.runningTrials")}
          value={formatNumber(trialStats?.active ?? 0)}
          icon={<CalendarClock className="size-5" />}
          accent="violet"
        />
      </div>

      {tab === "leads" && <LeadsTab />}
      {tab === "trials" && <TrialsTab />}
    </div>
  );
}