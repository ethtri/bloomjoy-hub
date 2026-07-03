import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const includes = (relativePath, needle, message) => {
  const source = read(relativePath);
  assert(source.includes(needle), `${message}\nMissing in ${relativePath}: ${needle}`);
  return source;
};

const authenticatedNavigation = includes(
  'src/components/layout/authenticatedNavigation.ts',
  "if (item.href === '/admin')",
  'Admin overview must use exact active matching so child admin routes do not create two current nav items.',
);
includes(
  'src/components/layout/authenticatedNavigation.ts',
  "destinationAccess === 'timekeeping'",
  'Authenticated navigation must handle timekeeping as a distinct access rule.',
);
includes(
  'src/components/layout/authenticatedNavigation.ts',
  "'app.nav.portalDashboard'",
  'Admins must still see a disambiguated Portal Dashboard label outside the Admin Console context.',
);
assert(
  authenticatedNavigation.includes("'operations'") &&
    authenticatedNavigation.includes("'customers'") &&
    authenticatedNavigation.includes("'work'") &&
    authenticatedNavigation.includes("'reporting'") &&
    authenticatedNavigation.includes("'administration'") &&
    authenticatedNavigation.includes('const coreDestinations') &&
    authenticatedNavigation.includes("kind: 'core'") &&
    authenticatedNavigation.includes("href: '/refunds'") &&
    authenticatedNavigation.includes('!coreDestinationHrefs.has(destination.href)') &&
    !authenticatedNavigation.includes('const shouldIncludePortalDestination ='),
  'Admin context should keep one Admin Console navigation map while exposing Refunds as a shared core Work item.',
);
assert(
  authenticatedNavigation.includes('export type AdminSurface =') &&
    authenticatedNavigation.includes("'overview'") &&
    authenticatedNavigation.includes("'orders'") &&
    authenticatedNavigation.includes("'support'") &&
    authenticatedNavigation.includes("'accounts'") &&
    authenticatedNavigation.includes("'machines'") &&
    authenticatedNavigation.includes("'audit'") &&
    authenticatedNavigation.includes("href: '/admin/partnerships'") &&
    authenticatedNavigation.includes("surface: 'partnerships'"),
  'Scoped admins must get the broad Admin Console surface model while Partnerships remains surface-gated.',
);

const portalNavigation = includes(
  'src/components/portal/portalNavigation.ts',
  "access: 'timekeeping'",
  'The Time destination must not be marked open to all users.',
);
includes(
  'src/components/portal/portalNavigation.ts',
  'canUsePortalTimekeeping',
  'Portal navigation must expose a reusable timekeeping access helper.',
);

const memberRoute = includes(
  'src/components/auth/MemberRoute.tsx',
  'isTimekeepingRoute',
  'Route protection must special-case timekeeping access.',
);
assert(
  memberRoute.includes('Timekeeping setup required') &&
    !memberRoute.includes('Locked for ${portalAccessTier} access'),
  'Locked route copy must be user-facing and avoid internal access-tier language.',
);

const appLayout = includes(
  'src/components/layout/AppLayout.tsx',
  'data-auth-mobile-nav-first',
  'Mobile drawer should focus the first navigation destination instead of footer utilities.',
);
includes(
  'src/components/layout/AppLayout.tsx',
  "app.nav.switchToPortal",
  'Admin routes should offer portal switching as a utility action, not a competing sidebar destination.',
);
assert(
  !appLayout.includes('<h1 className="truncate font-display text-lg font-semibold text-foreground sm:text-xl">'),
  'The app shell title must not render as an H1 because pages render their own H1.',
);

const adminDashboard = includes(
  'src/pages/admin/Dashboard.tsx',
  'Use the sidebar as the map',
  'Admin Console overview must explain that the sidebar is the navigation map.',
);
assert(
  adminDashboard.includes('Work queues') &&
    adminDashboard.includes('Customers and machines') &&
    adminDashboard.includes('Access and audit') &&
    !adminDashboard.includes('Source of truth') &&
    !adminDashboard.includes('GuidanceRow'),
  'Admin Console overview should summarize exception areas without duplicating sidebar destinations.',
);
assert(
  !adminDashboard.includes('adminModules') && !adminDashboard.includes('admin.openModule'),
  'Admin Console overview must not render a second route-card navigation catalog.',
);
assert(
  !adminDashboard.includes('admin_roles') && !adminDashboard.includes('is_super_admin'),
  'Admin Home must not expose implementation table or policy names.',
);

const portalDashboard = includes(
  'src/pages/portal/Dashboard.tsx',
  'availableDashboardActions',
  'Portal dashboard should render a curated set of available actions instead of a second full nav catalog.',
);
assert(
  !portalDashboard.includes('getAccessLevelLabelKey') && !portalDashboard.includes('<Lock'),
  'Portal dashboard quick actions should not render locked access cards.',
);

const { translations } = await import(pathToFileURL(path.join(repoRoot, 'src/lib/i18n.ts')));
const englishKeys = Object.keys(translations.en).sort();
const simplifiedChineseKeys = Object.keys(translations['zh-Hans']).sort();
const missingChinese = englishKeys.filter((key) => !simplifiedChineseKeys.includes(key));
const missingEnglish = simplifiedChineseKeys.filter((key) => !englishKeys.includes(key));

assert(missingChinese.length === 0, `Missing zh-Hans translations: ${missingChinese.join(', ')}`);
assert(missingEnglish.length === 0, `Missing English translations: ${missingEnglish.join(', ')}`);

console.log('Authenticated navigation validation passed.');
