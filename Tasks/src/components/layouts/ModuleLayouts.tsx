import { Navigate, Outlet } from 'react-router-dom';
import { useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlatformModules } from '../../contexts/PlatformModulesContext';
import Layout from '../Layout';
import {
  buildPmNav,
  buildAuthNav,
  buildCrmNav,
  buildMailNav,
  buildServiceNav,
  buildPortalAdminNav,
  buildInboxNav,
  buildHrmsNav,
  buildAccountsNav,
  buildContractsNav,
  buildBillingNav,
  buildAssetsNav,
  buildResourcesNav,
  buildProcurementNav,
  buildDocumentsNav,
  buildCalendarNav,
  buildCoreNav,
} from '../moduleNavigation';
import type { ModuleId } from '../../utils/moduleAccess';

type ModuleLayoutProps = {
  moduleTitle: string;
  moduleId: ModuleId;
  navBuilder: (user: Parameters<typeof buildPmNav>[0]) => ReturnType<typeof buildPmNav>;
};

function ModuleDisabledNotice({ title }: { title: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">{title} is disabled</h1>
      <p className="max-w-md text-[13px] text-[color:var(--text-muted)]">
        This module has been turned off for the entire platform. Contact a Core administrator to
        re-enable it.
      </p>
      <a
        href="/"
        className="mt-2 text-[13px] font-medium text-[color:var(--accent)] hover:underline"
      >
        Back to home
      </a>
    </div>
  );
}

function ModuleLayout({ moduleTitle, moduleId, navBuilder }: ModuleLayoutProps) {
  const { user } = useAuth();
  const { isEnabled, loading } = usePlatformModules();
  const navItems = useMemo(() => navBuilder(user), [navBuilder, user]);

  if (!loading && !isEnabled(moduleId)) {
    if (moduleId === 'core') {
      return <Navigate to="/" replace />;
    }
    return (
      <Layout navItems={[]} moduleTitle={moduleTitle}>
        <ModuleDisabledNotice title={moduleTitle} />
      </Layout>
    );
  }

  return (
    <Layout navItems={navItems} moduleTitle={moduleTitle}>
      <Outlet />
    </Layout>
  );
}

export function PmModuleLayout() {
  return <ModuleLayout moduleTitle="Project Manager" moduleId="pm" navBuilder={buildPmNav} />;
}

export function AuthModuleLayout() {
  return <ModuleLayout moduleTitle="Auth" moduleId="auth" navBuilder={buildAuthNav} />;
}

export function CrmModuleLayout() {
  return <ModuleLayout moduleTitle="CRM" moduleId="crm" navBuilder={buildCrmNav} />;
}

export function MailModuleLayout() {
  return <ModuleLayout moduleTitle="Mail" moduleId="mail" navBuilder={buildMailNav} />;
}

export function ServiceModuleLayout() {
  return <ModuleLayout moduleTitle="Service Desk" moduleId="service" navBuilder={buildServiceNav} />;
}

export function PortalAdminModuleLayout() {
  return (
    <ModuleLayout
      moduleTitle="Customer Portal"
      moduleId="portal-admin"
      navBuilder={buildPortalAdminNav}
    />
  );
}

export function InboxModuleLayout() {
  return <ModuleLayout moduleTitle="Inbox" moduleId="inbox" navBuilder={buildInboxNav} />;
}

export function HrmsModuleLayout() {
  return <ModuleLayout moduleTitle="HRMS" moduleId="hrms" navBuilder={buildHrmsNav} />;
}

export function AccountsModuleLayout() {
  return <ModuleLayout moduleTitle="Accounts" moduleId="accounts" navBuilder={buildAccountsNav} />;
}

export function ContractsModuleLayout() {
  return (
    <ModuleLayout moduleTitle="Contracts" moduleId="contracts" navBuilder={buildContractsNav} />
  );
}

export function BillingModuleLayout() {
  return <ModuleLayout moduleTitle="Billing" moduleId="billing" navBuilder={buildBillingNav} />;
}

export function AssetsModuleLayout() {
  return (
    <ModuleLayout moduleTitle="Assets & CMDB" moduleId="assets" navBuilder={buildAssetsNav} />
  );
}

export function ResourcesModuleLayout() {
  return (
    <ModuleLayout moduleTitle="Resources" moduleId="resources" navBuilder={buildResourcesNav} />
  );
}

export function ProcurementModuleLayout() {
  return (
    <ModuleLayout
      moduleTitle="Procurement"
      moduleId="procurement"
      navBuilder={buildProcurementNav}
    />
  );
}

export function DocumentsModuleLayout() {
  return (
    <ModuleLayout moduleTitle="Documents" moduleId="documents" navBuilder={buildDocumentsNav} />
  );
}

export function CalendarModuleLayout() {
  return (
    <ModuleLayout moduleTitle="Calendar" moduleId="calendar" navBuilder={buildCalendarNav} />
  );
}

export function CoreModuleLayout() {
  return <ModuleLayout moduleTitle="Core" moduleId="core" navBuilder={buildCoreNav} />;
}
