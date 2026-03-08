import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  const { className, children, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className ?? 'w-4 h-4'}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 21h6v-5H4v5Zm10-17v5h6V4h-6Z" />
    </BaseIcon>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 7.5 7.5 4h9L20 7.5v9L16.5 20h-9L4 16.5v-9Z" />
      <path d="M4 13h3l2 2h6l2-2h3" />
    </BaseIcon>
  );
}

export function ProjectsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="5" rx="1.5" />
      <rect x="13" y="11" width="7" height="9" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
    </BaseIcon>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M4 18.5C4.7 15.9 6.6 14 9 14s4.3 1.9 5 4.5" />
      <path d="M13.5 18.5c.5-1.8 1.8-3 3.5-3 1.6 0 3 1.2 3.5 3" />
    </BaseIcon>
  );
}

export function DesignationsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6 5h12" />
      <path d="M6 10h12" />
      <path d="M6 15h8" />
      <path d="M6 19h5" />
      <circle cx="4" cy="5" r="1" />
      <circle cx="4" cy="10" r="1" />
      <circle cx="4" cy="15" r="1" />
      <circle cx="4" cy="19" r="1" />
    </BaseIcon>
  );
}

export function RolesIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M7.5 11.5a3 3 0 1 1 3-3" />
      <path d="M4 20v-.5C4 16.6 5.8 15 8 15c.7 0 1.3.1 1.9.4" />
      <rect x="13" y="5" width="7" height="6" rx="1.5" />
      <path d="M14.5 20h4a1.5 1.5 0 0 0 1.5-1.5V15H13v3.5A1.5 1.5 0 0 0 14.5 20Z" />
    </BaseIcon>
  );
}

export function ProfileIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19c1.2-2.3 3.4-3.8 7-3.8s5.8 1.5 7 3.8" />
    </BaseIcon>
  );
}

export function IssuesIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </BaseIcon>
  );
}

export function BoardsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="5" width="4" height="14" rx="1.2" />
      <rect x="10" y="5" width="4" height="9" rx="1.2" />
      <rect x="16" y="5" width="4" height="6" rx="1.2" />
    </BaseIcon>
  );
}

export function SprintsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 12h7a3 3 0 0 0 0-6H9" />
      <path d="M5 18h9a3 3 0 1 0 0-6H8" />
      <path d="M5 6h3M5 18h3" />
    </BaseIcon>
  );
}

export function GanttIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="7" width="8" height="3" rx="0.5" />
      <rect x="4" y="13" width="14" height="3" rx="0.5" />
      <rect x="4" y="19" width="6" height="3" rx="0.5" />
    </BaseIcon>
  );
}

export function VersionsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="5" width="16" height="4" rx="1.2" />
      <rect x="4" y="11" width="16" height="4" rx="1.2" />
      <rect x="4" y="17" width="10" height="3" rx="1.2" />
    </BaseIcon>
  );
}

export function TimesheetIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v4l3 2" />
    </BaseIcon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M4.5 13.5 3 12l1.5-1.5M19.5 10.5 21 12l-1.5 1.5M9.5 4.2 10 3h4l.5 1.2M9.5 19.8 10 21h4l.5-1.2" />
    </BaseIcon>
  );
}

export function TestCasesIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2" />
      <path d="M9 12l2 2 4-4" />
    </BaseIcon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="11" cy="11" r="5" />
      <path d="m15 15 3.5 3.5" />
    </BaseIcon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2.5M12 18.5V21M5 12H2.5M21.5 12H19M6.3 6.3 4.7 4.7M19.3 19.3l-1.6-1.6M6.3 17.7 4.7 19.3M19.3 4.7 17.7 6.3" />
    </BaseIcon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M18 13.5A6.5 6.5 0 0 1 10.5 6 5.5 5.5 0 1 0 18 13.5Z" />
    </BaseIcon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </BaseIcon>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 4 4 18h16L12 4Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.5" r="0.7" />
    </BaseIcon>
  );
}

export function PackageIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4.5 7.5 12 3l7.5 4.5v9L12 21l-7.5-4.5v-9Z" />
      <path d="M4.5 7.5 12 12l7.5-4.5" />
      <path d="M12 12v9" />
    </BaseIcon>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6 15.5V18h2.5L18 8.5 15.5 6 6 15.5Z" />
      <path d="M12.5 7.5 16 11" />
    </BaseIcon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6 7h12" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <rect x="7" y="7" width="10" height="11" rx="1.8" />
    </BaseIcon>
  );
}

export function EnableIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 12l2.5 2.5L15 10" />
    </BaseIcon>
  );
}

export function DisableIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </BaseIcon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6 9l6 6 6-6" />
    </BaseIcon>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M18 15l-6-6-6 6" />
    </BaseIcon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M15 18l-6-6 6-6" />
    </BaseIcon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 6l6 6-6 6" />
    </BaseIcon>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </BaseIcon>
  );
}

