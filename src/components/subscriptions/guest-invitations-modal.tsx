import { useEffect, useState } from "react";
import { UserPlus, Ticket, Users } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type MemberInvitationsSummary } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDateShort } from "@/services/format";

interface GuestInvitationsModalProps {
  open: boolean;
  onClose: () => void;
  memberId: string;
  memberName: string;
  subscriptionId?: string;
}

export function GuestInvitationsModal({
  open,
  onClose,
  memberId,
  memberName,
  subscriptionId,
}: GuestInvitationsModalProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [summary, setSummary] = useState<MemberInvitationsSummary | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadSummary = async () => {
    if (!memberId) return;
    try {
      const res = await api.invitations.getSummary(memberId);
      setSummary(res);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (open && memberId) {
      void loadSummary();
      setGuestName("");
      setGuestPhone("");
      setNotes("");
    }
  }, [open, memberId]);

  const onUseInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetSubId = subscriptionId || summary?.subscriptionId;
    if (!targetSubId) {
      toast("error", t("errors.subscriptionNotActive"));
      return;
    }
    if (!guestName.trim()) {
      toast("error", t("errors.guestNameRequired"));
      return;
    }

    setSubmitting(true);
    try {
      await api.invitations.use({
        subscriptionId: targetSubId,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || null,
        notes: notes.trim() || null,
      });
      toast("success", "تم تسجيل حضور دعوة الضيف بنجاح وإضافته للعملاء المحتملين");
      setGuestName("");
      setGuestPhone("");
      setNotes("");
      void loadSummary();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`دعوات الضيوف — ${memberName}`}
    >
      <div className="space-y-6">
        {/* Summary Card */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-line bg-panel p-4 text-center">
            <span className="text-xs text-subtle block mb-1">إجمالي الدعوات</span>
            <span className="text-2xl font-black text-foreground">
              {summary?.invitationsTotal ?? 0}
            </span>
          </div>
          <div className="rounded-xl border border-line bg-panel p-4 text-center">
            <span className="text-xs text-subtle block mb-1">المستخدمة</span>
            <span className="text-2xl font-black text-amber">
              {summary?.invitationsUsed ?? 0}
            </span>
          </div>
          <div className="rounded-xl border border-line bg-panel p-4 text-center">
            <span className="text-xs text-subtle block mb-1">المتبقية</span>
            <span className="text-2xl font-black text-emerald">
              {summary?.invitationsRemaining ?? 0}
            </span>
          </div>
        </div>

        {/* Use Invitation Form */}
        {hasPermission("invitations.manage") && (
          <form onSubmit={onUseInvitation} className="space-y-4 rounded-xl border border-line/60 bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <UserPlus className="size-4 text-neon" />
              <span>تسجيل زيارة ضيف جديد</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-subtle block mb-1">اسم الضيف *</label>
                <Input
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="مثال: أحمد محمود"
                  disabled={submitting || (summary?.invitationsRemaining ?? 0) <= 0}
                  required
                />
              </div>
              <div>
                <label className="text-xs text-subtle block mb-1">هاتف الضيف (لإضافته في الـ CRM)</label>
                <Input
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="01xxxxxxxxx"
                  dir="ltr"
                  disabled={submitting || (summary?.invitationsRemaining ?? 0) <= 0}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-subtle block mb-1">ملاحظات (اختياري)</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات حول الزيارة..."
                disabled={submitting || (summary?.invitationsRemaining ?? 0) <= 0}
              />
            </div>

            <div className="flex items-center justify-end">
              <Button
                type="submit"
                disabled={submitting || (summary?.invitationsRemaining ?? 0) <= 0}
              >
                <Ticket className="size-4" />
                <span>استهلاك دعوة وتسجيل الدخول</span>
              </Button>
            </div>
          </form>
        )}

        {/* Invitation Usage History */}
        <div>
          <div className="flex items-center gap-2 mb-3 text-sm font-bold text-foreground">
            <Users className="size-4 text-subtle" />
            <span>سجل الضيوف السابقين</span>
          </div>

          {summary?.history && summary.history.length > 0 ? (
            <div className="divide-y divide-line/60 border border-line rounded-xl overflow-hidden bg-panel">
              {summary.history.map((inv) => (
                <div key={inv.id} className="p-3.5 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-bold text-foreground">{inv.guestName}</div>
                    <div className="text-xs text-subtle flex items-center gap-2 mt-0.5">
                      {inv.guestPhone && <span dir="ltr">{inv.guestPhone}</span>}
                      {inv.notes && <span>• {inv.notes}</span>}
                      {inv.createdByName && <span>• بواسطة: {inv.createdByName}</span>}
                    </div>
                  </div>
                  <div className="text-end">
                    <Badge variant="success">تمت الزيارة</Badge>
                    <div className="text-[11px] text-faint mt-1" dir="ltr">
                      {formatDateShort(new Date(inv.createdAt))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-sm text-subtle border border-line/40 rounded-xl">
              لا توجد دعوات مستخدمة سابقة لهذا العضو
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
