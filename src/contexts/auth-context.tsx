import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Permission, RoleId } from "@/core/permissions";
import { roleHasPermission } from "@/core/permissions";
import { postJson } from "@/api/client";
import { api } from "@/api";
import type { PublicUser } from "@/core/services/users.service";
import { useT } from "@/i18n";
import { describeError } from "@/utils/app-error";

export interface SetupFormInput {
  gymName: string;
  ownerFullName: string;
  username: string;
  password: string;
}

export interface AuthActionResult {
  ok: boolean;
  error: string | null;
}

interface AuthContextValue {
  /** true until the first /api/auth/me round-trip finishes */
  booting: boolean;
  user: PublicUser | null;
  actor: {
    userId: string;
    username: string;
    fullName?: string;
    roleId: RoleId;
    department?: "general" | "men" | "women";
  } | null;
  needsSetup: boolean;
  hasPermission: (permission: Permission) => boolean;
  login: (username: string, password: string) => Promise<AuthActionResult>;
  setup: (input: SetupFormInput) => Promise<AuthActionResult>;
  logout: () => void;
  refreshNeedsSetup: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.auth.me();
        if (!alive) return;
        setNeedsSetup(me.needsSetup);
        setUser((me.user as PublicUser | null) ?? null);
      } catch {
        if (alive) setUser(null);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const actor = useMemo(
    () =>
      user
        ? {
            userId: user.id,
            username: user.username,
            fullName: user.fullName,
            roleId: user.roleId,
            department: user.department,
          }
        : null,
    [user]
  );

  const hasPermission = useCallback(
    (permission: Permission) => (actor ? roleHasPermission(actor.roleId, permission) : false),
    [actor]
  );

  const applySession = useCallback((loggedIn: PublicUser) => {
    setUser(loggedIn);
    setNeedsSetup(false);
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<AuthActionResult> => {
      try {
        const loggedIn = await postJson<PublicUser>("/api/auth/login", { input: { username, password } });
        applySession(loggedIn);
        return { ok: true, error: null };
      } catch (err) {
        return { ok: false, error: describeError(err, t) };
      }
    },
    [applySession, t]
  );

  const setup = useCallback(
    async (input: SetupFormInput): Promise<AuthActionResult> => {
      try {
        const owner = await postJson<PublicUser>("/api/auth/setup", { input });
        applySession(owner);
        return { ok: true, error: null };
      } catch (err) {
        return { ok: false, error: describeError(err, t) };
      }
    },
    [applySession, t]
  );

  const logout = useCallback(() => {
    void postJson("/api/auth/logout", {}).catch(() => undefined);
    setUser(null);
  }, []);

  const refreshNeedsSetup = useCallback(() => {
    api.auth
      .me()
      .then((me) => setNeedsSetup(me.needsSetup))
      .catch(() => undefined);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      booting,
      user,
      actor,
      needsSetup,
      hasPermission,
      login,
      setup,
      logout,
      refreshNeedsSetup,
    }),
    [booting, user, actor, needsSetup, hasPermission, login, setup, logout, refreshNeedsSetup]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
