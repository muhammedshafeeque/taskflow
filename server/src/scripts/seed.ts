/**
 * Seed base catalog data: currencies, countries, country–currency mapping,
 * TaskFlow system roles, and default customer-org roles.
 * Run: npm run seed
 */
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { connectDb, disconnectDb } from '../config/db';
import { Currency } from '../modules/core/models/currency.model';
import { Country } from '../modules/core/models/country.model';
import { Role } from '../modules/roles/role.model';
import { CustomerOrg } from '../modules/customer-portal/customer-org/customerOrg.model';
import { CustomerRole } from '../modules/customer-portal/customer-role/customerRole.model';
import {
  ALL_CUSTOMER_PERMISSIONS,
  ALL_TASK_FLOW_PERMISSIONS,
  CUSTOMER_PERMISSIONS,
  TASK_FLOW_PERMISSIONS,
  flattenPermissions,
} from '../shared/constants/permissions';

const DATA_DIR = path.join(__dirname, '../modules/assets/dataFiles');

type JsonCurrency = {
  code: string;
  name: string;
  symbol: string;
  decimal_digits: number;
  countries?: string[];
};

const CURRENCY_NAME_ALIASES: Record<string, string> = {
  'united states dollar': 'USD',
  'us dollar': 'USD',
  dollar: 'USD',
  'pound sterling': 'GBP',
  sterling: 'GBP',
  'british pound sterling': 'GBP',
  rupiah: 'IDR',
  yuan: 'CNY',
  'renminbi': 'CNY',
  'won': 'KRW',
  'korean won': 'KRW',
  ruble: 'RUB',
  rouble: 'RUB',
  shekel: 'ILS',
  'new israeli shekel': 'ILS',
  dirham: 'AED',
  riyal: 'SAR',
  'uae dirham': 'AED',
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'text' in v) return String((v as { text: string }).text ?? '').trim();
  if (typeof v === 'object' && v !== null && 'result' in v) return String((v as { result: unknown }).result ?? '').trim();
  return String(v).trim();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((s) => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function seedCurrencies(): Promise<JsonCurrency[]> {
  const filePath = path.join(DATA_DIR, 'currencies.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as { currencies: JsonCurrency[] };
  const list = parsed.currencies ?? [];

  let upserted = 0;
  for (const c of list) {
    const code = String(c.code).trim().toUpperCase();
    if (!code) continue;
    await Currency.findOneAndUpdate(
      { code },
      {
        $set: {
          code,
          name: String(c.name).trim(),
          symbol: String(c.symbol).trim() || code,
          decimalDigits: Number(c.decimal_digits ?? 2),
          countries: Array.isArray(c.countries) ? c.countries.map(String) : [],
          isActive: true,
        },
      },
      { upsert: true, new: true }
    );
    upserted += 1;
  }

  await Currency.findOneAndUpdate(
    { code: 'USD' },
    {
      $setOnInsert: {
        code: 'USD',
        name: 'US Dollar',
        symbol: '$',
        decimalDigits: 2,
        countries: ['United States'],
        isActive: true,
      },
    },
    { upsert: true }
  );

  console.log(`Currencies: upserted ${upserted} from currencies.json`);
  return list;
}

async function seedCountries(): Promise<{ name: string; iso2: string; currencyLabel: string }[]> {
  const filePath = path.join(DATA_DIR, 'countries.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) {
    console.warn('Countries: no worksheet in countries.xlsx');
    return [];
  }

  const headerByCol = new Map<number, string>();
  ws.getRow(1).eachCell((cell, col) => {
    headerByCol.set(col, norm(cellStr(cell.value)));
  });

  const col = (key: string): number | undefined => {
    for (const [i, h] of headerByCol) {
      if (h === key || h.includes(key)) return i;
    }
    return undefined;
  };

  const nameCol = col('country') ?? 1;
  const iso2Col = col('iso2') ?? col('id');
  const currencyCol = col('currency');

  const rows: { name: string; iso2: string; currencyLabel: string }[] = [];
  let upserted = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = cellStr(row.getCell(nameCol).value);
    const iso2Raw = iso2Col ? cellStr(row.getCell(iso2Col).value) : '';
    const iso2 = iso2Raw.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);
    if (!name || iso2.length !== 2) continue;
    const currencyLabel = currencyCol ? cellStr(row.getCell(currencyCol).value) : '';
    rows.push({ name, iso2, currencyLabel });

    await Country.findOneAndUpdate(
      { iso2 },
      {
        $set: {
          iso2,
          name,
          isActive: true,
        },
        $setOnInsert: { currencyCodes: [] },
      },
      { upsert: true, new: true }
    );
    upserted += 1;
  }

  console.log(`Countries: upserted ${upserted} from countries.xlsx`);
  return rows;
}

function buildCurrencyResolvers(json: JsonCurrency[]) {
  const byCode = new Map<string, JsonCurrency>();
  const byName = new Map<string, string>();
  for (const c of json) {
    const code = String(c.code).trim().toUpperCase();
    if (!code) continue;
    byCode.set(code, c);
    byName.set(norm(c.name), code);
    byName.set(norm(code), code);
  }
  for (const [alias, code] of Object.entries(CURRENCY_NAME_ALIASES)) {
    if (!byName.has(alias) && byCode.has(code)) byName.set(alias, code);
  }

  const resolve = (label: string): string | undefined => {
    const n = norm(label);
    if (!n) return undefined;
    if (byName.has(n)) return byName.get(n);
    if (/^[a-z]{3}$/.test(n) && byCode.has(n.toUpperCase())) return n.toUpperCase();
    for (const [name, code] of byName) {
      if (name.length < 4) continue;
      if (n.includes(name) || name.includes(n)) return code;
    }
    return undefined;
  };

  return { byCode, resolve };
}

async function linkCountriesAndCurrencies(
  json: JsonCurrency[],
  xlsxRows: { name: string; iso2: string; currencyLabel: string }[]
) {
  const countries = await Country.find().lean();
  const byIso2 = new Map(countries.map((c) => [c.iso2, c]));
  const byName = new Map(countries.map((c) => [norm(c.name), c]));
  const { resolve } = buildCurrencyResolvers(json);

  const codesByIso2 = new Map<string, Set<string>>();
  const namesByCode = new Map<string, Set<string>>();
  const addLink = (iso2: string, code: string, catalogName: string) => {
    if (!codesByIso2.has(iso2)) codesByIso2.set(iso2, new Set());
    codesByIso2.get(iso2)!.add(code);
    if (!namesByCode.has(code)) namesByCode.set(code, new Set());
    namesByCode.get(code)!.add(catalogName);
  };

  let unmatchedJsonNames = 0;
  for (const c of json) {
    const code = String(c.code).trim().toUpperCase();
    for (const rawName of c.countries ?? []) {
      const found = byName.get(norm(String(rawName)));
      if (found) addLink(found.iso2, code, found.name);
      else {
        unmatchedJsonNames += 1;
        if (!namesByCode.has(code)) namesByCode.set(code, new Set());
        namesByCode.get(code)!.add(String(rawName).trim());
      }
    }
  }

  let unmatchedXlsxCurrency = 0;
  for (const row of xlsxRows) {
    const country = byIso2.get(row.iso2);
    if (!country) continue;
    const code = resolve(row.currencyLabel);
    if (!code) {
      if (row.currencyLabel) unmatchedXlsxCurrency += 1;
      continue;
    }
    addLink(row.iso2, code, country.name);
  }

  for (const [iso2, codes] of codesByIso2) {
    await Country.updateOne({ iso2 }, { $set: { currencyCodes: uniqueSorted([...codes]) } });
  }

  const allCurrencies = await Currency.find().select('code countries').lean();
  for (const cur of allCurrencies) {
    const extra = namesByCode.get(cur.code);
    if (!extra) continue;
    await Currency.updateOne(
      { code: cur.code },
      { $set: { countries: uniqueSorted([...extra]) } }
    );
  }

  console.log(
    `Mapping: linked ${codesByIso2.size} countries; unmatched JSON country names ${unmatchedJsonNames}; unmatched xlsx currency labels ${unmatchedXlsxCurrency}`
  );
}

async function seedTaskflowRoles() {
  const projectManagerPerms = [
    ...flattenPermissions(TASK_FLOW_PERMISSIONS.PROJECT as unknown as Record<string, unknown>),
    TASK_FLOW_PERMISSIONS.AUTH.USER.READ,
    TASK_FLOW_PERMISSIONS.AUTH.USER.LIST,
    ...flattenPermissions(TASK_FLOW_PERMISSIONS.TASKFLOW.MONITOR as unknown as Record<string, unknown>),
  ];
  const developerPerms = [
    TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.READ,
    TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.LIST,
    TASK_FLOW_PERMISSIONS.PROJECT.MEMBER.READ,
    ...flattenPermissions(TASK_FLOW_PERMISSIONS.TASKFLOW.MONITOR as unknown as Record<string, unknown>),
  ];
  const viewerPerms = [
    TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.READ,
    TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.LIST,
  ];
  const orgManagerPerms = [
    ...flattenPermissions(TASK_FLOW_PERMISSIONS.ORG as unknown as Record<string, unknown>),
    ...flattenPermissions(TASK_FLOW_PERMISSIONS.TASKFLOW.CORE as unknown as Record<string, unknown>),
  ];
  const coreReadPerms = [
    TASK_FLOW_PERMISSIONS.TASKFLOW.CORE.COMPANY.READ,
    TASK_FLOW_PERMISSIONS.TASKFLOW.CORE.CURRENCY.READ,
    TASK_FLOW_PERMISSIONS.TASKFLOW.CORE.EXCHANGE_RATE.READ,
  ];
  const salesPerms = [
    ...flattenPermissions(TASK_FLOW_PERMISSIONS.TASKFLOW.CRM as unknown as Record<string, unknown>),
    ...coreReadPerms,
  ];
  const supportAgentPerms = [
    ...flattenPermissions(TASK_FLOW_PERMISSIONS.TASKFLOW.SERVICE as unknown as Record<string, unknown>),
    TASK_FLOW_PERMISSIONS.TASKFLOW.CRM.ACCOUNT.READ,
    TASK_FLOW_PERMISSIONS.TASKFLOW.CRM.ACCOUNT.LIST,
    TASK_FLOW_PERMISSIONS.TASKFLOW.CRM.CONTACT.READ,
    TASK_FLOW_PERMISSIONS.TASKFLOW.CRM.CONTACT.LIST,
    TASK_FLOW_PERMISSIONS.TASKFLOW.MAIL.MAILBOX.READ,
    TASK_FLOW_PERMISSIONS.TASKFLOW.MAIL.MESSAGE.READ,
  ];
  const crmAdminPerms = [
    ...salesPerms,
    ...flattenPermissions(TASK_FLOW_PERMISSIONS.TASKFLOW.SERVICE as unknown as Record<string, unknown>),
    ...flattenPermissions(TASK_FLOW_PERMISSIONS.TASKFLOW.MAIL as unknown as Record<string, unknown>),
    TASK_FLOW_PERMISSIONS.TASKFLOW.CRM.SETTINGS.MANAGE,
  ];

  const seeds: Array<{ code: string; name: string; permissions: string[]; isSystem: boolean }> = [
    { code: 'super_admin', name: 'Super Admin', permissions: [...ALL_TASK_FLOW_PERMISSIONS], isSystem: true },
    { code: 'project_manager', name: 'Project Manager', permissions: projectManagerPerms, isSystem: true },
    { code: 'developer', name: 'Developer', permissions: developerPerms, isSystem: true },
    { code: 'viewer', name: 'Viewer', permissions: viewerPerms, isSystem: true },
    { code: 'org_manager', name: 'Org Manager', permissions: orgManagerPerms, isSystem: true },
    { code: 'sales', name: 'Sales', permissions: salesPerms, isSystem: true },
    { code: 'account_manager', name: 'Account Manager', permissions: salesPerms, isSystem: true },
    { code: 'support_agent', name: 'Support Agent', permissions: supportAgentPerms, isSystem: true },
    { code: 'crm_admin', name: 'CRM Admin', permissions: crmAdminPerms, isSystem: true },
  ];

  for (const s of seeds) {
    await Role.findOneAndUpdate(
      { code: s.code },
      { $set: { name: s.name, permissions: s.permissions, isSystem: s.isSystem } },
      { upsert: true, new: true }
    );
  }
  console.log(`Roles: upserted ${seeds.length} TaskFlow system roles`);
}

async function seedOrgCustomerRoles() {
  const issueBlock = flattenPermissions(CUSTOMER_PERMISSIONS.ISSUE as unknown as Record<string, unknown>);
  const orgMemberPerms = [
    CUSTOMER_PERMISSIONS.PROJECT.PROJECT.READ,
    CUSTOMER_PERMISSIONS.PROJECT.PROJECT.LIST,
    ...issueBlock,
  ];
  const orgViewerPerms = [
    CUSTOMER_PERMISSIONS.PROJECT.PROJECT.READ,
    CUSTOMER_PERMISSIONS.PROJECT.PROJECT.LIST,
    CUSTOMER_PERMISSIONS.ISSUE.ISSUE.READ,
    CUSTOMER_PERMISSIONS.ISSUE.ISSUE.LIST,
  ];

  const orgs = await CustomerOrg.find().select('_id').lean();
  let count = 0;
  for (const org of orgs) {
    const templates: Array<{ name: string; permissions: string[]; isSystemRole: boolean }> = [
      { name: 'Org Admin', permissions: [...ALL_CUSTOMER_PERMISSIONS], isSystemRole: true },
      { name: 'Org Member', permissions: orgMemberPerms, isSystemRole: true },
      { name: 'Org Viewer', permissions: orgViewerPerms, isSystemRole: true },
    ];
    for (const t of templates) {
      await CustomerRole.findOneAndUpdate(
        { customerOrgId: org._id, name: t.name },
        {
          $set: { permissions: t.permissions, isSystemRole: t.isSystemRole },
          $setOnInsert: { name: t.name, isDefault: false },
        },
        { upsert: true, new: true }
      );
      count += 1;
    }
  }
  console.log(`Customer roles: upserted ${count} roles across ${orgs.length} orgs`);
}

async function main() {
  await connectDb();
  const json = await seedCurrencies();
  const xlsxRows = await seedCountries();
  await linkCountriesAndCurrencies(json, xlsxRows);
  // Roles are company data: create them in Auth → Roles. Starter templates are opt-in.
  const withTemplates = process.argv.includes('--role-templates') || process.env.SEED_ROLE_TEMPLATES === 'true';
  if (withTemplates) {
    await seedTaskflowRoles();
    await seedOrgCustomerRoles();
  } else {
    console.log('Skipping role templates (run with --role-templates to add starter roles).');
  }
  await disconnectDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
