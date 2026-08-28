import * as storeService from "../../src/core/services/store.service";
import { a, defineService, type Fn } from "./helpers";

export const store = defineService({
  listProductCategories: a(storeService.listProductCategories as Fn),
  createProductCategory: a(storeService.createProductCategory as Fn),
  setProductCategoryActive: a(storeService.setProductCategoryActive as Fn),
  purgeProduct: a(storeService.purgeProduct as Fn),
  listProducts: a(storeService.listProducts as Fn),
  getProduct: a(storeService.getProduct as Fn),
  createProduct: a(storeService.createProduct as Fn),
  updateProduct: a(storeService.updateProduct as Fn),
  adjustStock: a(storeService.adjustStock as Fn),
  listStockMovements: a(storeService.listStockMovements as Fn),
  createSale: a(storeService.createSale as Fn),
  getSale: a(storeService.getSale as Fn),
  listSales: a(storeService.listSales as Fn),
  voidStoreSale: a(storeService.voidStoreSale as Fn),
  unvoidStoreSale: a(storeService.unvoidStoreSale as Fn),
  listStoreDebts: a(storeService.listStoreDebts as Fn),
  repayStoreDebt: a(storeService.repayStoreDebt as Fn),
  getMemberStoreDebtTotal: a(storeService.getMemberStoreDebtTotal as Fn),
  getStoreStats: a(storeService.getStoreStats as Fn),
});
