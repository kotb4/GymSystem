import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ar } from "./ar";

export type TFunction = (key: string, vars?: Record<string, unknown>) => string;

function flatten(obj: unknown, prefix = "", map = new Map<string, string>()) {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, map);
    }
  } else {
    map.set(prefix, String(obj));
  }
  return map;
}

const flat = flatten(ar);

function translate(key: string, vars?: Record<string, unknown>): string {
  let text = flat.get(key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

interface I18nContextValue {
  lang: "ar";
  dir: "rtl";
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "ar",
  dir: "rtl",
  t: translate,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({ lang: "ar" as const, dir: "rtl" as const, t: translate }),
    []
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT(): TFunction {
  return useContext(I18nContext).t;
}
