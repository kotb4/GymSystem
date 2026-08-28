import * as usersService from "../../src/core/services/users.service";
import { a, defineService, type Fn } from "./helpers";

export const users = defineService({
  listUsers: a(usersService.listUsers as Fn),
  createUser: a(usersService.createUser as Fn),
  updateUser: a(usersService.updateUser as Fn),
  resetPassword: a(usersService.resetPassword as Fn),
  setUserActive: a(usersService.setUserActive as Fn),
});
