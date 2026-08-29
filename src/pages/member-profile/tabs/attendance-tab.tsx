import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ScanLine, Trash2 } from "lucide-react";
import { formatDateShort, formatTime } from "@/services/format";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

interface AttendanceItem {
  id: string;
  checkin_at: string;
}

export function AttendanceTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<AttendanceItem[]>([]);
  const canView = hasPermission("checkin.view_history");
  const canDelete = hasPermission("checkin.delete");

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    api.attendance
      .forMember(ctx.member.id, 100)
      .then((items) => {
        if (alive) setRows(items as AttendanceItem[]);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [canView, ctx.member.id, ctx.reloadTick]);

  if (!canView) {
    return permissionDeniedNode(t);
  }

  async function handleDelete(id: string) {
    try {
      await api.attendance.delete(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast("success", t("members.attendanceDeleted"));
      ctx.reload();
    } catch (e) {
      toast("error", describeError(e, t));
    }
  }

  return (
    <Card>
      <CardHeader title={t("members.tabAttendance")} />
      {rows.length === 0 ? (
        <EmptyState icon={<ScanLine />} title={t("members.attendanceEmpty")} />
      ) : (
        <ul className="divide-y divide-line px-5 pb-4">
          {rows.map((row, index) => (
            <li key={`${row.checkin_at}-${index}`} className="flex items-center justify-between py-2.5 text-sm">
              <span dir="ltr" className="font-semibold tabnum">
                {formatDateShort(new Date(row.checkin_at))}
              </span>
              <div className="flex items-center gap-3">
                <span dir="ltr" className="text-faint tabnum">
                  {formatTime(new Date(row.checkin_at))}
                </span>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(row.id)}
                    className="text-faint hover:text-red transition-colors"
                    title={t("common.delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
