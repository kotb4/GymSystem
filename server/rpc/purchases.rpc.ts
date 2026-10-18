import * as purchasesService from "../../src/core/services/purchases.service";
import { a, defineService, type Fn } from "./helpers";

export const purchases = defineService({
  createSupplier: a(purchasesService.createSupplier as Fn),
  updateSupplier: a(purchasesService.updateSupplier as Fn),
  getSupplierById: a(purchasesService.getSupplierById as Fn),
  listSuppliers: a(purchasesService.listSuppliers as Fn),
  createInvoice: a(purchasesService.createPurchaseInvoice as Fn),
  getInvoiceById: a(purchasesService.getPurchaseInvoiceById as Fn),
  listInvoices: a(purchasesService.listPurchaseInvoices as Fn),
  payInvoiceDebt: a(purchasesService.payPurchaseInvoiceDebt as Fn),
});
