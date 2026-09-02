import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { Tabs } from "@/components/ui/tabs";
import { FastCheckInTab } from "@/components/attendance/fast-checkin-tab";
import { ReceptionTab } from "@/components/attendance/reception-tab";

type AttendanceTab = "checkin" | "reception";

export function AttendancePage() {
  const t = useT();
  const { hasPermission } = useAuth();

  const canCheckIn = hasPermission("checkin.create");
  const canReception = hasPermission("reception.view");

  const [tab, setTab] = useState<AttendanceTab>("checkin");

  useEffect(() => {
    document.title = `${t("nav.checkin")} — ${t("app.name")}`;
  }, [t]);

  useEffect(() => {
    if (tab === "checkin" && !canCheckIn && canReception) setTab("reception");
    if (tab === "reception" && !canReception && canCheckIn) setTab("checkin");
  }, [tab, canCheckIn, canReception]);

  if (!canCheckIn && !canReception) return null;

  return (
    <div className="space-y-4">
      <Tabs
        items={[
          { value: "checkin", label: t("nav.attendanceFast") },
          { value: "reception", label: t("nav.attendanceSearch") },
        ]}
        value={tab}
        onChange={(v) => setTab(v as AttendanceTab)}
      />
      {tab === "checkin" && canCheckIn && <FastCheckInTab />}
      {tab === "reception" && canReception && <ReceptionTab />}
    </div>
  );
}
