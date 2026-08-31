import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Barcode, Minus, Package, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type ProductPublic, type StoreSale, type StoreDebtRow, type StockMovementRow, type StoreReturnRow, type DailySalesRow, type ProductSalesRow, type StockValueRow } from "@/api";
import { formatMinor } from "@/core/money";
import { addDaysKey, todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

const MOVEMENT_LABEL_KEYS: Record<string, string> = {
  stock_in: "store.movement_stock_in",
  sale: "store.movement_sale",
  manual_adjust: "store.movement_manual_adjust",
  damage: "store.movement_damage",
  count_correction: "store.movement_count_correction",
  return: "store.movement_return",
  lost: "store.movement_lost",
};

type CartLine = { productId: string; name: string; unitPriceMinor: number; qty: number };

const TAB_ITEMS = [
  { value: "pos", labelKey: "store.tabPos" },
  { value: "products", labelKey: "store.tabProducts" },
  { value: "sales", labelKey: "store.tabSales" },
  { value: "returns", labelKey: "store.tabReturns" },
  { value: "debts", labelKey: "store.tabDebts" },
  { value: "movements", labelKey: "store.tabMovements" },
  { value: "reports", labelKey: "store.tabReports" },
];

export function StorePage() {
  const t = useT();
  const [tab, setTab] = useState("pos");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("nav.store")} />
        <div className="px-5 pb-1">
          <Tabs
            items={TAB_ITEMS.map((i) => ({ value: i.value, label: t(i.labelKey) }))}
            value={tab}
            onChange={setTab}
          />
        </div>
      </Card>
      {tab === "pos" && <PosTab onDone={() => setTab("sales")} />}
      {tab === "products" && <ProductsTab />}
      {tab === "sales" && <SalesTab />}
      {tab === "returns" && <ReturnsTab />}
      {tab === "debts" && <DebtsTab />}
      {tab === "movements" && <MovementsTab />}
      {tab === "reports" && <ReportsTab />}
    </div>
  );
}

// ---------------------------------- POS -----------------------------------

function PosTab({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [term, setTerm] = useState("");
  const [products, setProducts] = useState<ProductPublic[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountMajor, setDiscountMajor] = useState("");
  const [methodCode, setMethodCode] = useState("cash");
  const [isCredit, setIsCredit] = useState(false);
  const [creditMember, setCreditMember] = useState<{ id: string; fullName: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canCredit = hasPermission("store.credit");

  const loadProducts = useCallback(() => {
    api.store
      .listProducts({ search: term.trim() || undefined })
      .then((r) => setProducts(r.items))
      .catch(console.error);
  }, [term]);
  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const addToCart = (p: ProductPublic) =>
    setCart((prev) => {
      const found = prev.find((l) => l.productId === p.id);
      if (found) return prev.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { productId: p.id, name: p.name, unitPriceMinor: p.priceMinor, qty: 1 }];
    });
  const changeQty = (productId: string, delta: number) =>
    setCart((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, qty: Math.max(1, l.qty + delta) } : l)),
    );
  const removeLine = (productId: string) =>
    setCart((prev) => prev.filter((l) => l.productId !== productId));

  const itemsTotalMinor = cart.reduce((s, l) => s + l.unitPriceMinor * l.qty, 0);
  const discountMinor = Math.min(Math.round(Number(discountMajor || 0) * 100), itemsTotalMinor);
  const totalMinor = itemsTotalMinor - discountMinor;

  const completeSale = async () => {
    if (!actor || cart.length === 0) return;
    if (isCredit && !creditMember) {
      toast("error", t("store.pickMemberCredit"));
      return;
    }
    setSubmitting(true);
    try {
      const sale = await api.store.createSale({
        items: cart.map((l) => ({ productId: l.productId, qty: l.qty })),
        discountMinor,
        methodCode,
        memberId: isCredit ? creditMember!.id : null,
        isCredit,
      });
      toast("success", t("store.saleDoneToast", { no: sale.saleNo }));
      setCart([]);
      setDiscountMajor("");
      setIsCredit(false);
      setCreditMember(null);
      onDone();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title={t("nav.store")} />
        <div className="border-b border-line px-5 py-3.5">
          <Input
            placeholder={t("store.searchProduct")}
            value={term}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
            autoFocus
          />
        </div>
          {products.length === 0 ? (
          <EmptyState icon={<Package />} title={t("members.emptyTitle")} />
        ) : (
          <ul className="grid gap-2 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => addToCart(p)}
                  disabled={p.stockQty <= 0}
                  className="w-full rounded-xl border border-line bg-panel p-3 text-start transition-colors hover:border-neon/50 disabled:opacity-40"
                >
                  <span className="block truncate text-sm font-bold">{p.name}</span>
                  <span dir="ltr" className="mt-1 flex items-center justify-between text-[11px] tabnum text-subtle">
                    <span>{formatMinor(p.priceMinor)}</span>
                    <Badge variant={p.lowStock ? "warning" : "neutral"}>{p.stockQty}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title={t("store.cart")} />
        {cart.length === 0 ? (
          <EmptyState icon={<Barcode />} title={t("store.emptyCart")} />
        ) : (
          <>
            <ul className="divide-y divide-line px-5">
              {cart.map((l) => (
                <li key={l.productId} className="flex items-center gap-2 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-bold">{l.name}</span>
                  <button type="button" aria-label="-" onClick={() => changeQty(l.productId, -1)} className="grid size-7 place-items-center rounded-lg border border-line hover:text-neon"><Minus className="size-3.5" /></button>
                  <span dir="ltr" className="w-8 text-center font-bold tabnum">{l.qty}</span>
                  <button type="button" aria-label="+" onClick={() => changeQty(l.productId, 1)} className="grid size-7 place-items-center rounded-lg border border-line hover:text-neon"><Plus className="size-3.5" /></button>
                  <span dir="ltr" className="w-20 text-end tabnum text-subtle">{formatMinor(l.unitPriceMinor * l.qty)}</span>
                  <button type="button" aria-label={t("common.delete")} onClick={() => removeLine(l.productId)} className="text-faint hover:text-red"><Trash2 className="size-4" /></button>
                </li>
              ))}
            </ul>
            <div className="space-y-3 border-t border-line p-5">
              <div className="flex justify-between text-sm font-bold">
                <span>{t("store.total")}</span>
                <span dir="ltr" className="tabnum">{formatMinor(itemsTotalMinor)}</span>
              </div>
              <Input label={`${t("store.discount")} (ج.م)`} type="number" min={0} step="0.01" dir="ltr" value={discountMajor} onChange={(e: ChangeEvent<HTMLInputElement>) => setDiscountMajor(e.target.value)} />
              <Select label={t("store.method")} value={methodCode} onChange={(e) => setMethodCode(e.target.value)} options={[
                { value: "cash", label: "نقدي" },
                { value: "bank_card", label: "بطاقة بنكية" },
                { value: "transfer", label: "تحويل / محفظة" },
                { value: "other", label: "أخرى" },
              ]} />
              {canCredit && (
                <>
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={isCredit} onChange={(e) => setIsCredit(e.target.checked)} className="accent-neon" />
                    {t("store.creditSale")}
                  </label>
                  {isCredit && (
                    <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                      {creditMember?.fullName ?? t("store.pickMemberCredit")}
                    </Button>
                  )}
                </>
              )}
              <div className="flex justify-between border-t border-line pt-3 text-base font-extrabold text-neon">
                <span>{t("pay.summaryNet")}</span>
                <span dir="ltr" className="tabnum">{formatMinor(totalMinor)}</span>
              </div>
              <Button fullWidth loading={submitting} disabled={submitting || cart.length === 0} onClick={() => void completeSale()}>
                {t("store.completeSale")}
              </Button>
            </div>
          </>
        )}
      </Card>

      <MemberPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(m) => {
          setCreditMember(m);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

// -------------------------------- products --------------------------------

function ProductsTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<ProductPublic[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ProductPublic | null>(null);
  const [stockTarget, setStockTarget] = useState<ProductPublic | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<ProductPublic | null>(null);
  const { toast } = useToast();

  const reload = useCallback(() => {
    api.store.listProducts({ includeInactive: true }).then((r) => setItems(r.items)).catch(console.error);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const doPurge = async () => {
    if (!purgeTarget) return;
    try {
      await api.store.purgeProduct(purgeTarget.id);
      toast("success", t("store.productPurgedToast"));
      setPurgeTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const columns: Column<ProductPublic>[] = [
    { key: "name", header: t("store.name"), render: (r) => <span className="font-bold">{r.name}</span> },
    { key: "cat", header: t("store.category"), render: (r) => r.categoryName ?? "—" },
    { key: "price", header: t("store.price"), render: (r) => <span dir="ltr" className="tabnum">{formatMinor(r.priceMinor)}</span> },
    { key: "stock", header: t("store.stock"), render: (r) => <Badge variant={r.lowStock ? "warning" : "success"} dot>{r.stockQty}</Badge> },
    { key: "active", header: t("common.status"), render: (r) => (r.isActive ? t("plans.active") : t("plans.inactive")) },
    ...(hasPermission("store.products") || hasPermission("store.inventory") || hasPermission("store.purge")
      ? [{
          key: "actions",
          header: t("common.actions"),
          align: "end" as const,
          render: (r: ProductPublic) => (
            <div className="flex justify-end gap-1.5">
              {hasPermission("store.products") && (
                <Button size="sm" variant="secondary" onClick={() => { setEditing(r); setEditOpen(true); }}>{t("common.edit")}</Button>
              )}
              {hasPermission("store.inventory") && (
                <Button size="sm" variant="ghost" onClick={() => setStockTarget(r)}>{t("store.restock")}</Button>
              )}
              {hasPermission("store.purge") && (
                <Button size="sm" variant="ghost" className="text-red hover:text-red" title={t("store.purgeProductAction")} onClick={() => setPurgeTarget(r)}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ),
        }]
      : []),
  ];

  return (
    <>
      <Card>
        <CardHeader
          title={t("store.tabProducts")}
          action={
            hasPermission("store.products") ? (
              <Button onClick={() => { setEditing(null); setEditOpen(true); }}>{t("store.addProduct")}</Button>
            ) : undefined
          }
        />
        {items.length === 0 ? <EmptyState icon={<Package />} title={t("members.emptyTitle")} /> : <DataTable columns={columns} data={items} rowKey={(r) => r.id} />}
      </Card>
      {editOpen && (
        <ProductFormModal
          product={editing}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); reload(); }}
        />
      )}
      {stockTarget && (
        <StockModal
          product={stockTarget}
          onClose={() => setStockTarget(null)}
          onSaved={() => { setStockTarget(null); reload(); }}
        />
      )}
      <ConfirmDialog
        open={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        title={t("store.purgeProductAction")}
        message={purgeTarget ? `${purgeTarget.name} — ${t("store.purgeProductConfirm")}` : ""}
        confirmLabel={t("common.delete")}
        onConfirm={() => void doPurge()}
      />
    </>
  );
}

function ProductFormModal({ product, onClose, onSaved }: { product: ProductPublic | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: product?.name ?? "",
    costMajor: product ? String(product.costMinor / 100) : "",
    priceMajor: product ? String(product.priceMinor / 100) : "",
    stockQty: product ? String(product.stockQty) : "0",
    minStockQty: product ? String(product.minStockQty) : "3",
    barcode: product?.barcode ?? "",
    supplierName: product?.supplierName ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        costMinor: Math.round(Number(form.costMajor || 0) * 100),
        priceMinor: Math.round(Number(form.priceMajor || 0) * 100),
        minStockQty: Number(form.minStockQty || 0),
        barcode: form.barcode || null,
        supplierName: form.supplierName || null,
      };
      if (product) await api.store.updateProduct(product.id, payload);
      else await api.store.createProduct({ ...payload, stockQty: Number(form.stockQty || 0) });
      toast("success", t("toast.saved"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={product ? t("store.editProduct") : t("store.addProduct")} widthClass="max-w-lg"
      footer={<><Button type="submit" form="product-form" loading={busy}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="product-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3.5">
        <Input label={t("store.name")} value={form.name} onChange={set("name")} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("store.cost")} type="number" step="0.01" min={0} dir="ltr" value={form.costMajor} onChange={set("costMajor")} />
          <Input label={t("store.price")} type="number" step="0.01" min={0} dir="ltr" value={form.priceMajor} onChange={set("priceMajor")} />
        </div>
        {!product && <Input label={t("store.stock")} type="number" min={0} dir="ltr" value={form.stockQty} onChange={set("stockQty")} />}
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("store.barcode")} dir="ltr" value={form.barcode} onChange={set("barcode")} />
          <Input label={t("store.supplier")} value={form.supplierName} onChange={set("supplierName")} />
        </div>
        <Input label={t("store.minStock")} type="number" min={0} dir="ltr" value={form.minStockQty} onChange={set("minStockQty")} />
      </form>
    </Modal>
  );
}

function StockModal({ product, onClose, onSaved }: { product: ProductPublic; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [delta, setDelta] = useState("");
  const [notes, setNotes] = useState("");
  const [movementType, setMovementType] = useState("stock_in");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.store.adjustStock({ productId: product.id, movementType, delta: Math.trunc(Number(delta)), notes: notes || null });
      toast("success", t("toast.saved"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t("store.restock")} — ${product.name}`} widthClass="max-w-sm"
      footer={<><Button type="submit" form="stock-form" loading={busy}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="stock-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3.5">
        <Select label="" value={movementType} onChange={(e) => setMovementType(e.target.value)} options={[
          { value: "stock_in", label: "توريد" },
          { value: "manual_adjust", label: "تسوية يدوية" },
          { value: "damage", label: "تالف" },
          { value: "lost", label: "مفقود" },
          { value: "count_correction", label: "تصحيح جرد" },
        ]} />
        <Input label={`${t("store.qty")} (+/-)`} type="number" dir="ltr" value={delta} onChange={(e: ChangeEvent<HTMLInputElement>) => setDelta(e.target.value)} autoFocus />
        <p className="text-[11px] text-faint">{t("store.restockDeltaHint")}</p>
        <Input label={t("common.notes")} value={notes} onChange={(e: ChangeEvent<HTMLInputElement>) => setNotes(e.target.value)} />
      </form>
    </Modal>
  );
}

// --------------------------------- sales ----------------------------------

function SalesTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<StoreSale[]>([]);
  const [viewing, setViewing] = useState<StoreSale | null>(null);
  const [voidTarget, setVoidTarget] = useState<StoreSale | null>(null);
  const [unvoidSaleTarget, setUnvoidSaleTarget] = useState<StoreSale | null>(null);
  const [returnTarget, setReturnTarget] = useState<StoreSale | null>(null);
  const [reason, setReason] = useState("");

  const reload = useCallback(() => {
    api.store.listSales({}).then((r) => setItems(r.items)).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const openDetails = (saleId: string) => {
    api.store.getSale(saleId).then(setViewing).catch(console.error);
  };

  const doVoid = async () => {
    if (!voidTarget) return;
    try {
      await api.store.voidStoreSale(voidTarget.id, reason);
      toast("success", t("store.voidedToast"));
      setVoidTarget(null);
      setReason("");
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const columns: Column<StoreSale>[] = [
    { key: "no", header: t("store.colSaleNo"), render: (r) => (
      <button type="button" onClick={() => openDetails(r.id)} className="font-bold tabnum hover:text-neon" dir="ltr">{r.saleNo}</button>
    ) },
    { key: "member", header: t("store.colMember"), render: (r) => r.memberName ?? "—" },
    { key: "total", header: t("store.colTotal"), render: (r) => <span dir="ltr" className="tabnum font-bold">{formatMinor(r.totalMinor)}</span> },
    { key: "profit", header: t("store.colProfit"), render: (r) =>
      hasPermission("store.profit")
        ? <span dir="ltr" className="tabnum text-emerald">{formatMinor(r.grossProfitMinor)}</span>
        : <span>—</span> },
    { key: "status", header: t("store.colStatus"), render: (r) => <Badge variant={r.status === "completed" ? "success" : "danger"}>{r.status === "completed" ? t("exp.statusActive") : t("exp.statusVoided")}</Badge> },
    ...(hasPermission("store.void_sale") || hasPermission("store.return")
      ? [{
          key: "actions",
          header: "",
          align: "end" as const,
          render: (r: StoreSale) => {
            if (r.status !== "completed") {
              return hasPermission("store.void_sale") ? (
                <button type="button" aria-label={t("store.actionRestore")} onClick={() => setUnvoidSaleTarget(r)} className="text-faint hover:text-subtle"><RotateCcw className="size-4" /></button>
              ) : null;
            }
            return (
              <div className="flex items-center justify-end gap-1.5">
                {hasPermission("store.return") && (
                  <button type="button" aria-label={t("store.makeReturn")} onClick={() => setReturnTarget(r)} className="text-faint hover:text-amber"><Undo2 className="size-4" /></button>
                )}
                {hasPermission("store.void_sale") && (
                  <button type="button" aria-label={t("store.voidSale")} onClick={() => setVoidTarget(r)} className="text-faint hover:text-red"><Trash2 className="size-4" /></button>
                )}
              </div>
            );
          },
        }]
      : []),
  ];

  return (
    <>
      <Card>
        <CardHeader title={t("store.tabSales")} />
        {items.length === 0 ? <EmptyState icon={<Package />} title={t("pay.empty")} /> : <DataTable columns={columns} data={items} rowKey={(r) => r.id} />}
      </Card>
      <Modal open={voidTarget !== null} onClose={() => setVoidTarget(null)} title={t("store.voidSale")} widthClass="max-w-xs"
        footer={<><Button variant="danger" type="submit" form="void-form">{t("common.confirm")}</Button><Button variant="secondary" onClick={() => setVoidTarget(null)}>{t("common.cancel")}</Button></>}>
        <form id="void-form" onSubmit={(e) => { e.preventDefault(); void doVoid(); }} className="space-y-3.5">
          <p className="text-sm text-subtle">{voidTarget?.saleNo}</p>
          <Input label={t("store.voidReason")} value={reason} onChange={(e: ChangeEvent<HTMLInputElement>) => setReason(e.target.value)} autoFocus />
        </form>
      </Modal>
      <ConfirmDialog
        open={unvoidSaleTarget !== null}
        onClose={() => setUnvoidSaleTarget(null)}
        title={t("store.restoreConfirmTitle")}
        message={t("store.restoreConfirmMsg")}
        onConfirm={() => {
          if (!unvoidSaleTarget) return;
          api.store
            .unvoidStoreSale(unvoidSaleTarget.id)
            .then(() => {
              toast("success", t("store.restoredToast"));
              setUnvoidSaleTarget(null);
              reload();
            })
            .catch((err) => toast("error", describeError(err, t)));
        }}
      />
      {returnTarget && (
        <ReturnModal
          sale={returnTarget}
          onClose={() => setReturnTarget(null)}
          onDone={() => { setReturnTarget(null); reload(); }}
        />
      )}
      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={viewing.saleNo} widthClass="max-w-md">
          <ul className="divide-y divide-line text-sm">
            {viewing.items.map((it, i) => (
              <li key={`${it.productId}-${i}`} className="flex justify-between py-2">
                <span>{it.productName} × {it.qty}</span>
                <span dir="ltr" className="tabnum">{formatMinor(it.lineTotalMinor)}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

// ------------------------------- returns ----------------------------------

function ReturnModal({ sale, onClose, onDone }: { sale: StoreSale; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [lines, setLines] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const it of sale.items) init[it.id] = String(Math.max(0, it.qty - it.returnedQty));
    return init;
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const returnable = sale.items.filter((it) => it.qty - it.returnedQty > 0);
  const itemsTotal = returnable.reduce((s, it) => s + it.unitPriceMinor * Math.max(0, Math.min(Number(lines[it.id] || 0), it.qty - it.returnedQty)), 0);
  const totalMinor = itemsTotal;

  const submit = async () => {
    const chosen = returnable
      .map((it) => ({ id: it.id, qty: Math.floor(Number(lines[it.id] || 0)) }))
      .filter((l) => l.qty > 0);
    if (chosen.length === 0) {
      toast("error", t("store.emptyReturn"));
      return;
    }
    setBusy(true);
    try {
      const ret = await api.store.returnSale({
        saleId: sale.id,
        lines: chosen.map((l) => ({ saleItemId: l.id, qty: l.qty })),
        reason: reason || null,
      });
      toast("success", t("store.returnToast", { no: ret.returnNo }));
      onDone();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (sale.isCredit) {
    return (
      <Modal open onClose={onClose} title={t("store.makeReturn")} widthClass="max-w-sm"
        footer={<Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>}>
        <p className="text-sm text-subtle">{t("store.returnBlockedCredit")}</p>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`${t("store.makeReturn")} — ${sale.saleNo}`} widthClass="max-w-md"
      footer={<><Button type="submit" form="return-form" loading={busy}>{t("store.returnSubmit")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="return-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3.5">
        {returnable.length === 0 ? (
          <p className="text-sm text-subtle">{t("store.noReturnable")}</p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {returnable.map((it) => {
                const max = it.qty - it.returnedQty;
                return (
                  <li key={it.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{it.productName}</span>
                      <span dir="ltr" className="block text-[11px] text-faint tabnum">{t("store.returnAvailable")}: {max}</span>
                    </span>
                    <span dir="ltr" className="w-16 text-end tabnum text-subtle">{formatMinor(it.unitPriceMinor * Math.max(0, Math.min(Number(lines[it.id] || 0), max)))}</span>
                    <input
                      type="number"
                      min={0}
                      max={max}
                      dir="ltr"
                      className="w-16 rounded-lg border border-line bg-panel px-2 py-1.5 text-center tabnum"
                      value={lines[it.id] ?? "0"}
                      onChange={(e) => setLines((p) => ({ ...p, [it.id]: e.target.value }))}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-between border-t border-line pt-2.5 text-base font-extrabold text-neon">
              <span>{t("store.returnHeader")}</span>
              <span dir="ltr" className="tabnum">{formatMinor(totalMinor)}</span>
            </div>
            <Input label={t("store.returnReason")} value={reason} onChange={(e: ChangeEvent<HTMLInputElement>) => setReason(e.target.value)} />
          </>
        )}
      </form>
    </Modal>
  );
}

function ReturnsTab() {
  const t = useT();
  const [rows, setRows] = useState<Array<Omit<StoreReturnRow, "items">>>([]);
  const [viewing, setViewing] = useState<StoreReturnRow | null>(null);
  const reload = useCallback(() => {
    api.store.listReturns({}).then((r) => setRows(r.items)).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const openDetails = (returnId: string) => {
    api.store.getReturn(returnId).then(setViewing).catch(console.error);
  };

  const columns: Column<Omit<StoreReturnRow, "items">>[] = [
    { key: "no", header: t("store.returnNoCol"), render: (r) => (
      <button type="button" onClick={() => openDetails(r.id)} className="font-bold tabnum hover:text-neon" dir="ltr">{r.returnNo}</button>
    ) },
    { key: "sale", header: t("store.colSaleNo"), render: (r) => <span dir="ltr" className="tabnum text-subtle">{r.saleNo}</span> },
    { key: "member", header: t("store.colMember"), render: (r) => r.memberName ?? "—" },
    { key: "total", header: t("store.colTotal"), render: (r) => <span dir="ltr" className="tabnum font-bold text-red">{formatMinor(r.totalMinor)}</span> },
    { key: "reason", header: t("store.returnReason"), render: (r) => r.reason ?? "—" },
    { key: "date", header: t("store.colDate"), render: (r) => <span dir="ltr" className="tabnum text-subtle">{r.createdAt.slice(0, 16)}</span> },
  ];

  return (
    <>
      <Card>
        <CardHeader title={t("store.tabReturns")} />
        {rows.length === 0 ? <EmptyState icon={<Package />} title={t("store.emptyReturns")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      </Card>
      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={viewing.returnNo} widthClass="max-w-md">
          <div className="mb-2 flex justify-between text-sm text-subtle">
            <span>{viewing.saleNo}</span>
            <span dir="ltr" className="tabnum font-bold text-red">{formatMinor(viewing.totalMinor)}</span>
          </div>
          <ul className="divide-y divide-line text-sm">
            {viewing.items.map((it, i) => (
              <li key={`${it.id}-${i}`} className="flex justify-between py-2">
                <span>{it.productName} × {it.qty}</span>
                <span dir="ltr" className="tabnum">{formatMinor(it.lineTotalMinor)}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

// --------------------------------- debts ----------------------------------

function DebtsTab() {
  const t = useT();
  const { toast } = useToast();
  const [rows, setRows] = useState<StoreDebtRow[]>([]);
  const [repayTarget, setRepayTarget] = useState<StoreDebtRow | null>(null);
  const [amountMajor, setAmountMajor] = useState("");
  const [methodCode, setMethodCode] = useState("cash");

  const reload = useCallback(() => {
    api.store.listDebts({ status: "open" }).then((r) => setRows(r.items)).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const repay = async () => {
    if (!repayTarget) return;
    try {
      await api.store.repayDebt({ debtId: repayTarget.id, amountMinor: Math.round(Number(amountMajor || 0) * 100), methodCode });
      toast("success", t("store.repaidToast"));
      setRepayTarget(null);
      setAmountMajor("");
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const columns: Column<StoreDebtRow>[] = [
    { key: "member", header: t("common.member"), render: (r) => (
      <span><span className="block font-bold">{r.memberName}</span><span dir="ltr" className="block text-[11px] text-faint tabnum">{r.memberCode}</span></span>
    ) },
    { key: "saleNo", header: t("store.colSaleNo"), render: (r) => <span dir="ltr" className="tabnum text-subtle">{r.saleNo}</span> },
    { key: "remaining", header: t("store.debtRemaining"), render: (r) => <span dir="ltr" className="font-bold tabnum text-red">{formatMinor(r.remainingMinor)}</span> },
    { key: "actions", header: "", align: "end", render: (r) => <Button size="sm" variant="secondary" onClick={() => setRepayTarget(r)}>{t("store.repay")}</Button> },
  ];

  return (
    <>
      <Card>
        <CardHeader title={t("store.tabDebts")} />
        {rows.length === 0 ? <EmptyState icon={<Package />} title={t("subs.balancePaid")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
      </Card>
      <Modal open={repayTarget !== null} onClose={() => setRepayTarget(null)} title={t("store.repay")} widthClass="max-w-xs"
        footer={<><Button type="submit" form="repay-form">{t("common.confirm")}</Button><Button variant="secondary" onClick={() => setRepayTarget(null)}>{t("common.cancel")}</Button></>}>
        <form id="repay-form" onSubmit={(e) => { e.preventDefault(); void repay(); }} className="space-y-3.5">
          <p className="text-sm text-subtle">{repayTarget?.memberName} — <span dir="ltr" className="tabnum">{repayTarget ? formatMinor(repayTarget.remainingMinor) : ""}</span></p>
          <Input label={t("store.repayAmount")} type="number" step="0.01" min={0} dir="ltr" value={amountMajor} onChange={(e: ChangeEvent<HTMLInputElement>) => setAmountMajor(e.target.value)} autoFocus />
          <Select label={t("store.method")} value={methodCode} onChange={(e) => setMethodCode(e.target.value)} options={[
            { value: "cash", label: "نقدي" }, { value: "bank_card", label: "بطاقة بنكية" }, { value: "transfer", label: "تحويل" },
          ]} />
        </form>
      </Modal>
    </>
  );
}

// ------------------------------- movements --------------------------------

function MovementsTab() {
  const t = useT();
  const [rows, setRows] = useState<StockMovementRow[]>([]);
  useEffect(() => {
    api.store.listStockMovements({ limit: 120 }).then(setRows).catch(console.error);
  }, []);

  const columns: Column<StockMovementRow>[] = [
    { key: "date", header: t("common.date"), render: (r) => <span dir="ltr" className="tabnum text-subtle">{r.createdAt.slice(0, 16)}</span> },
    { key: "product", header: t("store.name"), render: (r) => <span className="font-bold">{r.productName}</span> },
    { key: "type", header: "", render: (r) => t(MOVEMENT_LABEL_KEYS[r.movementType] ?? r.movementType, {} as never) },
    { key: "delta", header: t("store.qty"), render: (r) => <Badge variant={r.delta > 0 ? "success" : "danger"}>{r.delta > 0 ? `+${r.delta}` : `${r.delta}`}</Badge> },
    { key: "result", header: t("store.stock"), render: (r) => <span dir="ltr" className="tabnum">{r.resultQty}</span> },
  ];

  return (
    <Card>
      <CardHeader title={t("store.tabMovements")} />
      {rows.length === 0 ? <EmptyState icon={<Package />} title={t("audit.empty")} /> : <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />}
    </Card>
  );
}

// -------------------------------- reports ---------------------------------

function ReportsTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const defaultFrom = addDaysKey(todayKey(), -29);
  const [fromKey, setFromKey] = useState(defaultFrom);
  const [toKey, setToKey] = useState(todayKey());
  const [daily, setDaily] = useState<DailySalesRow[]>([]);
  const [products, setProducts] = useState<ProductSalesRow[]>([]);
  const [stockValue, setStockValue] = useState<StockValueRow | null>(null);
  const [lowStock, setLowStock] = useState<ProductPublic[]>([]);
  const [loaded, setLoaded] = useState(false);
  const canProfit = hasPermission("store.profit");

  const load = useCallback(() => {
    if (!canProfit) { setLoaded(true); return; }
    const range = { fromKey, toKey };
    api.store.dailySalesReport(range).then(setDaily).catch(console.error);
    api.store.productSalesReport(range).then(setProducts).catch(console.error);
    api.store.stockValue().then(setStockValue).catch(console.error);
    api.store.lowStockProducts({ limit: 20 }).then(setLowStock).catch(console.error);
    setLoaded(true);
  }, [canProfit, fromKey, toKey]);

  useEffect(() => { load(); }, [load]);

  if (!canProfit) {
    return <Card><CardHeader title={t("store.tabReports")} /><p className="px-5 pb-5 text-sm text-subtle">{t("common.noPermission")}</p></Card>;
  }

  const dailyCols: Column<DailySalesRow>[] = [
    { key: "date", header: t("store.colDateKey"), render: (r) => <span dir="ltr" className="tabnum font-bold">{r.dateKey}</span> },
    { key: "count", header: t("store.colSalesCount"), render: (r) => <span className="tabnum">{r.salesCount}</span> },
    { key: "net", header: t("store.colNetMinor"), render: (r) => <span dir="ltr" className="tabnum font-bold">{formatMinor(r.netMinor)}</span> },
    { key: "returns", header: t("store.colReturnsCount"), render: (r) => r.returnsCount > 0 ? <span className="tabnum text-red">-{r.returnsMinor / 100} ({r.returnsCount})</span> : <span>—</span> },
    { key: "profit", header: t("store.colProfit"), render: (r) => <span dir="ltr" className="tabnum text-emerald">{formatMinor(r.grossProfitMinor)}</span> },
  ];

  const prodCols: Column<ProductSalesRow>[] = [
    { key: "product", header: t("store.name"), render: (r) => <span className="font-bold">{r.productName}</span> },
    { key: "cat", header: t("store.category"), render: (r) => r.categoryName ?? "—" },
    { key: "units", header: t("store.colUnitsSold"), render: (r) => <span className="tabnum">{r.unitsSold}</span> },
    { key: "returned", header: t("store.colUnitsReturned"), render: (r) => r.unitsReturned > 0 ? <span className="tabnum text-red">{r.unitsReturned}</span> : <span className="tabnum text-subtle">0</span> },
    { key: "net", header: t("store.colNetUnits"), render: (r) => <span className="tabnum font-bold">{r.netUnits}</span> },
    { key: "revenue", header: t("store.colTotal"), render: (r) => <span dir="ltr" className="tabnum">{formatMinor(r.revenueMinor)}</span> },
    { key: "profit", header: t("store.colProfit"), render: (r) => <span dir="ltr" className="tabnum text-emerald">{formatMinor(r.grossProfitMinor)}</span> },
  ];

  const lowStockCols: Column<ProductPublic>[] = [
    { key: "name", header: t("store.name"), render: (r) => <span className="font-bold">{r.name}</span> },
    { key: "stock", header: t("store.stock"), render: (r) => <Badge variant="danger">{r.stockQty}</Badge> },
    { key: "min", header: t("store.minStock"), render: (r) => <span className="tabnum">{r.minStockQty}</span> },
    { key: "value", header: t("store.stockCostValue"), render: (r) => <span dir="ltr" className="tabnum">{formatMinor(r.stockQty * r.costMinor)}</span> },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("store.tabReports")}
          action={
            <div className="flex items-end gap-2">
              <div className="w-40"><Input type="date" dir="ltr" value={fromKey} onChange={(e) => setFromKey(e.target.value)} /></div>
              <div className="w-40"><Input type="date" dir="ltr" value={toKey} onChange={(e) => setToKey(e.target.value)} /></div>
              <Button size="sm" onClick={load}>{t("rpt.apply")}</Button>
            </div>
          }
        />
      </Card>

      {stockValue && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ValueCard label={t("store.stockCostValue")} value={formatMinor(stockValue.totalCostMinor)} />
          <ValueCard label={t("store.stockRetailValue")} value={formatMinor(stockValue.potentialRetailMinor)} />
          <ValueCard label={t("store.stockPotentialProfit")} value={formatMinor(stockValue.potentialGrossProfitMinor)} positive />
          <ValueCard label={t("store.stockProductCount")} value={String(stockValue.productCount)} />
        </div>
      )}

      {loaded && (
        <>
          <Card>
            <CardHeader title={t("store.reportDailySales")} />
            {daily.length === 0 ? <EmptyState icon={<Package />} title={t("pay.empty")} /> : <DataTable columns={dailyCols} data={daily} rowKey={(r) => r.dateKey} />}
          </Card>
          <Card>
            <CardHeader title={t("store.reportBestSellers")} />
            {products.length === 0 ? <EmptyState icon={<Package />} title={t("pay.empty")} /> : <DataTable columns={prodCols} data={products} rowKey={(r) => r.productId} />}
          </Card>
          <Card>
            <CardHeader title={t("store.reportLowStock")} />
            {lowStock.length === 0 ? <EmptyState icon={<Package />} title={t("store.reportLowStock")} /> : <DataTable columns={lowStockCols} data={lowStock} rowKey={(r) => r.id} />}
          </Card>
        </>
      )}
    </div>
  );
}

function ValueCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <Card>
      <div className="p-4">
        <p className="text-[11px] text-subtle">{label}</p>
        <p dir="ltr" className={`mt-1 text-lg font-extrabold tabnum ${positive ? "text-emerald" : ""}`}>{value}</p>
      </div>
    </Card>
  );
}
