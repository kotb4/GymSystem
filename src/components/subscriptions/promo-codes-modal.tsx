import { useEffect, useState } from "react";
import { Tag, Plus, Copy } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PromoCode } from "@/api";
import type { DiscountType } from "@/core/services/promo.service";
import { formatMinor, toMinor } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";

interface PromoCodesModalProps {
  open: boolean;
  onClose: () => void;
}

export function PromoCodesModal({ open, onClose }: PromoCodesModalProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [minSpendMajor, setMinSpendMajor] = useState("0");
  const [maxUses, setMaxUses] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [notes, setNotes] = useState("");

  const loadCodes = async () => {
    try {
      const res = await api.promo.list();
      setCodes(res);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (open) {
      void loadCodes();
      setShowCreate(false);
    }
  }, [open]);

  const onCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      toast("error", t("errors.promoCodeRequired"));
      return;
    }
    const val = Number(discountValue);
    if (!val || val <= 0) {
      toast("error", t("errors.discountValueInvalid"));
      return;
    }
    if (discountType === "percentage" && val > 100) {
      toast("error", t("errors.discountPercentageTooHigh"));
      return;
    }

    setSubmitting(true);
    try {
      // For fixed discount, store in minor units (piastres)
      const finalDiscountValue = discountType === "fixed" ? toMinor(discountValue) : val;

      await api.promo.create({
        code: code.trim().toUpperCase(),
        discountType,
        discountValue: finalDiscountValue,
        minSpendMinor: toMinor(minSpendMajor || "0"),
        maxUses: maxUses.trim() ? Number(maxUses) : null,
        validFrom: validFrom.trim() || null,
        validTo: validTo.trim() || null,
        notes: notes.trim() || null,
      });

      toast("success", "تم إنشاء كود الخصم بنجاح");
      setShowCreate(false);
      setCode("");
      setDiscountValue("");
      setMinSpendMajor("0");
      setMaxUses("");
      setValidFrom("");
      setValidTo("");
      setNotes("");
      void loadCodes();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const onToggle = async (promoId: string, currentActive: boolean) => {
    try {
      await api.promo.toggle(promoId, !currentActive);
      toast("success", !currentActive ? "تم تفعيل الكود بنجاح" : "تم تعطيل الكود بنجاح");
      void loadCodes();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const copyCode = (c: string) => {
    void navigator.clipboard.writeText(c);
    toast("success", `تم نسخ الكود: ${c}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="أكواد الخصم والعروض الترويجية (Promo Codes)"
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-subtle">
            إدارة كوبونات التخفيض، الحملات الترويجية، وتحديد سقف الاستخدام وتاريخ الصلاحية.
          </p>
          {hasPermission("promo.manage") && !showCreate && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4" />
              إنشاء كود خصم جديد
            </Button>
          )}
        </div>

        {/* Create Form */}
        {showCreate && (
          <form onSubmit={onCreateCode} className="rounded-2xl border border-neon/30 bg-muted/20 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                <Tag className="size-4 text-neon" />
                بيانات كود الخصم الجديد
              </h4>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                إلغاء
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-subtle block mb-1">رمز الكود (Code) *</label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="مثال: SUMMER2026"
                  dir="ltr"
                  disabled={submitting}
                  required
                />
              </div>

              <div>
                <label className="text-xs text-subtle block mb-1">نوع الخصم *</label>
                <Select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                  options={[
                    { value: "percentage", label: "نسبة مئوية (%)" },
                    { value: "fixed", label: "مبلغ ثابت (ج.م)" },
                  ]}
                />
              </div>

              <div>
                <label className="text-xs text-subtle block mb-1">
                  قيمة الخصم ({discountType === "percentage" ? "%" : "ج.م"}) *
                </label>
                <Input
                  type="number"
                  min={1}
                  step={discountType === "percentage" ? "1" : "0.01"}
                  max={discountType === "percentage" ? 100 : undefined}
                  dir="ltr"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === "percentage" ? "مثال: 15" : "مثال: 50"}
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-subtle block mb-1">الحد الأدنى للفاتورة (ج.م)</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={minSpendMajor}
                  onChange={(e) => setMinSpendMajor(e.target.value)}
                  placeholder="0.00"
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="text-xs text-subtle block mb-1">أقصى عدد مرات استخدام</label>
                <Input
                  type="number"
                  min={1}
                  dir="ltr"
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="غير محدود"
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="text-xs text-subtle block mb-1">ملاحظات الكود</label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="وصف الحملة أو العرض..."
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-subtle block mb-1">صالح من تاريخ (اختياري)</label>
                <Input
                  type="date"
                  dir="ltr"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="text-xs text-subtle block mb-1">صالح حتى تاريخ (اختياري)</label>
                <Input
                  type="date"
                  dir="ltr"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="submit" loading={submitting} disabled={submitting}>
                حفظ وتفعيل الكود
              </Button>
            </div>
          </form>
        )}

        {/* List Table */}
        <div className="rounded-xl border border-line overflow-hidden bg-panel">
          {codes.length > 0 ? (
            <div className="divide-y divide-line/60">
              {codes.map((item) => (
                <div key={item.id} className="p-4 flex items-center justify-between text-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-black text-neon text-base" dir="ltr">
                        {item.code}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyCode(item.code)}
                        className="text-faint hover:text-subtle"
                        title="نسخ الكود"
                      >
                        <Copy className="size-3.5" />
                      </button>
                      <Badge variant={item.isActive ? "success" : "neutral"}>
                        {item.isActive ? "نشط" : "معطل"}
                      </Badge>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-white/5 border border-line">
                        {item.discountType === "percentage"
                          ? `خصم ${item.discountValue}%`
                          : `خصم ${formatMinor(item.discountValue)}`}
                      </span>
                    </div>

                    <div className="text-xs text-subtle flex flex-wrap items-center gap-3">
                      <span>الاستخدام: {item.timesUsed} {item.maxUses ? `/ ${item.maxUses}` : "مرة"}</span>
                      {item.minSpendMinor > 0 && (
                        <span>• الحد الأدنى: {formatMinor(item.minSpendMinor)}</span>
                      )}
                      {(item.validFrom || item.validTo) && (
                        <span>• الصلاحية: {item.validFrom ?? "الآن"} إلى {item.validTo ?? "دائم"}</span>
                      )}
                      {item.notes && <span>• {item.notes}</span>}
                    </div>
                  </div>

                  {hasPermission("promo.manage") && (
                    <Button
                      size="sm"
                      variant={item.isActive ? "ghost" : "secondary"}
                      onClick={() => void onToggle(item.id, item.isActive)}
                    >
                      {item.isActive ? "تعطيل" : "تفعيل"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-subtle">
              لا توجد أكواد خصم مسجلة حتى الآن
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
