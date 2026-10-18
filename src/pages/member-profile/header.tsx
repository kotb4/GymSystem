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
  Globe,
  Phone,
  Mail,
  Calendar,
  Layers,
  MapPin,
  Ruler,
  Weight,
  UserCheck,
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
import { MemberPortalLinkModal } from "@/components/members/member-portal-link-modal";

interface MemberHeaderProps {
  member: PublicMember;
  onReload: () => void;
  onEdit: () => void;
  onNewSubscription?: () => void;
  onRecordPayment?: () => void;
  onInviteGuest?: () => void;
}

function AttributeChip({
  icon,
  label,
  value,
  ltr,
  className,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | React.ReactNode;
  ltr?: boolean;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-line bg-surface/50 p-2.5 flex flex-col justify-between min-w-0 transition-colors hover:border-line-strong ${className ?? ""}`}>
      <div className="flex items-center gap-1.5 text-faint mb-1">
        {icon && <span className="shrink-0 size-3.5 text-faint flex items-center justify-center">{icon}</span>}
        <span className="text-[11px] font-semibold text-subtle truncate">{label}</span>
      </div>
      <div
        dir={ltr ? "ltr" : undefined}
        title={typeof value === "string" ? value : undefined}
        className="text-xs font-bold text-ink truncate tabnum"
      >
        {value}
      </div>
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
  const [portalModalOpen, setPortalModalOpen] = useState(false);
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
    <Card className="overflow-hidden">
      {/* 1. Hero / Main Info & Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 bg-panel/40 border-b border-line">
        {/* Right side (RTL): Avatar + Member Header Essentials */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative shrink-0">
            {member.photoFileId ? (
              <img
                src={api.files.url(member.photoFileId)}
                alt={member.fullName}
                className="size-20 rounded-2xl object-cover border border-line shadow-card"
              />
            ) : (
              <Avatar name={member.fullName} size="lg" className="size-20 text-2xl font-black rounded-2xl border border-line shadow-card" />
            )}
            {hasPermission("members.edit") && (
              <div className="absolute -bottom-1.5 -left-1.5 flex gap-1">
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={() => setCameraOpen(true)}
                  className="grid size-7 place-items-center rounded-lg border border-line bg-raised text-subtle transition-colors hover:text-ink hover:border-primary disabled:opacity-50 shadow-sm"
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
                  className="grid size-7 place-items-center rounded-lg border border-line bg-raised text-subtle transition-colors hover:text-ink hover:border-primary disabled:opacity-50 shadow-sm"
                  title={t("members.formPhoto")}
                >
                  <ImageIcon className="size-3.5" />
                </button>
                {member.photoFileId && (
                  <button
                    type="button"
                    disabled={photoBusy}
                    onClick={onPhotoRemove}
                    className="grid size-7 place-items-center rounded-lg border border-line bg-raised text-subtle transition-colors hover:text-red hover:border-red/40 disabled:opacity-50 shadow-sm"
                    title={t("common.delete")}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black text-white tracking-tight">{member.fullName}</h1>
              <Badge variant={statusMeta.variant} dot>
                {statusMeta.label}
              </Badge>
              <BranchBadge branchId={member.branchId} />
              {member.homeBranchOnly && (
                <Badge variant="warning">
                  {t("members.homeBranchOnly")}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span dir="ltr" className="font-mono font-bold text-[#00D2FF] bg-[#0055FF]/10 border border-[#0055FF]/30 px-2.5 py-0.5 rounded-lg">
                {member.memberCode}
              </span>

              {member.phone && (
                <div className="inline-flex items-center gap-1.5 bg-surface px-2.5 py-0.5 rounded-lg border border-line text-subtle font-mono font-bold" dir="ltr">
                  <span>{member.phone}</span>
                  <button
                    type="button"
                    onClick={() => setWhatsAppOpen(true)}
                    className="size-5 rounded flex items-center justify-center bg-[#0055FF]/10 text-[#0055FF] hover:bg-[#0055FF]/25 transition"
                    title={t("messages.quickWhatsAppTitle")}
                  >
                    <MessageSquare className="size-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Left side (RTL): Actions Toolbar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link
            to="/members"
            className="grid size-9 place-items-center rounded-xl border border-line text-subtle transition-colors hover:border-line-strong hover:text-ink bg-surface"
            aria-label={t("nav.members")}
            title={t("nav.members")}
          >
            <ArrowRight className="size-4" />
          </Link>

          {!archived && isFeatureEnabled("featureSubscriptionsEnabled") && hasPermission("subscriptions.create") && onNewSubscription && (
            <Button variant="primary" onClick={onNewSubscription} className="shadow-glow-sm">
              <Plus className="size-4" />
              <span>{t("subs.addSubscription")}</span>
            </Button>
          )}

          {!archived && isFeatureEnabled("featureTreasuryEnabled") && hasPermission("payments.create") && onRecordPayment && (
            <Button variant="secondary" onClick={onRecordPayment}>
              <Banknote className="size-4" />
              <span>{t("pay.addPayment")}</span>
            </Button>
          )}

          {!archived && (
            <Button
              variant="secondary"
              onClick={() => setPortalModalOpen(true)}
              className="border-[#0055FF]/35 text-[#0055FF] bg-[#0055FF]/10 hover:bg-[#0055FF]/20 font-bold"
              title="عرض كود الـ QR ورابط بروفايل العميل وإرساله عبر الواتساب"
            >
              <Globe className="size-4" />
              <span>رابط العضو</span>
            </Button>
          )}

          {!archived && hasPermission("members.edit") && (
            <Button variant="secondary" onClick={onEdit}>
              <Pencil className="size-4" />
              <span>{t("common.edit")}</span>
            </Button>
          )}

          {!archived && isFeatureEnabled("featureSubscriptionsEnabled") && hasPermission("invitations.manage") && onInviteGuest && (
            <Button
              variant="secondary"
              onClick={onInviteGuest}
              className="border-neon/40 bg-neon/10 text-neon hover:bg-neon/20 font-bold"
            >
              <UserPlus className="size-4" />
              <span>{t("members.inviteGuestBtn")}</span>
            </Button>
          )}

          {hasPermission("members.change_status") && (
            <Button variant={archived ? "primary" : "secondary"} onClick={() => setArchiveOpen(true)}>
              {archived ? <Undo2 className="size-4" /> : <Archive className="size-4" />}
              <span>{archived ? t("members.restoreMember") : t("members.archiveMember")}</span>
            </Button>
          )}

          {!archived && hasPermission("members.delete") && (
            <Button variant="danger" onClick={() => setTrashOpen(true)}>
              <Trash2 className="size-4" />
              <span>{t("members.trashAction")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* 2. Full-Width Attributes Grid */}
      <div className="p-5 space-y-3">
        <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          <AttributeChip icon={<Mail className="size-3.5" />} label={t("common.email")} value={member.email ?? "—"} ltr />
          <AttributeChip
            icon={<UserCheck className="size-3.5" />}
            label={t("members.gender")}
            value={member.gender ? t(`members.${member.gender}`) : "—"}
          />
          <AttributeChip
            icon={<Calendar className="size-3.5" />}
            label={t("members.dob")}
            value={member.dateOfBirth ? formatDate(parseDateKey(member.dateOfBirth)) : "—"}
          />
          <AttributeChip
            icon={<Calendar className="size-3.5" />}
            label={t("members.registeredAt")}
            value={member.registrationDate ? formatDate(parseDateKey(member.registrationDate)) : "—"}
          />
          <AttributeChip
            icon={<Layers className="size-3.5" />}
            label={t("members.department")}
            value={
              member.department === "men"
                ? t("members.deptMen")
                : member.department === "women"
                  ? t("members.deptWomen")
                  : t("members.deptGeneral")
            }
          />
          <AttributeChip icon={<MapPin className="size-3.5" />} label={t("members.address")} value={member.address ?? "—"} />
          <AttributeChip
            icon={<Ruler className="size-3.5" />}
            label={t("members.formHeight")}
            value={member.heightCm == null ? "—" : `${member.heightCm} سم`}
            ltr
          />
          <AttributeChip
            icon={<Weight className="size-3.5" />}
            label={t("members.formWeight")}
            value={member.weightKg == null ? "—" : `${member.weightKg} كجم`}
            ltr
          />
          <AttributeChip
            icon={<UserCheck className="size-3.5" />}
            label={t("members.formEmergencyName")}
            value={member.emergencyContactName ?? "—"}
          />
          <AttributeChip
            icon={<Phone className="size-3.5" />}
            label={t("members.formEmergencyPhone")}
            value={member.emergencyContactPhone ?? "—"}
            ltr
          />
        </dl>

        {member.notes && member.notes.trim() !== "" && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-xs text-amber">
            <span className="font-bold shrink-0">{t("members.notes")}:</span>
            <p className="whitespace-pre-line leading-relaxed font-medium text-amber-200">{member.notes}</p>
          </div>
        )}
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
      <MemberPortalLinkModal
        open={portalModalOpen}
        onClose={() => setPortalModalOpen(false)}
        member={member}
      />
    </Card>
  );
}

export default MemberHeader;
