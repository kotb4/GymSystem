import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type LicenseStatus } from "@/api";

interface LicenseContextValue {
  /** true until the first status round-trip finishes */
  booting: boolean;
  status: LicenseStatus | null;
  refresh: () => void;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<LicenseStatus | null>(null);

  const refresh = useCallback(() => {
    api.license
      .status()
      .then((s) => setStatus(s))
      .catch(() => setStatus(null))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <LicenseContext.Provider value={{ booting, status, refresh }}>
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicense(): LicenseContextValue {
  const value = useContext(LicenseContext);
  if (!value) throw new Error("useLicense must be used within LicenseProvider");
  return value;
}