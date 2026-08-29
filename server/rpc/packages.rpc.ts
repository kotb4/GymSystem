import * as packagesService from "../../src/core/services/packages.service";
import { a, defineService, type Fn } from "./helpers";

export const packages = defineService({
  listPackages: a(packagesService.listPackages as Fn),
  getPackage: a(packagesService.getPackage as Fn),
  createPackage: a(packagesService.createPackage as Fn),
  updatePackage: a(packagesService.updatePackage as Fn),
  setPackageActive: a(packagesService.setPackageActive as Fn),
  duplicatePackage: a(packagesService.duplicatePackage as Fn),
  packageStats: a(packagesService.packageStats as Fn),
});
