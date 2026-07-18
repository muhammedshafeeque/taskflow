import { Outlet } from 'react-router-dom';
import { useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
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
} from '../moduleNavigation';

type ModuleLayoutProps = {
  moduleTitle: string;
  navBuilder: (user: Parameters<typeof buildPmNav>[0]) => ReturnType<typeof buildPmNav>;
};

function ModuleLayout({ moduleTitle, navBuilder }: ModuleLayoutProps) {
  const { user } = useAuth();
  const navItems = useMemo(() => navBuilder(user), [navBuilder, user]);
  return (
    <Layout navItems={navItems} moduleTitle={moduleTitle}>
      <Outlet />
    </Layout>
  );
}

export function PmModuleLayout() {
  return <ModuleLayout moduleTitle="Project Manager" navBuilder={buildPmNav} />;
}

export function AuthModuleLayout() {
  return <ModuleLayout moduleTitle="Auth" navBuilder={buildAuthNav} />;
}

export function CrmModuleLayout() {
  return <ModuleLayout moduleTitle="CRM" navBuilder={buildCrmNav} />;
}

export function MailModuleLayout() {
  return <ModuleLayout moduleTitle="Mail" navBuilder={buildMailNav} />;
}

export function ServiceModuleLayout() {
  return <ModuleLayout moduleTitle="Service Desk" navBuilder={buildServiceNav} />;
}

export function PortalAdminModuleLayout() {
  return <ModuleLayout moduleTitle="Customer Portal" navBuilder={buildPortalAdminNav} />;
}

export function InboxModuleLayout() {
  return <ModuleLayout moduleTitle="Inbox" navBuilder={buildInboxNav} />;
}

export function HrmsModuleLayout() {
  return <ModuleLayout moduleTitle="HRMS" navBuilder={buildHrmsNav} />;
}

export function AccountsModuleLayout() {
  return <ModuleLayout moduleTitle="Accounts" navBuilder={buildAccountsNav} />;
}

export function ContractsModuleLayout() {
  return <ModuleLayout moduleTitle="Contracts" navBuilder={buildContractsNav} />;
}

export function BillingModuleLayout() {
  return <ModuleLayout moduleTitle="Billing" navBuilder={buildBillingNav} />;
}

export function AssetsModuleLayout() {
  return <ModuleLayout moduleTitle="Assets & CMDB" navBuilder={buildAssetsNav} />;
}

export function ResourcesModuleLayout() {
  return <ModuleLayout moduleTitle="Resources" navBuilder={buildResourcesNav} />;
}

export function ProcurementModuleLayout() {
  return <ModuleLayout moduleTitle="Procurement" navBuilder={buildProcurementNav} />;
}

export function DocumentsModuleLayout() {
  return <ModuleLayout moduleTitle="Documents" navBuilder={buildDocumentsNav} />;
}

export function CalendarModuleLayout() {
  return <ModuleLayout moduleTitle="Calendar" navBuilder={buildCalendarNav} />;
}
