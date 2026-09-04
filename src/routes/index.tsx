import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { ShieldOff } from "lucide-react";
import type { Permission } from "@/core/permissions";
import { useAuth } from "@/contexts/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/i18n";
import { useLicense } from "@/contexts/license-context";
import { LicensePage } from "@/pages/license-page";
import { LoginPage } from "@/pages/login-page";
import { SetupPage } from "@/pages/setup-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { ReceptionPage } from "@/pages/reception-page";
import { MembersPage } from "@/pages/members-page";
import { MemberProfilePage } from "@/pages/member-profile-page";
import { SubscriptionsPage } from "@/pages/subscriptions-page";
import { CardsPage } from "@/pages/cards-page";
import { StaffPage } from "@/pages/staff-page";
import { AuditPage } from "@/pages/audit-page";
import { SettingsPage } from "@/pages/settings-page";
import { PaymentsPage } from "@/pages/payments-page";
import { ExpensesPage } from "@/pages/expenses-page";
import { ReportsPage } from "@/pages/reports-page";
import { StorePage } from "@/pages/store-page";
import { ClassesPage } from "@/pages/classes-page";
import { EmployeesPage } from "@/pages/employees-page";
import { EmployeeCheckInPage } from "@/pages/employee-checkin-page";
import { CrmPage } from "@/pages/crm-page";
import { LoyaltyPage } from "@/pages/loyalty-page";
import { TreasuryPage } from "@/pages/treasury";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, booting } = useAuth();
  const location = useLocation();
  if (booting) {
    return (
      <div className="grid min-h-screen place-items-center bg-base">
        <span aria-hidden className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-neon" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function ForbiddenView() {
  const t = useT();
  return (
    <EmptyState
      icon={<ShieldOff />}
      title={t("errors.forbidden")}
      description={t("placeholder.desc")}
    />
  );
}

function RequirePermission({ permission, permissions, children }: { permission?: Permission; permissions?: Permission[]; children: ReactNode }) {
  const { hasPermission } = useAuth();
  if (permissions) {
    if (!permissions.some((p) => hasPermission(p))) return <ForbiddenView />;
  } else if (!permission || !hasPermission(permission)) {
    return <ForbiddenView />;
  }
  return <>{children}</>;
}

export function AppRoutes() {
  const { user, booting, needsSetup } = useAuth();
  const license = useLicense();
  if (booting) return null;
  // ADR-019: when the license needs activation or is hard-locked (expired
  // past grace / tampered / invalid), block the app and show the license
  // screen. Login (for activation) and setup remain reachable.
  const licenseBlocked =
    license.status != null && (license.status.needsActivation || license.status.readOnly);
  if (licenseBlocked && license.status) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<LicensePage />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : needsSetup ? <Navigate to="/setup" replace /> : <LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="members/:memberId" element={<MemberProfilePage />} />
        <Route
          path="attendance"
          element={
            <RequirePermission permission="reception.view">
              <ReceptionPage />
            </RequirePermission>
          }
        />
        <Route
          path="subscriptions"
          element={
            <RequirePermission permission="subscriptions.view">
              <SubscriptionsPage />
            </RequirePermission>
          }
        />
        <Route
          path="payments"
          element={
            <RequirePermission permission="payments.view">
              <PaymentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="expenses"
          element={
            <RequirePermission permission="expenses.view">
              <ExpensesPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission permission="reports.view">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="store"
          element={
            <RequirePermission permission="store.view">
              <StorePage />
            </RequirePermission>
          }
        />
        <Route
          path="classes"
          element={
            <RequirePermission permissions={["classes.view", "trainers.view"]}>
              <ClassesPage />
            </RequirePermission>
          }
        />
        <Route
          path="employees"
          element={
            <RequirePermission permissions={["employees.view", "hr.view"]}>
              <EmployeesPage />
            </RequirePermission>
          }
        />
        <Route
          path="employee-checkin"
          element={
            <RequirePermission permission="hr.employee_checkin">
              <EmployeeCheckInPage />
            </RequirePermission>
          }
        />
        <Route
          path="crm"
          element={
            <RequirePermission permissions={["crm.send", "leads.view", "trials.view"]}>
              <CrmPage />
            </RequirePermission>
          }
        />
        <Route
          path="cards"
          element={
            <RequirePermission permission="cards.view">
              <CardsPage />
            </RequirePermission>
          }
        />
        <Route
          path="staff"
          element={
            <RequirePermission permission="users.view">
              <StaffPage />
            </RequirePermission>
          }
        />
        <Route
          path="loyalty"
          element={
            <RequirePermission permission="loyalty.manage">
              <LoyaltyPage />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission permission="audit.view">
              <AuditPage />
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission permission="settings.view">
              <SettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="treasury"
          element={
            <RequirePermission permission="payments.view">
              <TreasuryPage />
            </RequirePermission>
          }
        />
       </Route>
       <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
