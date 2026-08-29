import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArrowRight,
  Camera,
  Pencil,
  Undo2,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { parseDateKey } from "@/core/dates";
import { formatDateShort } from "@/services/format";
import { memberStatusMeta } from "@/utils/status-meta";
import type { PublicMember } from "@/core/services/members.service";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface MemberHeaderProps {
  member: PublicMember;
  onReload: () => void;
  onEdit: () => void;
}

function InfoRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="shrink-0 text-xs font-semibold text-faint">{label}</dt>
      <dd dir={ltr ? "ltr" : undefined} className="min-w-0 truncate font-semibold tabnum">
        {value}
      </dd>
    </div>
  );
}

export function MemberHeader({ member, onReload, onEdit }: MemberHeaderProps) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusMeta = memberStatusMeta(t, member.status);
  const archived = member.status === "archived";

  const onArchive = async () => {
    if (!actor) return;
    setBusy(true);
    try {
      await api.members.setStatus(member.id, archived ? "active" : "archived");
      toast("success", t("toast.saved"));
      setArchiveOpen(false);
      onReload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !actor) return;
    setPhotoBusy(true);
    try {
      const { id: fileId } = await api.files.upload("member_photo", file);
      await api.members.setMemberPhoto(member.id, fileId);
      toast("success", t("toast.saved"));
      onReload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onPhotoRemove = async () => {
    if (!actor) return;
    setPhotoBusy(true);
    try {
      await api.members.removeMemberPhoto(member.id);
      toast("success", t("toast.saved"));
      onReload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="relative shrink-0">
          {member.photoFileId ? (
            <img
              src={api.files.url(member.photoFileId)}
              alt={member.fullName}
              className="size-20 rounded-xl object-cover"
            />
          ) : (
            <Avatar name={member.fullName} size="lg" />
          )}
          {hasPermission("members.edit") && (
            <div className="absolute -bottom-1 -left-1 flex gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onPhotoUpload}
              />
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => fileInputRef.current?.click()}
                className="grid size-7 place-items-center rounded-lg border border-line bg-card text-subtle transition-colors hover:text-ink disabled:opacity-50"
                title={t("members.formPhoto")}
              >
                <Camera className="size-3.5" />
              </button>
              {member.photoFileId && (
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={onPhotoRemove}
                  className="grid size-7 place-items-center rounded-lg border border-line bg-card text-subtle transition-colors hover:text-red disabled:opacity-50"
                  title={t("common.delete")}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-extrabold">{member.fullName}</h2>
            <Badge variant={statusMeta.variant} dot>
              {statusMeta.label}
            </Badge>
          </div>
          <p dir="ltr" className="mt-1 text-xs text-faint tabnum">
            {member.memberCode}
          </p>
          <dl className="mt-4 grid gap-x-8 gap-y-2.5 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
            <InfoRow label={t("common.phone")} value={member.phone ?? "—"} ltr />
            <InfoRow label={t("common.email")} value={member.email ?? "—"} ltr />
            <InfoRow
              label={t("members.gender")}
              value={member.gender ? t(`members.${member.gender}`) : "—"}
            />
            <InfoRow
              label={t("members.dob")}
              value={member.dateOfBirth ? formatDateShort(parseDateKey(member.dateOfBirth)) : "—"}
            />
            <InfoRow label={t("members.address")} value={member.address ?? "—"} />
            <InfoRow
              label={t("members.registeredAt")}
              value={formatDateShort(parseDateKey(member.registrationDate))}
            />
            <InfoRow
              label={t("members.department")}
              value={
                member.department === "men"
                  ? t("members.deptMen")
                  : member.department === "women"
                    ? t("members.deptWomen")
                    : t("members.deptGeneral")
              }
            />
            <InfoRow
              label={t("members.formHeight")}
              value={member.heightCm == null ? "—" : `${member.heightCm}`}
              ltr
            />
            <InfoRow
              label={t("members.formWeight")}
              value={member.weightKg == null ? "—" : `${member.weightKg}`}
              ltr
            />
            <InfoRow
              label={t("members.formEmergencyName")}
              value={member.emergencyContactName ?? "—"}
            />
            <InfoRow
              label={t("members.formEmergencyPhone")}
              value={member.emergencyContactPhone ?? "—"}
              ltr
            />
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/members"
            className="grid size-9 place-items-center rounded-xl border border-line text-subtle transition-colors hover:border-line-strong hover:text-ink"
            aria-label={t("nav.members")}
          >
            <ArrowRight className="size-4" />
          </Link>
          {!archived && hasPermission("members.edit") && (
            <Button variant="secondary" onClick={onEdit}>
              <Pencil className="size-4" />
              {t("common.edit")}
            </Button>
          )}
          {hasPermission("members.change_status") && (
            <Button variant={archived ? "primary" : "danger"} onClick={() => setArchiveOpen(true)}>
              {archived ? <Undo2 className="size-4" /> : <Archive className="size-4" />}
              {archived ? t("members.restoreMember") : t("members.archiveMember")}
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={archived ? t("members.restoreMember") : t("members.archiveMember")}
        message={archived ? t("members.activateMember") : t("members.archiveConfirmMsg")}
        tone={archived ? "primary" : "danger"}
        loading={busy}
        onConfirm={onArchive}
      />
      <button
        type="button"
        onClick={() => navigate("/members")}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />
    </Card>
  );
}
