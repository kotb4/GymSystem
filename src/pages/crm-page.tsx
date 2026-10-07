import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Gift, MessagesSquare, Share2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-extrabold">{t("crmPage.title")}</h2>
            <p className="text-[13px] text-subtle">{t("crmPage.leadsTrialsSubtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasPermission("messages.view") && (
              <Link to="/messages">
                <Button variant="secondary" size="sm">
                  <MessagesSquare className="size-4 text-emerald-400" />
                  {t("nav.messages")}
                </Button>
              </Link>
            )}
            {hasPermission("loyalty.manage") && (
              <Link to="/loyalty">
                <Button variant="secondary" size="sm">
                  <Gift className="size-4" />
                  {t("nav.loyalty")}
                </Button>
              </Link>
            )}
            {hasPermission("referrals.view") && (
              <Link to="/referrals">
                <Button variant="secondary" size="sm">
                  <Share2 className="size-4" />
                  {t("nav.referrals")}
                </Button>
              </Link>
            )}
          </div>
        </div>
        {tabItems.length > 1 && (
          <div className="border-t border-line/60 px-5 py-3">
            <Tabs items={tabItems} value={tab} onChange={setTab} />
          </div>
        )}
      </Card>
      {tab === "leads" && <LeadsTab />}
      {tab === "trials" && <TrialsTab />}
    </div>
  );
}