import * as vouchers from "../../src/core/services/vouchers.service";
import { a, defineService, type Fn } from "./helpers";

export const vouchersService = defineService({
  generateOperationVoucher: a(vouchers.generateOperationVoucher as Fn),
});
