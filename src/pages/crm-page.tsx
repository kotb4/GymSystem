import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { Card, CardHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { LeadsTab } from "@/pages/leads-tab";
import { TrialsTab } from "@/pages/trials-tab";

export function CrmPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [params] = useSearchParams();
  const initial = () => {
    const q = params.get("tab");
    if (q === "trials" && hasPermission("trials.view")) return "trials";
    return "leads";
  };
  const [tab, setTab] = useState<string>(initial);
  const tabItems = [];
  if (hasPermission("leads.view")) {
    tabItems.push({ value: "leads", label: t("leadsTab.title") });
  }
  if (hasPermission("trials.view")) {
    tabItems.push({ value: "trials", label: t("trialsTab.title") });
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("crmPage.title")}
          description={t("crmPage.leadsTrialsSubtitle")}
        />
        {tabItems.length > 1 && (
          <div className="px-5 pb-1">
            <Tabs items={tabItems} value={tab} onChange={setTab} />
          </div>
        )}
      </Card>
      {tab === "leads" && <LeadsTab />}
      {tab === "trials" && <TrialsTab />}
    </div>
  );
}