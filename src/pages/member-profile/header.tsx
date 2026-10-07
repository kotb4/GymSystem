import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArrowRight,
  Banknote,
  Camera,
  Image as ImageIcon,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { parseDateKey } from "@/core/dates";
import { formatDate } from "@/services/format";
import { memberStatusMeta } from "@/utils/status-meta";
import type { PublicMember } from "@/core/services/members.service";
import { Avatar } from "@/components/ui/avatar";
import { compressMemberPhoto } from "@/utils/image-compressor";
import { Badge } from "@/components/ui/badge";
import { BranchBadge } from "@/components/ui/branch-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CameraCapture } from "@/components/ui/camera-capture";
import { QuickWhatsAppModal } from "@/components/messages/quick-whatsapp-modal";

interface MemberHeaderProps {
  member: PublicMember;
  onReload: () => void;
  onEdit: () => void;
  onNewSubscription?: () => void;
  onRecordPayment?: () => void;
  onInviteGuest?: () => void;
}

function InfoRow({
  label,
  value,
  ltr,
  className,
}: {
  label: string;
  value: string;
  ltr?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-wrap items-baseline gap-1.5 sm:gap-2 ${className ?? ""}`}>
      <dt className="shrink-0 text-xs font-semibold text-faint">{label}:</dt>
      <dd
        dir={ltr ? "ltr" : undefined}
        title={value}
        className="min-w-0 font-bold tabnum text-foreground"
      >
        {value}
      </dd>
    </div>
  );
}

export function MemberHeader({
  member,
  onReload,
  onEdit,
  onNewSubscription,
  onRecordPayment,
  onInviteGuest,
}: MemberHeaderProps) {
  const t = useT();
  const { actor, hasPermission, isFeatureEnabled } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);
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

  const onTrash = async () => {
    if (!actor) return;
    setBusy(true);
    try {
      await api.members.trash(member.id, null);
      toast("success", t("members.trashedToast"));
      setTrashOpen(false);
      navigate("/members", { replace: true });
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const applyPhotoFile = async (file: File) => {
    if (!actor) return;
    setPhotoBusy(true);
    try {
      const compressed = await compressMemberPhoto(file, { maxDimension: 512, quality: 0.82 });
      const { id: fileId } = await api.files.upload("member_photo", compressed);
      await api.members.setMemberPhoto(member.id, fileId);
      toast("success", t("toast.saved"));
      onReload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPhotoBusy(false);
    }
  };

  const onPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await applyPhotoFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onCameraCapture = async (file: File) => {
    setCameraOpen(false);
    await applyPhotoFile(file);
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
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => setCameraOpen(true)}
                className="grid size-7 place-items-center rounded-lg border border-line bg-card text-subtle transition-colors hover:text-ink disabled:opacity-50"
                title={t("members.formPhotoCamera")}
              >
                <Camera className="size-3.5" />
              </button>
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
                <ImageIcon className="size-3.5" />
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
            <BranchBadge branchId={member.branchId} />
          </div>
          <p dir="ltr" className="mt-1 text-xs text-faint tabnum">
            {member.memberCode}
          </p>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-1.5 sm:gap-2">
              <dt className="shrink-0 text-xs font-semibold text-faint">{t("common.phone")}:</dt>
              <dd dir="ltr" className="min-w-0 font-bold tabnum flex items-center gap-1.5 text-foreground">
                <span>{member.phone ?? "—"}</span>
                {member.phone && (
                  <button
                    type="button"
                    onClick={() => setWhatsAppOpen(true)}
                    className="inline-flex size-5 items-center justify-center rounded bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors"
                    title={t("messages.quickWhatsAppTitle")}
                  >
                    <MessageSquare className="size-3" />
                  </button>
                )}
              </dd>
            </div>
            <InfoRow label={t("common.email")} value={member.email ?? "—"} ltr />
            <InfoRow
              label={t("members.gender")}
              value={member.gender ? t(`members.${member.gender}`) : "—"}
            />
            <InfoRow
              label={t("members.dob")}
              value={member.dateOfBirth ? formatDate(parseDateKey(member.dateOfBirth)) : "—"}
            />
            <InfoRow label={t("members.address")} value={member.address ?? "—"} />
            <InfoRow
              label={t("members.registeredAt")}
              value={member.registrationDate ? formatDate(parseDateKey(member.registrationDate)) : "—"}
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
              value={member.heightCm == null ? "—" : `${member.heightCm} سم`}
              ltr
            />
            <InfoRow
              label={t("members.formWeight")}
              value={member.weightKg == null ? "—" : `${member.weightKg} كجم`}
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
          {member.notes && member.notes.trim() !== "" && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-xs text-amber">
              <span className="font-bold shrink-0">{t("members.notes")}:</span>
              <p className="whitespace-pre-line leading-relaxed font-medium text-amber-200">{member.notes}</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/members"
            className="grid size-9 place-items-center rounded-xl border border-line text-subtle transition-colors hover:border-line-strong hover:text-ink"
            aria-label={t("nav.members")}
          >
            <ArrowRight className="size-4" />
          </Link>
          {!archived && isFeatureEnabled("featureSubscriptionsEnabled") && hasPermission("subscriptions.create") && onNewSubscription && (
            <Button variant="primary" onClick={onNewSubscription}>
              <Plus className="size-4" />
              {t("subs.addSubscription")}
            </Button>
          )}
          {!archived && isFeatureEnabled("featureTreasuryEnabled") && hasPermission("payments.create") && onRecordPayment && (
            <Button variant="secondary" onClick={onRecordPayment}>
              <Banknote className="size-4" />
              {t("pay.addPayment")}
            </Button>
          )}
          {!archived && isFeatureEnabled("featureSubscriptionsEnabled") && hasPermission("invitations.manage") && onInviteGuest && (
            <Button
              variant="secondary"
              onClick={onInviteGuest}
              className="border-neon/40 bg-neon/10 text-neon hover:bg-neon/20 font-bold"
            >
              <UserPlus className="size-4" />
              {t("members.inviteGuestBtn")}
            </Button>
          )}
          {!archived && hasPermission("members.edit") && (
            <Button variant="secondary" onClick={onEdit}>
              <Pencil className="size-4" />
              {t("common.edit")}
            </Button>
          )}
          {hasPermission("members.change_status") && (
            <Button variant={archived ? "primary" : "secondary"} onClick={() => setArchiveOpen(true)}>
              {archived ? <Undo2 className="size-4" /> : <Archive className="size-4" />}
              {archived ? t("members.restoreMember") : t("members.archiveMember")}
            </Button>
          )}
          {!archived && hasPermission("members.delete") && (
            <Button variant="danger" onClick={() => setTrashOpen(true)}>
              <Trash2 className="size-4" />
              {t("members.trashAction")}
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={archived ? t("members.restoreMember") : t("members.archiveMember")}
        message={archived ? t("members.activateMember") : t("members.archiveConfirmMsg")}
        tone={archived ? "primary" : undefined}
        loading={busy}
        onConfirm={onArchive}
      />
      <ConfirmDialog
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        title={t("members.trashAction")}
        message={t("members.trashConfirmMsg")}
        tone="danger"
        loading={busy}
        onConfirm={onTrash}
      />
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={onCameraCapture}
        captureBusy={photoBusy}
      />
      <QuickWhatsAppModal
        open={whatsAppOpen}
        onClose={() => setWhatsAppOpen(false)}
        memberId={member.id}
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
