import * as paymentsService from "../../src/core/services/payments.service";
import { a, p, defineService, type Fn } from "./helpers";

export const payments = defineService({
  getPaymentById: a(paymentsService.getPaymentById as Fn),
  recordPayment: a(paymentsService.recordPayment as Fn),
  refundPayment: a(paymentsService.refundPayment as Fn),
  voidPayment: a(paymentsService.voidPayment as Fn),
  unvoidPayment: a(paymentsService.unvoidPayment as Fn),
  undoRefund: a(paymentsService.undoRefund as Fn),
  getSubscriptionBalance: a(paymentsService.getSubscriptionBalance as Fn),
  listPayments: a(paymentsService.listPayments as Fn),
  listActiveMethods: p(paymentsService.listActiveMethods as Fn),
});
