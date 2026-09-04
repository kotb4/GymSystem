import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "@fontsource-variable/cairo";
import "./index.css";
import { I18nProvider } from "@/i18n";
import { AuthProvider } from "@/contexts/auth-context";
import { LicenseProvider } from "@/contexts/license-context";
import { ToastProvider } from "@/components/ui/toast";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { AppRoutes } from "@/routes";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <HashRouter>
          <AuthProvider>
            <LicenseProvider>
              <ErrorBoundary>
                <AppRoutes />
              </ErrorBoundary>
            </LicenseProvider>
          </AuthProvider>
        </HashRouter>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>
);
