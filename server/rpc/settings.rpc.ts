import * as settingsService from "../../src/core/services/settings.service";
import { a, p, defineService, type Fn } from "./helpers";

export const settings = defineService({
  readAllSettings: a(settingsService.readAllSettings as Fn),
  updateSetting: a(settingsService.updateSetting as Fn),
  getScannerConfig: p(settingsService.getScannerConfig as Fn),
  isSoundEnabled: p(settingsService.isSoundEnabled as Fn),
  getBackupConfig: a(settingsService.getBackupConfig as Fn),
  getWorkingDays: p(settingsService.getWorkingDays as Fn),
  getInactiveDays: p(settingsService.getInactiveDays as Fn),
  isCheckoutEnabled: p(settingsService.isCheckoutEnabled as Fn),
  freezeExtendsExpiry: p(settingsService.freezeExtendsExpiry as Fn),
});
