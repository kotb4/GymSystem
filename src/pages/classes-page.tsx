import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { Tabs } from "@/components/ui/tabs";
import { ClassesTab } from "@/components/classes/classes-tab";
import { ScheduleTab } from "@/components/classes/schedule-tab";
import { TrainersTab } from "@/components/classes/trainers-tab";
import { PlansTab } from "@/components/classes/plans-tab";

export function ClassesPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const canClasses = hasPermission("classes.view");
  const canTrainers = hasPermission("trainers.view");
  const [tab, setTab] = useState("classes");

  const items = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    if (canClasses) {
      list.push({ value: "classes", label: t("cls.tabClasses") });
      list.push({ value: "schedule", label: t("cls.tabSchedule") });
    }
    if (canTrainers) {
      list.push({ value: "trainers", label: t("cls.tabTrainers") });
      list.push({ value: "plans", label: t("cls.tabMemberPlans") });
    }
    return list;
  }, [canClasses, canTrainers, t]);

  const active = items.some((i) => i.value === tab) ? tab : items[0]?.value ?? "classes";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={items} value={active} onChange={setTab} />
      </div>
      {active === "schedule" ? (
        <ScheduleTab />
      ) : active === "trainers" ? (
        <TrainersTab />
      ) : active === "plans" ? (
        <PlansTab />
      ) : (
        <ClassesTab />
      )}
    </div>
  );
}