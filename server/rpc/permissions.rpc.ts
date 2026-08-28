import * as permissionsService from "../../src/core/services/permissions.service";
import { a, defineService, type Fn } from "./helpers";

export const permissions = defineService({
  getRolePermissions: a(permissionsService.getRolePermissions as Fn),
  getAllPermissions: a(permissionsService.getAllPermissions as Fn),
  setRolePermissions: a(permissionsService.setRolePermissions as Fn),
});
