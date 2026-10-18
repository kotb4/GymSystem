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
import { ReferralsPage } from "@/pages/referrals-page";
import { MessagesPage } from "@/pages/messages-page";
import { TreasuryPage } from "@/pages/treasury";
import { DeveloperPage } from "@/pages/developer-page";
import { QuickSessionsPage } from "@/pages/quick-sessions-page";
import { DebtsPage } from "@/pages/debts-page";
import { PurchasesPage } from "@/pages/purchases-page";
import { PrivateTrainingPage } from "@/pages/private-training-page";
import { MemberPortalPage } from "@/pages/member-portal-page";

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

function RequirePermission({
  permission,
  permissions,
  featureFlag,
  children,
}: {
  permission?: Permission;
  permissions?: Permission[];
  featureFlag?: string;
  children: ReactNode;
}) {
  const { hasPermission, isFeatureEnabled } = useAuth();
  if (featureFlag && !isFeatureEnabled(featureFlag)) {
    return <ForbiddenView />;
  }
  if (permissions) {
    if (!permissions.some((p) => hasPermission(p))) return <ForbiddenView />;
  } else if (permission && !hasPermission(permission)) {
    return <ForbiddenView />;
  }
  return <>{children}</>;
}

export function AppRoutes() {
  const { user, booting, needsSetup } = useAuth();
  const license = useLicense();
  if (booting) return null;
  // ADR-019 / ADR-022: when the license needs activation or is hard-locked
  // (expired / tampered / invalid), block the app and show the license screen.
  // expired = TOTAL lockdown → the activation surface is the ONLY reachable
  // screen; login/setup are not rendered (activate/deactivate are plain,
  // unauthenticated functions so activation still works).
  const isDev = user?.isDeveloper === true;
  const licenseBlocked =
    license.status != null && (license.status.needsActivation || license.status.readOnly);
  if (licenseBlocked && license.status && !isDev) {
    return (
      <Routes>
        <Route path="*" element={<LicensePage />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : needsSetup ? <Navigate to="/setup" replace /> : <LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/portal" element={<MemberPortalPage />} />
      <Route path="/member-portal" element={<MemberPortalPage />} />
      <Route path="/profile" element={<MemberPortalPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route
          path="members"
          element={
            <RequirePermission permission="members.view" featureFlag="featureMembersEnabled">
              <MembersPage />
            </RequirePermission>
          }
        />
        <Route
          path="members/:memberId"
          element={
            <RequirePermission permission="members.view" featureFlag="featureMembersEnabled">
              <MemberProfilePage />
            </RequirePermission>
          }
        />
        <Route
          path="attendance"
          element={
            <RequirePermission permission="reception.view" featureFlag="featureAttendanceEnabled">
              <ReceptionPage />
            </RequirePermission>
          }
        />
        <Route
          path="quick-sessions"
          element={
            <RequirePermission permission="quick_sessions.view">
              <QuickSessionsPage />
            </RequirePermission>
          }
        />
        <Route
          path="debts"
          element={
            <RequirePermission permission="debts.view">
              <DebtsPage />
            </RequirePermission>
          }
        />
        <Route
          path="purchases"
          element={
            <RequirePermission permission="purchases.view">
              <PurchasesPage />
            </RequirePermission>
          }
        />
        <Route
          path="private-training"
          element={
            <RequirePermission permission="private_training.view">
              <PrivateTrainingPage />
            </RequirePermission>
          }
        />
        <Route
          path="subscriptions"
          element={
            <RequirePermission permission="subscriptions.view" featureFlag="featureSubscriptionsEnabled">
              <SubscriptionsPage />
            </RequirePermission>
          }
        />
        <Route
          path="doc-search"
          element={<Navigate to="/" replace />}
        />
        <Route
          path="payments"
          element={
            <RequirePermission permission="payments.view" featureFlag="featureTreasuryEnabled">
              <PaymentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="expenses"
          element={
            <RequirePermission permission="expenses.view" featureFlag="featureExpensesEnabled">
              <ExpensesPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission permission="reports.view" featureFlag="featureReportsEnabled">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="store"
          element={
            <RequirePermission permission="store.view" featureFlag="featurePosEnabled">
              <StorePage />
            </RequirePermission>
          }
        />
        <Route
          path="trainers"
          element={
            <RequirePermission permission="trainers.view" featureFlag="featureClassesEnabled">
              <ClassesPage initialTab="trainers" />
            </RequirePermission>
          }
        />
        <Route
          path="classes"
          element={
            <RequirePermission permissions={["classes.view", "trainers.view"]} featureFlag="featureClassesEnabled">
              <ClassesPage />
            </RequirePermission>
          }
        />
        <Route
          path="employees"
          element={
            <RequirePermission permissions={["employees.view", "hr.view"]} featureFlag="featureEmployeesEnabled">
              <EmployeesPage />
            </RequirePermission>
          }
        />
        <Route
          path="employee-checkin"
          element={
            <RequirePermission permission="hr.employee_checkin" featureFlag="featureHrCheckinEnabled">
              <EmployeeCheckInPage />
            </RequirePermission>
          }
        />
        <Route
          path="crm"
          element={
            <RequirePermission permissions={["leads.view", "trials.view"]} featureFlag="featureCrmEnabled">
              <CrmPage />
            </RequirePermission>
          }
        />
        <Route
          path="cards"
          element={
            <RequirePermission permission="cards.view" featureFlag="featureCardsEnabled">
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
            <RequirePermission permissions={["loyalty.view", "loyalty.manage"]} featureFlag="featureLoyaltyEnabled">
              <LoyaltyPage />
            </RequirePermission>
          }
        />
        <Route
          path="referrals"
          element={
            <RequirePermission permission="referrals.view" featureFlag="featureReferralsEnabled">
              <ReferralsPage />
            </RequirePermission>
          }
        />
        <Route
          path="messages"
          element={
            <RequirePermission permission="messages.view" featureFlag="featureWhatsappEnabled">
              <MessagesPage />
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
            <RequirePermission permission="payments.view" featureFlag="featureTreasuryEnabled">
              <TreasuryPage />
            </RequirePermission>
          }
        />
        <Route
          path="developer"
          element={
            user?.isDeveloper ? <DeveloperPage /> : <Navigate to="/" replace />
          }
        />
        <Route path="trainer-attendance" element={<Navigate to="/classes?tab=trainers" replace />} />
        {/* Navigation Aliases for Natural Access */}
        <Route path="reception" element={<Navigate to="/attendance" replace />} />
        <Route path="pos" element={<Navigate to="/store" replace />} />
        <Route path="cash" element={<Navigate to="/treasury" replace />} />
        <Route path="hr" element={<Navigate to="/employees" replace />} />
        <Route path="leads" element={<Navigate to="/crm" replace />} />
        <Route path="trials" element={<Navigate to="/crm" replace />} />
        <Route path="whatsapp" element={<Navigate to="/messages" replace />} />
        <Route path="users" element={<Navigate to="/staff" replace />} />
        <Route path="permissions" element={<Navigate to="/staff" replace />} />
        <Route path="backups" element={<Navigate to="/settings" replace />} />
        <Route path="backup" element={<Navigate to="/settings" replace />} />
       </Route>
       <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
