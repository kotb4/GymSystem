import { useEffect, useState, type FormEvent } from "react";
import { Plus, Tag } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type Expense, type ExpenseCategory } from "@/api";

import { minorToMajor, toMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface ExpenseFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  expense?: Expense | null;
}

export function ExpenseFormModal({ open, onClose, onSaved, expense }: ExpenseFormModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const [categoryId, setCategoryId] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [methodCode, setMethodCode] = useState("cash");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayKey());
  const [referenceNo, setReferenceNo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        setCategories(await api.expenses.categories());
        setMethods(await api.payments.methods());
      } catch {
        setCategories([]);
        setMethods([]);
      }
    })();
    if (expense) {
      setCategoryId(expense.categoryId);
      setAmountMajor(minorToMajor(expense.amountMinor).toString());
      setMethodCode(expense.methodCode);
      setDescription(expense.description);
      setExpenseDate(expense.expenseDate);
      setReferenceNo(expense.referenceNo ?? "");
    } else {
      setCategoryId("");
      setAmountMajor("");
      setMethodCode("cash");
      setDescription("");
      setExpenseDate(todayKey());
      setReferenceNo("");
    }
    setError(null);
  }, [open, expense]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        categoryId,
        amountMinor: toMinor(amountMajor),
        methodCode,
        description,
        expenseDate,
        referenceNo: referenceNo || null,
      };
      if (expense) {
        await api.expenses.update(expense.id, input);
        toast("success", t("exp.updatedToast"));
      } else {
        await api.expenses.create(input);
        toast("success", t("exp.createdToast"));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={expense ? t("exp.editExpense") : t("exp.addExpense")} widthClass="max-w-lg">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t("exp.colCategory")}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={submitting}
            options={[
              { value: "", label: "—" },
              ...categories.map((c) => ({ value: c.id, label: c.nameAr })),
            ]}
          />
          <Input
            label={t("exp.amount")}
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            value={amountMajor}
            onChange={(e) => setAmountMajor(e.target.value)}
            disabled={submitting}
            autoFocus={!expense}
          />
        </div>
        <Input
          label={t("exp.description")}
          placeholder={t("exp.descriptionPh")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t("exp.expenseDate")}
            type="date"
            dir="ltr"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            disabled={submitting}
          />
          <Select
            label={t("exp.method")}
            value={methodCode}
            onChange={(e) => setMethodCode(e.target.value)}
            disabled={submitting}
            options={methods.map((m) => ({ value: m.code, label: m.labelAr }))}
          />
        </div>
        <Input
          label={t("exp.referenceNo")}
          dir="ltr"
          value={referenceNo}
          onChange={(e) => setReferenceNo(e.target.value)}
          disabled={submitting}
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={submitting} disabled={submitting}>
            {t("exp.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface CategoriesModalProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export function ExpenseVoidModal({
  open,
  onClose,
  onDone,
  expense,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  expense: Expense | null;
}) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError(null);
  }, [open]);

  if (!expense) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.expenses.void(expense.id, reason);
      toast("success", t("exp.voidedToast"));
      onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("exp.voidTitle")} widthClass="max-w-md">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        <p className="rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[13px] font-semibold text-amber">
          {t("exp.voidMsg")}
        </p>
        <Input
          label={t("exp.voidReason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={submitting}
          autoFocus
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="danger" loading={submitting} disabled={submitting}>
            {t("common.confirm")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ExpenseCategoriesModal({ open, onClose, onChanged }: CategoriesModalProps) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api.expenses
      .categories()
      .then(setCategories)
      .catch(() => setCategories([]));
  };

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!hasPermission("expenses.edit")) return null;

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setError(null);
    try {
      await api.expenses.createCategory(name);
      toast("success", t("exp.categoryAddedToast"));
      setName("");
      refresh();
      onChanged();
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const onToggle = async (category: ExpenseCategory) => {
    if (!actor) return;
    try {
      await api.expenses.setCategoryActive(category.id, !category.isActive);
      toast("success", t("exp.categoryToggledToast"));
      refresh();
      onChanged();
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("exp.categoriesTitle")} widthClass="max-w-md">
      <div className="space-y-4">
        <form onSubmit={(e) => void onAdd(e)} noValidate className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label={t("exp.categoryName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            <Plus className="size-4" />
            {t("exp.addCategory")}
          </Button>
        </form>

        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}

        <ul className="max-h-72 space-y-1.5 overflow-y-auto pe-1">
          {categories.map((category) => (
            <li
              key={category.id}
              className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3.5 py-2.5"
            >
              <Tag aria-hidden className="size-4 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{category.nameAr}</span>
              <span className="shrink-0 text-[11px] text-faint tabnum">
                {t("exp.usageCount", { count: category.usageCount })}
              </span>
              <Badge variant={category.isActive ? "success" : "neutral"} dot>
                {category.isActive ? t("exp.categoryActive") : t("exp.categoryInactive")}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void onToggle(category)}
              >
                {category.isActive ? t("exp.deactivateCategory") : t("exp.activateCategory")}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
