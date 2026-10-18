import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Truck, Plus, Search, FileText, UserPlus, ShoppingCart, Banknote, Building2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type SupplierRow, type PurchaseInvoiceRow } from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";

export function PurchasesPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"invoices" | "suppliers">("invoices");

  // Invoices state
  const [invoices, setInvoices] = useState<PurchaseInvoiceRow[]>([]);
  const [invoicesTotal, setInvoicesTotal] = useState(0);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("all");
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Suppliers state
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);

  // Supplier modal
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierCompany, setSupplierCompany] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierNotes, setSupplierNotes] = useState("");
  const [savingSupplier, setSavingSupplier] = useState(false);

  // New Invoice modal
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayKey());
  const [invoiceItems, setInvoiceItems] = useState<Array<{ productId: string; quantity: number; unitCostMajor: string }>>([
    { productId: "", quantity: 1, unitCostMajor: "0" },
  ]);
  const [invoicePaidMajor, setInvoicePaidMajor] = useState("0");
  const [invoiceMethodCode, setInvoiceMethodCode] = useState("cash");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [storeProducts, setStoreProducts] = useState<Array<{ id: string; name: string; costMinor: number }>>([]);
  const [savingInvoice, setSavingInvoice] = useState(false);

  // Pay Invoice Debt modal
  const [payModalTarget, setPayModalTarget] = useState<PurchaseInvoiceRow | null>(null);
  const [payDebtMajor, setPayDebtMajor] = useState("");
  const [payMethodCode, setPayMethodCode] = useState("cash");
  const [payingDebt, setPayingDebt] = useState(false);

  const loadSuppliers = async () => {
    setLoadingSuppliers(true);
    try {
      const res = await api.purchases.listSuppliers({
        search: supplierSearch.trim() || undefined,
      });
      setSuppliers(res);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoadingSuppliers(false);
    }
  };

  const loadInvoices = async () => {
    setLoadingInvoices(true);
    try {
      const res = await api.purchases.listInvoices({
        status: invoiceStatus !== "all" ? invoiceStatus : undefined,
        search: invoiceSearch.trim() || undefined,
        limit: 100,
      });
      setInvoices(res.items);
      setInvoicesTotal(res.total);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoadingInvoices(false);
    }
  };

  const location = useLocation();
  const locState = location.state as { defaultProductId?: string; defaultProductName?: string; autoCreate?: boolean } | null;

  useEffect(() => {
    if (locState?.defaultProductId) {
      setActiveTab("invoices");
      void loadSuppliers();
      api.store.listProducts({ limit: 100 }).then((res) => {
        setStoreProducts(res.items.map((p) => ({ id: p.id, name: p.name, costMinor: p.costMinor })));
        const targetProd = res.items.find((p) => p.id === locState.defaultProductId);
        const unitCost = targetProd ? (targetProd.costMinor / 100).toString() : "0";
        setInvoiceItems([{ productId: locState.defaultProductId!, quantity: 10, unitCostMajor: unitCost }]);
        setInvoiceDate(todayKey());
        setInvoicePaidMajor("0");
        setInvoiceMethodCode("cash");
        setInvoiceNotes(`طلب توريد سريع للمنتج: ${locState.defaultProductName ?? targetProd?.name ?? ""}`);
        setInvoiceModalOpen(true);
      }).catch(console.error);
    }
  }, [locState]);

  useEffect(() => {
    if (activeTab === "invoices") {
      void loadInvoices();
    } else {
      void loadSuppliers();
    }
  }, [activeTab, invoiceStatus, invoiceSearch, supplierSearch]);

  const loadStoreProducts = async () => {
    try {
      const res = await api.store.listProducts({ limit: 100 });
      setStoreProducts(
        res.items.map((p) => ({
          id: p.id,
          name: p.name,
          costMinor: p.costMinor,
        })),
      );
    } catch {
      // ignore
    }
  };

  const handleOpenNewInvoice = () => {
    void loadSuppliers();
    void loadStoreProducts();
    setSelectedSupplierId("");
    setInvoiceNo("");
    setInvoiceDate(todayKey());
    setInvoiceItems([{ productId: "", quantity: 1, unitCostMajor: "0" }]);
    setInvoicePaidMajor("0");
    setInvoiceMethodCode("cash");
    setInvoiceNotes("");
    setInvoiceModalOpen(true);
  };

  const handleAddInvoiceItem = () => {
    setInvoiceItems([...invoiceItems, { productId: "", quantity: 1, unitCostMajor: "0" }]);
  };

  const handleRemoveInvoiceItem = (index: number) => {
    if (invoiceItems.length === 1) return;
    setInvoiceItems(invoiceItems.filter((_, idx) => idx !== index));
  };

  const handleProductSelect = (index: number, productId: string) => {
    const prod = storeProducts.find((p) => p.id === productId);
    const updated = [...invoiceItems];
    updated[index] = {
      ...updated[index],
      productId,
      unitCostMajor: prod ? (prod.costMinor / 100).toString() : "0",
    };
    setInvoiceItems(updated);
  };

  const calculateInvoiceTotalMinor = () => {
    return invoiceItems.reduce((acc, it) => {
      const qty = it.quantity || 0;
      const costMinor = Math.round(parseFloat(it.unitCostMajor || "0") * 100);
      return acc + qty * costMinor;
    }, 0);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSupplier(true);
    try {
      await api.purchases.createSupplier({
        name: supplierName.trim(),
        phone: supplierPhone.trim() || undefined,
        companyName: supplierCompany.trim() || undefined,
        address: supplierAddress.trim() || undefined,
        notes: supplierNotes.trim() || undefined,
      });
      toast("success", "تم إضافة المورد بنجاح");
      setSupplierModalOpen(false);
      setSupplierName("");
      setSupplierPhone("");
      setSupplierCompany("");
      setSupplierAddress("");
      setSupplierNotes("");
      void loadSuppliers();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleSaveInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId) {
      toast("error", "يرجى اختيار المورد أولاً");
      return;
    }

    const validItems = invoiceItems.filter((it) => it.productId);
    if (validItems.length === 0) {
      toast("error", "يجب إضافة صنف واحد على الأقل في الفاتورة");
      return;
    }

    setSavingInvoice(true);
    try {
      const paidAmountMinor = Math.round(parseFloat(invoicePaidMajor || "0") * 100);
      await api.purchases.createInvoice({
        supplierId: selectedSupplierId,
        invoiceNo: invoiceNo.trim() || undefined,
        invoiceDate,
        items: validItems.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          unitCostMinor: Math.round(parseFloat(it.unitCostMajor || "0") * 100),
        })),
        paidAmountMinor,
        methodCode: invoiceMethodCode,
        notes: invoiceNotes.trim() || undefined,
      });

      toast("success", "تم حفظ فاتورة المشتريات وإضافة الكميات للمخزون تلقائياً");
      setInvoiceModalOpen(false);
      void loadInvoices();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingInvoice(false);
    }
  };

  const handlePayDebtSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModalTarget) return;

    const amountMinor = Math.round(parseFloat(payDebtMajor || "0") * 100);
    setPayingDebt(true);
    try {
      await api.purchases.payInvoiceDebt({
        invoiceId: payModalTarget.id,
        amountMinor,
        methodCode: payMethodCode,
      });
      toast("success", "تم سداد مستحقات الفاتورة بنجاح وتحديث حساب المورد");
      setPayModalTarget(null);
      void loadInvoices();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPayingDebt(false);
    }
  };

  const invoiceStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <Badge variant="success">مدفوعة بالكامل</Badge>;
      case "partial":
        return <Badge variant="warning">مدفوعة جزئياً</Badge>;
      default:
        return <Badge variant="danger">غير مدفوعة (آجل)</Badge>;
    }
  };

  const invoiceColumns: Column<PurchaseInvoiceRow>[] = [
    {
      key: "no",
      header: "رقم الفاتورة",
      render: (r) => <span className="font-mono font-medium text-main">{r.invoice_no}</span>,
    },
    {
      key: "supplier",
      header: "المورد",
      render: (r) => <span className="font-medium text-main">{r.supplier_name || "—"}</span>,
    },
    {
      key: "date",
      header: "تاريخ الفاتورة",
      render: (r) => (
        <span className="text-xs text-muted font-mono">
          {formatDateShort(new Date(r.invoice_date.replace(" ", "T")))}
        </span>
      ),
    },
    {
      key: "total",
      header: "إجمالي الفاتورة",
      render: (r) => <span className="font-mono">{formatMinor(r.total_amount_minor)}</span>,
    },
    {
      key: "paid",
      header: "المدفوع",
      render: (r) => <span className="font-mono text-emerald-400">{formatMinor(r.paid_amount_minor)}</span>,
    },
    {
      key: "remaining",
      header: "المتبقي للمورد",
      render: (r) => (
        <span className={`font-mono ${r.remaining_amount_minor > 0 ? "text-rose-400 font-semibold" : "text-muted"}`}>
          {formatMinor(r.remaining_amount_minor)}
        </span>
      ),
    },
    {
      key: "status",
      header: "الحالة",
      render: (r) => invoiceStatusBadge(r.status),
    },
    {
      key: "actions",
      header: "الإجراءات",
      render: (r) =>
        r.remaining_amount_minor > 0 && hasPermission("purchases.manage") && (
          <Button
            size="sm"
            onClick={() => {
              setPayModalTarget(r);
              setPayDebtMajor((r.remaining_amount_minor / 100).toString());
              setPayMethodCode("cash");
            }}
            className="gap-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold h-7 text-xs"
          >
            <Banknote className="size-3.5" />
            سداد مستحقات
          </Button>
        ),
    },
  ];

  const supplierColumns: Column<SupplierRow>[] = [
    {
      key: "name",
      header: "المورد",
      render: (r) => (
        <div>
          <span className="font-medium text-main block">{r.name}</span>
          {r.company_name && <span className="text-xs text-muted">{r.company_name}</span>}
        </div>
      ),
    },
    {
      key: "phone",
      header: "الهاتف",
      render: (r) => <span className="text-xs font-mono text-muted">{r.phone || "—"}</span>,
    },
    {
      key: "invoicesCount",
      header: "عدد الفواتير",
      render: (r) => <span className="text-xs">{r.invoices_count || 0} فاتورة</span>,
    },
    {
      key: "totalPurchases",
      header: "إجمالي المشتريات",
      render: (r) => <span className="font-mono">{formatMinor(r.total_purchases_minor || 0)}</span>,
    },
    {
      key: "totalPaid",
      header: "المسدد",
      render: (r) => <span className="font-mono text-emerald-400">{formatMinor(r.total_paid_minor || 0)}</span>,
    },
    {
      key: "totalRemaining",
      header: "مستحقات المورد المتبقية",
      render: (r) => (
        <span className={`font-mono ${(r.total_remaining_minor || 0) > 0 ? "text-rose-400 font-semibold" : "text-muted"}`}>
          {formatMinor(r.total_remaining_minor || 0)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-main flex items-center gap-2">
            <Truck className="size-6 text-cyan-400" />
            فواتير الشراء وإدارة الموردين (Purchases & Suppliers)
          </h1>
          <p className="text-sm text-muted mt-1">
            تسجيل مشتريات بضاعة المتجر، تغذية المخزون تلقائياً، ومتابعة فواتير وحسابات الموردين
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasPermission("store.view") && (
            <Link to="/store">
              <Button variant="secondary" className="gap-2">
                <ShoppingCart className="size-4" />
                متجر النادي والـ POS
              </Button>
            </Link>
          )}

          {hasPermission("suppliers.manage") && (
            <Button
              variant="secondary"
              onClick={() => setSupplierModalOpen(true)}
              className="gap-2"
            >
              <UserPlus className="size-4" />
              إضافة مورد جديد
            </Button>
          )}

          {hasPermission("purchases.manage") && (
            <Button
              onClick={handleOpenNewInvoice}
              className="gap-2 bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
            >
              <Plus className="size-4" />
              فاتورة شراء جديدة
            </Button>
          )}
        </div>
      </div>

      {/* Glass Capsule Tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line/60 bg-panel/70 p-2 backdrop-blur-xl shadow-lg shadow-black/20">
        {[
          { value: "invoices", label: "فواتير الشراء والتوريد", icon: FileText, badge: invoicesTotal || undefined },
          { value: "suppliers", label: "دليل الموردين والشركات", icon: Building2, badge: suppliers.length || undefined },
        ].map((item) => {
          const isActive = activeTab === item.value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setActiveTab(item.value as "invoices" | "suppliers")}
              className={cn(
                "group relative flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200",
                isActive
                  ? "bg-gradient-to-r from-cyan-500/20 via-cyan-500/15 to-transparent text-white border border-cyan-500/50 shadow-md shadow-cyan-500/10"
                  : "text-subtle hover:text-white hover:bg-surface/60 border border-transparent",
              )}
            >
              <Icon
                className={cn(
                  "size-4 transition-transform duration-200 group-hover:scale-110",
                  isActive ? "text-cyan-400" : "text-subtle",
                )}
              />
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span className="ms-1 rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === "invoices" ? (
        <Card>
          <CardHeader
            title="سجل فواتير المشتريات"
            description={`إجمالي ${invoicesTotal} فاتورة شراء`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={invoiceStatus}
                  onChange={(e) => setInvoiceStatus(e.target.value)}
                  options={[
                    { value: "all", label: "كل الحالات" },
                    { value: "paid", label: "مدفوعة بالكامل" },
                    { value: "partial", label: "مدفوعة جزئياً" },
                    { value: "unpaid", label: "آجلة (غير مدفوعة)" },
                  ]}
                  className="w-36 text-xs"
                />

                <div className="relative w-56">
                  <Search className="size-4 absolute right-2.5 top-2.5 text-muted pointer-events-none" />
                  <Input
                    value={invoiceSearch}
                    onChange={(e) => setInvoiceSearch(e.target.value)}
                    placeholder="بحث برقم الفاتورة أو المورد..."
                    className="pr-8 text-xs"
                  />
                </div>
              </div>
            }
          />

          {invoices.length === 0 && !loadingInvoices ? (
            <div className="p-8">
              <EmptyState
                icon={<FileText />}
                title="لا توجد فواتير شراء"
                description="لم يتم تسجيل أي فواتير مشتريات حتى الآن."
              />
            </div>
          ) : (
            <DataTable<PurchaseInvoiceRow>
              columns={invoiceColumns}
              data={invoices}
              rowKey={(r) => r.id}
            />
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="دليل الموردين"
            description={`إجمالي ${suppliers.length} مورد مسجل`}
            action={
              <div className="relative w-56">
                <Search className="size-4 absolute right-2.5 top-2.5 text-muted pointer-events-none" />
                <Input
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="بحث باسم المورد أو الشركة..."
                  className="pr-8 text-xs"
                />
              </div>
            }
          />

          {suppliers.length === 0 && !loadingSuppliers ? (
            <div className="p-8">
              <EmptyState
                icon={<Truck />}
                title="لا يوجد موردون"
                description="لم يتم إضافة أي موردين في النظام حتى الآن."
              />
            </div>
          ) : (
            <DataTable<SupplierRow>
              columns={supplierColumns}
              data={suppliers}
              rowKey={(r) => r.id}
            />
          )}
        </Card>
      )}

      {/* New Supplier Modal */}
      {supplierModalOpen && (
        <Modal
          open={supplierModalOpen}
          onClose={() => setSupplierModalOpen(false)}
          title="إضافة مورد جديد"
        >
          <form onSubmit={handleSaveSupplier} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">اسم المورد *</label>
              <Input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="مثال: شركة النصر للمكملات"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">رقم الهاتف</label>
                <Input
                  value={supplierPhone}
                  onChange={(e) => setSupplierPhone(e.target.value)}
                  placeholder="010xxxxxxxx"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted block mb-1">اسم الشركة / المؤسسة</label>
                <Input
                  value={supplierCompany}
                  onChange={(e) => setSupplierCompany(e.target.value)}
                  placeholder="اختياري"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">العنوان</label>
              <Input
                value={supplierAddress}
                onChange={(e) => setSupplierAddress(e.target.value)}
                placeholder="عنوان المورد أو المخزن"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">ملاحظات</label>
              <Input
                value={supplierNotes}
                onChange={(e) => setSupplierNotes(e.target.value)}
                placeholder="شروط الدفع، التوصيل..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-line">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSupplierModalOpen(false)}
                disabled={savingSupplier}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                disabled={savingSupplier}
              >
                {savingSupplier ? "جارٍ الحفظ..." : "حفظ المورد"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* New Purchase Invoice Modal */}
      {invoiceModalOpen && (
        <Modal
          open={invoiceModalOpen}
          onClose={() => setInvoiceModalOpen(false)}
          title="تسجيل فاتورة شراء بضاعة (إدخال مخزون)"
        >
          <form onSubmit={handleSaveInvoice} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">المورد *</label>
                <Select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  options={[
                    { value: "", label: "-- اختر المورد --" },
                    ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">رقم الفاتورة (الدفتر)</label>
                <Input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="تلقائي إذا تُرك فارغاً"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">تاريخ الفاتورة *</label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Items Table */}
            <div className="space-y-2 border border-line rounded-lg p-3 bg-surface-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-semibold text-main flex items-center gap-1">
                  <ShoppingCart className="size-3.5 text-cyan-400" />
                  أصناف الفاتورة والكميات المشتراة
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleAddInvoiceItem}
                  className="h-6 text-xs gap-1"
                >
                  <Plus className="size-3" />
                  إضافة صنف
                </Button>
              </div>

              {invoiceItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-6">
                    <Select
                      value={item.productId}
                      onChange={(e) => handleProductSelect(idx, e.target.value)}
                      options={[
                        { value: "", label: "-- اختر منتج المتجر --" },
                        ...storeProducts.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                      className="text-xs"
                      required
                    />
                  </div>

                  <div className="col-span-2">
                    <Input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => {
                        const updated = [...invoiceItems];
                        updated[idx].quantity = parseInt(e.target.value || "1");
                        setInvoiceItems(updated);
                      }}
                      placeholder="الكمية"
                      className="text-xs font-mono"
                      required
                    />
                  </div>

                  <div className="col-span-3">
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      value={item.unitCostMajor}
                      onChange={(e) => {
                        const updated = [...invoiceItems];
                        updated[idx].unitCostMajor = e.target.value;
                        setInvoiceItems(updated);
                      }}
                      placeholder="سعر الوحدة"
                      className="text-xs font-mono"
                      required
                    />
                  </div>

                  <div className="col-span-1 flex justify-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveInvoiceItem(idx)}
                      disabled={invoiceItems.length === 1}
                      className="text-rose-400 hover:text-rose-500 disabled:opacity-30 text-base"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex justify-between items-center pt-2 border-t border-line text-sm font-semibold">
                <span>إجمالي الفاتورة المحسوب:</span>
                <span className="font-mono text-cyan-400">
                  {formatMinor(calculateInvoiceTotalMinor())}
                </span>
              </div>
            </div>

            {/* Payment info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-medium text-muted">المبلغ المدفوع للمورد حالياً (ج.م)</label>
                  <button
                    type="button"
                    onClick={() => setInvoicePaidMajor((calculateInvoiceTotalMinor() / 100).toString())}
                    className="text-xs text-cyan-400 hover:underline"
                  >
                    دفع كامل الفاتورة
                  </button>
                </div>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={invoicePaidMajor}
                  onChange={(e) => setInvoicePaidMajor(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">طريقة الدفع (الخزينة)</label>
                <Select
                  value={invoiceMethodCode}
                  onChange={(e) => setInvoiceMethodCode(e.target.value)}
                  options={[
                    { value: "cash", label: "نقدي (كاش - الخزينة)" },
                    { value: "instapay", label: "انستاباي (InstaPay)" },
                    { value: "wallet", label: "محفظة إلكترونية (فودافون كاش)" },
                    { value: "card", label: "فيزا / بطاقة بنكية" },
                  ]}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">ملاحظات الفاتورة</label>
              <Input
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
                placeholder="ملاحظات حول الشحنة أو التوريد..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-line">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setInvoiceModalOpen(false)}
                disabled={savingInvoice}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                disabled={savingInvoice}
              >
                {savingInvoice ? "جارٍ حفظ الفاتورة..." : "حفظ وتحديث المخزون"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Pay Debt Modal */}
      {payModalTarget && (
        <Modal
          open={!!payModalTarget}
          onClose={() => setPayModalTarget(null)}
          title={`سداد مستحقات الفاتورة (${payModalTarget.invoice_no})`}
        >
          <form onSubmit={handlePayDebtSubmit} className="space-y-4">
            <div className="p-3 bg-surface-2 rounded-lg border border-line space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">المورد:</span>
                <span className="font-semibold text-main">{payModalTarget.supplier_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">إجمالي الفاتورة:</span>
                <span className="font-mono">{formatMinor(payModalTarget.total_amount_minor)}</span>
              </div>
              <div className="flex justify-between text-rose-400 font-semibold border-t border-line pt-1">
                <span>المتبقي للمورد:</span>
                <span className="font-mono">{formatMinor(payModalTarget.remaining_amount_minor)}</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">مبلغ السداد (ج.م) *</label>
              <Input
                type="number"
                min="0.5"
                step="0.5"
                max={payModalTarget.remaining_amount_minor / 100}
                value={payDebtMajor}
                onChange={(e) => setPayDebtMajor(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">طريقة الدفع *</label>
              <Select
                value={payMethodCode}
                onChange={(e) => setPayMethodCode(e.target.value)}
                options={[
                  { value: "cash", label: "نقدي (كاش - الخزينة)" },
                  { value: "instapay", label: "انستاباي (InstaPay)" },
                  { value: "wallet", label: "محفظة إلكترونية (فودافون كاش)" },
                  { value: "card", label: "فيزا / بطاقة بنكية" },
                ]}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-line">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPayModalTarget(null)}
                disabled={payingDebt}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                disabled={payingDebt}
              >
                {payingDebt ? "جارٍ تسجيل السداد..." : "تأكيد سداد المبلغ"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
export default PurchasesPage;
