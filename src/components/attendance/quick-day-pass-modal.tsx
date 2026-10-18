import { useState, useEffect, type FormEvent } from "react";
import { Zap, Ticket, UserRound, AlertCircle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { describeError } from "@/utils/app-error";
import { api, type PublicMember, type MemberInvitationsSummary } from "@/api";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

interface QuickDayPassModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function QuickDayPassModal({ open, onClose, onSaved }: QuickDayPassModalProps) {
  const t = useT();
  const { toast } = useToast();

  const [entryType, setEntryType] = useState<"paid" | "invitation">("paid");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestGender, setGuestGender] = useState<"male" | "female">("male");
  const [priceMajor, setPriceMajor] = useState("50");
  const [paidMajor, setPaidMajor] = useState("50");
  const [methodCode, setMethodCode] = useState("cash");
  const [notes, setNotes] = useState("");
  const [autoCreateLead, setAutoCreateLead] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Host member state for invitation passes
  const [selectedHostMember, setSelectedHostMember] = useState<PublicMember | null>(null);
  const [hostPickerOpen, setHostPickerOpen] = useState(false);
  const [invSummary, setInvSummary] = useState<MemberInvitationsSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Reset or initialize when modal opens/closes
  useEffect(() => {
    if (!open) {
      setGuestName("");
      setGuestPhone("");
      setNotes("");
      setSelectedHostMember(null);
      setInvSummary(null);
      setEntryType("paid");
      setPriceMajor("50");
      setPaidMajor("50");
      setAutoCreateLead(true);
    }
  }, [open]);

  // When host member is chosen, load their invitations summary
  useEffect(() => {
    if (!selectedHostMember) {
      setInvSummary(null);
      return;
    }
    let active = true;
    setLoadingSummary(true);
    api.invitations
      .getSummary(selectedHostMember.id)
      .then((res) => {
        if (!active) return;
        setInvSummary(res);
      })
      .catch((err) => {
        if (!active) return;
        console.error("Failed to load invitations summary:", err);
        setInvSummary(null);
      })
      .finally(() => {
        if (active) setLoadingSummary(false);
      });

    return () => {
      active = false;
    };
  }, [selectedHostMember]);

  const handleEntryTypeChange = (type: "paid" | "invitation") => {
    setEntryType(type);
    if (type === "invitation") {
      setPriceMajor("0");
      setPaidMajor("0");
    } else {
      setPriceMajor("50");
      setPaidMajor("50");
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (entryType === "invitation") {
      if (!selectedHostMember) {
        toast("error", "يرجى تحديد المشترك المضيف صاحب الدعوة");
        return;
      }
      if (!invSummary || invSummary.invitationsRemaining <= 0) {
        toast("error", "المشترك المختار لا يمتلك دعوات متبقية في اشتراكه الحالي");
        return;
      }
    }

    setSubmitting(true);
    try {
      const isInvitation = entryType === "invitation";
      const priceMinor = isInvitation ? 0 : Math.round(parseFloat(priceMajor || "0") * 100);
      const paidMinor = isInvitation ? 0 : Math.round(parseFloat(paidMajor || "0") * 100);

      const sessionName = isInvitation
        ? `تذكرة تمرين بدعوة من المشترك (${selectedHostMember?.fullName})`
        : "تذكرة تمرين يوم واحد (Day Pass)";

      await api.quickSessions.create({
        clientType: "guest",
        guestName: guestName.trim() || (isInvitation ? "ضيف مشترك (دعوة)" : "زائر صالة (Day Pass)"),
        guestPhone: guestPhone.trim() || undefined,
        guestGender,
        sessionName,
        priceMinor,
        paidAmountMinor: paidMinor,
        methodCode: isInvitation ? "cash" : methodCode,
        recordAttendance: true,
        notes: notes.trim() || undefined,
        autoCreateLead,
        invitationMemberId: isInvitation ? selectedHostMember?.id : undefined,
      });

      if (isInvitation) {
        toast(
          "success",
          `تم تسجيل دخول الضيف بدعوة من المشترك (${selectedHostMember?.fullName}) وخصم 1 دعوة بنجاح 🎟️`,
        );
      } else {
        toast(
          "success",
          autoCreateLead
            ? "تم قطع تذكرة اليوم الواحد، تسجيل الدخول، وإضافة العميل إلى الـ CRM بنجاح ⚡"
            : "تم قطع تذكرة اليوم الواحد وتسجيل الدخول بنجاح ⚡",
        );
      }

      onSaved();
      onClose();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const hasRemainingInvitations = (invSummary?.invitationsRemaining ?? 0) > 0;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="دخول زائر / تذكرة يومية (Day Pass)"
        widthClass="max-w-lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4 text-start">
          {/* Entry Type Selector Tabs */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-white/[0.04] rounded-xl border border-white/[0.08]">
            <button
              type="button"
              onClick={() => handleEntryTypeChange("paid")}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                entryType === "paid"
                  ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                  : "text-subtle hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Zap className="size-3.5" />
              <span>تذكرة مدفوعة (كاش / فيزا)</span>
            </button>
            <button
              type="button"
              onClick={() => handleEntryTypeChange("invitation")}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                entryType === "invitation"
                  ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
                  : "text-subtle hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Ticket className="size-3.5" />
              <span>دعوة ضيف من مشترك 🎟️</span>
            </button>
          </div>

          {/* Banner according to type */}
          {entryType === "paid" ? (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-200">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-300">
                <Zap className="size-5" />
              </div>
              <div className="text-xs">
                <p className="font-bold text-amber-100 text-sm">تسجيل دخول زائر مدفوع ليوم واحد وإضافته للـ CRM</p>
                <p className="text-amber-300/80">
                  سيتم تحصيل الرسوم للخزينة، تسجيل دخول المتمرن بالصالة، وحفظ بياناته كعميل محتمل للتواصل معه لاحقاً.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-emerald-200">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/20 text-emerald-300">
                <Ticket className="size-5" />
              </div>
              <div className="text-xs">
                <p className="font-bold text-emerald-100 text-sm">تسجيل دخول ضيف مجاناً بخصم دعوة من رصيد المشترك</p>
                <p className="text-emerald-300/80">
                  سيتم خصم 1 دعوة من رصيد اشتراك المشترك المضيف، تسجيل دخول الضيف، وإضافته في الـ CRM لمتابعته كعميل محتمل!
                </p>
              </div>
            </div>
          )}

          {/* Invitation Host Member Selector */}
          {entryType === "invitation" && (
            <div className="space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                  <UserRound className="size-3.5" />
                  <span>المشترك المضيف (صاحب الدعوة) *</span>
                </label>
                {selectedHostMember && (
                  <button
                    type="button"
                    onClick={() => setHostPickerOpen(true)}
                    className="text-[11px] text-emerald-400 hover:underline"
                  >
                    تغيير المشترك
                  </button>
                )}
              </div>

              {!selectedHostMember ? (
                <button
                  type="button"
                  onClick={() => setHostPickerOpen(true)}
                  className="flex h-11 w-full items-center justify-between rounded-xl border border-line bg-panel px-3.5 text-start text-sm transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/5"
                >
                  <span className="text-subtle text-xs">اضغط هنا للبحث عن المشترك واختياره...</span>
                  <UserRound className="size-4 text-emerald-400" />
                </button>
              ) : (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-white text-sm">{selectedHostMember.fullName}</p>
                      <p className="text-xs text-subtle" dir="ltr">
                        {selectedHostMember.memberCode} {selectedHostMember.phone ? `· ${selectedHostMember.phone}` : ""}
                      </p>
                    </div>
                    {loadingSummary ? (
                      <span className="text-xs text-subtle animate-pulse">جاري فحص الرصيد...</span>
                    ) : invSummary ? (
                      <div
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                          hasRemainingInvitations
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-red-500/20 text-red-300 border border-red-500/30"
                        }`}
                      >
                        {hasRemainingInvitations ? (
                          <>
                            <CheckCircle2 className="size-3.5" />
                            <span>متبقي {invSummary.invitationsRemaining} من {invSummary.invitationsTotal} دعوة</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="size-3.5" />
                            <span>لا يوجد دعوات متبقية!</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        <AlertCircle className="size-3.5" />
                        <span>لا يوجد اشتراك نشط أو دعوات</span>
                      </div>
                    )}
                  </div>

                  {!loadingSummary && invSummary && !hasRemainingInvitations && (
                    <p className="text-[11px] text-red-400 font-medium">
                      ⚠️ استنفذ هذا المشترك جميع الدعوات المتاحة في اشتراكه ({invSummary.invitationsUsed} / {invSummary.invitationsTotal}). لا يمكن استخدام دعوة من حسابه.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Guest Details */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="اسم الزائر / الضيف *"
              placeholder={entryType === "invitation" ? "اسم الصديق / الضيف" : "مثال: أحمد محمد (للتسجيل والمتابعة)"}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              required
            />
            <Input
              label="رقم الهاتف / الواتساب"
              placeholder="010xxxxxxxx (للتواصل في CRM)"
              dir="ltr"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
            />
          </div>

          {/* Auto CRM Toggle */}
          <div className="flex items-center gap-2.5 rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5 text-xs text-sky-200">
            <input
              type="checkbox"
              id="dayPassCrmLead"
              checked={autoCreateLead}
              onChange={(e) => setAutoCreateLead(e.target.checked)}
              className="size-4 rounded border-sky-400/40 bg-black/40 text-sky-500 focus:ring-sky-500 cursor-pointer"
            />
            <label htmlFor="dayPassCrmLead" className="cursor-pointer font-medium leading-relaxed">
              إضافة الزائر تلقائياً كـ عميل محتمل (Lead) في شاشة الـ CRM للمتابعة وتقديم عروض الباقات لاحقاً 🎯
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="النوع"
              value={guestGender}
              onChange={(e) => setGuestGender(e.target.value as "male" | "female")}
              options={[
                { value: "male", label: "ذكر (شباب)" },
                { value: "female", label: "أنثى (سيدات)" },
              ]}
            />
            {entryType === "paid" ? (
              <Select
                label="طريقة الدفع"
                value={methodCode}
                onChange={(e) => setMethodCode(e.target.value)}
                options={[
                  { value: "cash", label: "نقداً (درج الخزينة)" },
                  { value: "visa", label: "فيزا / بطاقة بنكية" },
                  { value: "vodafone", label: "فودافون كاش / محفظة" },
                  { value: "instapay", label: "انستاباي (InstaPay)" },
                ]}
              />
            ) : (
              <div className="flex flex-col justify-center px-3 py-2 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                <span className="text-[11px] text-subtle font-medium">نوع المعاملة</span>
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 mt-0.5">
                  <Ticket className="size-3.5" />
                  دعوة ضيف مجانية (0 ج.م)
                </span>
              </div>
            )}
          </div>

          {/* Pricing (Only for Paid mode) */}
          {entryType === "paid" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 bg-white/[0.02] p-3 rounded-xl border border-white/[0.06]">
              <Input
                label="سعر التذكرة (ج.م)"
                type="number"
                min="0"
                step="1"
                value={priceMajor}
                onChange={(e) => {
                  setPriceMajor(e.target.value);
                  setPaidMajor(e.target.value);
                }}
                required
              />
              <Input
                label="المبلغ المدفوع الآن (ج.م)"
                type="number"
                min="0"
                step="1"
                value={paidMajor}
                onChange={(e) => setPaidMajor(e.target.value)}
                required
              />
            </div>
          ) : (
            <div className="flex items-center justify-between bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-xs text-emerald-300">
              <span>المبلغ المستحق على الضيف:</span>
              <span className="font-bold text-sm text-emerald-400">0 ج.م (دعوة مدفوعة التكاليف ضمن اشتراك المضيف)</span>
            </div>
          )}

          <Input
            label="ملاحظات (اختياري)"
            placeholder="أي تفاصيل إضافية..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.08]">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              className={
                entryType === "invitation"
                  ? "bg-emerald-500 hover:bg-emerald-400 text-black font-bold gap-2 shadow-lg shadow-emerald-500/20"
                  : "bg-amber-500 hover:bg-amber-400 text-black font-bold gap-2 shadow-lg shadow-amber-500/20"
              }
              loading={submitting}
              disabled={submitting || (entryType === "invitation" && (!selectedHostMember || !hasRemainingInvitations))}
            >
              {entryType === "invitation" ? (
                <>
                  <Ticket className="size-4" />
                  <span>تأكيد الدعوة وتسجيل الدخول 🎟️</span>
                </>
              ) : (
                <>
                  <Zap className="size-4" />
                  <span>تأكيد وتسجيل الدخول ⚡</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Member Picker Modal */}
      <MemberPickerModal
        open={hostPickerOpen}
        onClose={() => setHostPickerOpen(false)}
        onSelect={(member) => {
          setSelectedHostMember(member);
          setHostPickerOpen(false);
        }}
      />
    </>
  );
}
