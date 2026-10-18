import { useEffect, useState } from "react";
import { Scale, Search, CheckCircle, Banknote, ShoppingBag, Dumbbell, Calendar, User, Phone } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type UnifiedDebtItem } from "@/api";
import { formatMinor } from "@/core/money";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";

export function DebtsPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [debtType, setDebtType] = useState<string>("all");
  const [items, setItems] = useState<UnifiedDebtItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalDebtMinor, setTotalDebtMinor] = useState(0);
  const [loading, setLoading] = useState(false);

  // Pay modal
  const [payTarget, setPayTarget] = useState<UnifiedDebtItem | null>(null);
  const [payAmountMajor, setPayAmountMajor] = useState("");
  const [methodCode, setMethodCode] = useState("cash");
  const [notes, setNotes] = useState("");
  const [paying, setPaying] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.debts.list({
        debtType: debtType !== "all" ? debtType : undefined,
        search: search.trim() || undefined,
        limit: 100,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalDebtMinor(res.totalDebtMinor);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [debtType, search]);

  const handleOpenPay = (item: UnifiedDebtItem) => {
    setPayTarget(item);
    setPayAmountMajor((item.remainingAmountMinor / 100).toString());
    setMethodCode("cash");
    setNotes("");
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;

    const amountMinor = Math.round(parseFloat(payAmountMajor || "0") * 100);
    if (amountMinor <= 0) {
      toast("error", "يرجى إدخال مبلغ سداد صحيح");
      return;
    }
    if (amountMinor > payTarget.remainingAmountMinor) {
      toast("error", "مبلغ السداد أكبر من الدين المتبقي");
      return;
    }

    setPaying(true);
    try {
      await api.debts.pay({
        debtType: payTarget.debtType,
        debtId: payTarget.debtId,
        amountMinor,
        methodCode,
        notes: notes.trim() || undefined,
      });

      toast("success", "تم تسجيل سداد الدين بنجاح وتحديث الخزينة");
      setPayTarget(null);
      void loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPaying(false);
    }
  };

  const debtTypeBadge = (type: string) => {
    switch (type) {
      case "subscription":
        return (
          <Badge variant="info" className="gap-1">
            <Calendar className="size-3" /> اشتراك
          </Badge>
        );
      case "store":
        return (
          <Badge variant="warning" className="gap-1">
            <ShoppingBag className="size-3" /> متجر / كافيه
          </Badge>
        );
      case "private_training":
        return (
          <Badge variant="danger" className="gap-1">
            <Dumbbell className="size-3" /> برايفت (PT)
          </Badge>
        );
      default:
        return <Badge variant="neutral">{type}</Badge>;
    }
  };

  const columns: Column<UnifiedDebtItem>[] = [
    {
      key: "member",
      header: "العضو",
      render: (r) => (
        <div>
          <div className="font-medium text-main flex items-center gap-1">
            <User className="size-3.5 text-muted" />
            {r.memberName}
            <span className="text-xs text-muted font-mono">({r.memberCode})</span>
          </div>
          {r.memberPhone && (
            <div className="text-xs text-muted flex items-center gap-1 mt-0.5">
              <Phone className="size-3" />
              {r.memberPhone}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "type",
      header: "مصدر الدين",
      render: (r) => debtTypeBadge(r.debtType),
    },
    {
      key: "title",
      header: "تفاصيل المعاملة",
      render: (r) => <span className="text-sm text-main">{r.title}</span>,
    },
    {
      key: "total",
      header: "إجمالي المبلغ",
      render: (r) => <span className="font-mono text-xs">{formatMinor(r.totalAmountMinor)}</span>,
    },
    {
      key: "paid",
      header: "المدفوع",
      render: (r) => (
        <span className="font-mono text-xs text-emerald-400">
          {formatMinor(r.paidAmountMinor)}
        </span>
      ),
    },
    {
      key: "remaining",
      header: "المتبقي (الدين)",
      render: (r) => (
        <span className="font-semibold font-mono text-rose-400">
          {formatMinor(r.remainingAmountMinor)}
        </span>
      ),
    },
    {
      key: "date",
      header: "تاريخ الاستحقاق",
      render: (r) => (
        <span className="text-xs text-muted font-mono">
          {r.createdAt ? formatDateShort(new Date(r.createdAt.replace(" ", "T"))) : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "الإجراءات",
      render: (r) =>
        hasPermission("debts.manage") && (
          <Button
            size="sm"
            onClick={() => handleOpenPay(r)}
            className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold h-7 text-xs"
          >
            <Banknote className="size-3.5" />
            سداد
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={Scale}
        iconClassName="border-rose-500/25 bg-rose-500/10 text-rose-400 shadow-[0_0_18px_rgba(244,63,94,0.15)]"
        title="ديون ومستحقات الأعضاء المركزية"
        subtitle="متابعة شاملة لكافة المبالغ المتبقية والديون (اشتراكات متبقية، آجل المتجر، تدريب خاص PT) وسدادها بضغطة زر"
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="إجمالي الديون المستحقة"
          value={formatMinor(totalDebtMinor)}
          icon={<Scale className="size-5" />}
          accent="red"
          subtitle="مجموع كافة المديونيات غير المسددة"
        />
        <StatCard
          title="عدد المعاملات الآجلة"
          value={String(total)}
          icon={<Banknote className="size-5" />}
          accent="amber"
          subtitle="معاملات معلقة أو مسددة جزئياً"
        />
        <StatCard
          title="تصفية المديونيات"
          value="سداد فوري"
          icon={<CheckCircle className="size-5" />}
          accent="emerald"
          subtitle="إيداع مباشر في الخزينة والوردية الحالية"
        />
      </div>

      {/* Table Card */}
      <Card>
        <CardHeader
          title="سجل المديونيات المستحقة"
          description={`إجمالي ${total} مديونية`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={debtType}
                onChange={(e) => setDebtType(e.target.value)}
                options={[
                  { value: "all", label: "كل مصادر الديون" },
                  { value: "subscription", label: "اشتراكات العضويات" },
                  { value: "store", label: "مبيعات المتجر الآجلة" },
                  { value: "private_training", label: "التدريب الخاص (PT)" },
                ]}
                className="w-40 text-xs"
              />

              <div className="relative w-56">
                <Search className="size-4 absolute right-2.5 top-2.5 text-muted pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث باسم العضو أو الهاتف أو الكود..."
                  className="pr-8 text-xs"
                />
              </div>
            </div>
          }
        />

        {items.length === 0 && !loading ? (
          <div className="p-8">
            <EmptyState
              icon={<CheckCircle className="text-emerald-400" />}
              title="لا توجد ديون مستحقة"
              description="ممتاز! لا توجد أي مديونيات معلقة مسجلة على الأعضاء حالياً."
            />
          </div>
        ) : (
          <DataTable<UnifiedDebtItem>
            columns={columns}
            data={items}
            rowKey={(r) => `${r.debtType}-${r.debtId}`}
          />
        )}
      </Card>

      {/* Pay Debt Modal */}
      {payTarget && (
        <Modal
          open={!!payTarget}
          onClose={() => setPayTarget(null)}
          title="سداد مديونية العضو"
        >
          <form onSubmit={handlePaySubmit} className="space-y-4">
            <div className="p-3 bg-surface-2 rounded-lg border border-line space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted">العضو:</span>
                <span className="font-semibold text-main">
                  {payTarget.memberName} ({payTarget.memberCode})
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted">المعاملة:</span>
                <span className="text-main">{payTarget.title}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted">إجمالي المبلغ:</span>
                <span className="font-mono">{formatMinor(payTarget.totalAmountMinor)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted">المسدد سابقاً:</span>
                <span className="font-mono text-emerald-400">
                  {formatMinor(payTarget.paidAmountMinor)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm border-t border-line pt-2">
                <span className="font-medium text-main">المبلغ المتبقي للدفع:</span>
                <span className="font-bold font-mono text-rose-400 text-base">
                  {formatMinor(payTarget.remainingAmountMinor)}
                </span>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium text-muted">
                  مبلغ السداد المطلوب تحصيله (ج.م) *
                </label>
                <button
                  type="button"
                  onClick={() => setPayAmountMajor((payTarget.remainingAmountMinor / 100).toString())}
                  className="text-xs text-amber-400 hover:underline font-medium"
                >
                  سداد كامل المتبقي
                </button>
              </div>
              <Input
                type="number"
                min="0.5"
                step="0.5"
                max={payTarget.remainingAmountMinor / 100}
                value={payAmountMajor}
                onChange={(e) => setPayAmountMajor(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">
                طريقة الدفع *
              </label>
              <Select
                value={methodCode}
                onChange={(e) => setMethodCode(e.target.value)}
                options={[
                  { value: "cash", label: "نقدي (كاش - الخزينة)" },
                  { value: "instapay", label: "انستاباي (InstaPay)" },
                  { value: "wallet", label: "محفظة إلكترونية (فودافون كاش)" },
                  { value: "card", label: "فيزا / بطاقة بنكية" },
                ]}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">
                ملاحظات التحصيل
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات اختيارية عن القسط أو الإيصال..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-line">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPayTarget(null)}
                disabled={paying}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold"
                disabled={paying}
              >
                {paying ? "جارٍ تسجيل السداد..." : "تأكيد السداد والتحصيل"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
export default DebtsPage;
