// Run: node scripts/serve-reporting-preview.mjs [--port 8097]
// Local-only launcher. Never imported by the application or production build.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { financeRpcResponse } from './finance-reporting-fixtures.mjs';
import { fixedNowIso, makeSession, makeUser, personas } from './validate-reporting-uat.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex < 0 ? 8097 : process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid --port (1024–65535).');
const origin = `http://127.0.0.1:${port}`;
const backendPath = '/reporting-preview-backend';
const previewRoutes = ['/portal/reports', '/portal/time-review', '/refunds', '/admin/reporting'];
const persona = personas.superAdmin;
const session = makeSession(persona);
// Vite does not read .env files, the repo config, or inherited client env values.
for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key];

const allowedRpcs = new Set([
  // Known auth bootstrap calls acknowledge zero changes in this synthetic backend.
  'resolve_my_technician_entitlements', 'resolve_my_scoped_admin_invites',
  'get_my_plus_access', 'get_my_admin_access_context', 'get_my_portal_access_context',
  'get_my_reporting_access_context', 'get_my_time_report_access', 'get_reporting_dimensions',
  'get_sales_report', 'get_finance_reporting_access', 'get_finance_reporting',
  'get_labor_analytics_access', 'get_labor_analytics_report',
  'get_refund_analytics_access', 'get_refund_analytics',
  'get_partner_dashboard_partnerships', 'admin_preview_partner_period_report',
  'get_my_technician_management_context', 'get_my_operator_timekeeping_context',
  'get_my_operator_pay_statement_context',
]);
const bootstrap = `
if (location.origin !== ${JSON.stringify(origin)}) throw new Error('Reporting preview requires its loopback origin.');
const NativeDate = Date;
class PreviewDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [${JSON.stringify(fixedNowIso)}])); }
  static now() { return new NativeDate(${JSON.stringify(fixedNowIso)}).valueOf(); }
}
globalThis.Date = PreviewDate;
localStorage.setItem('sb-127-auth-token', ${JSON.stringify(JSON.stringify(session))});
localStorage.setItem('bloomjoy.language.v1', 'en');
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[href]');
  if (!link) return;
  const target = new URL(link.href, location.href);
  if (target.protocol === 'blob:') return;
  if (target.origin !== location.origin || !${JSON.stringify(previewRoutes)}.includes(target.pathname)) {
    event.preventDefault();
  }
}, true);
`;
const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};
const deny = res => json(res, 403, { message: 'Unavailable in the local sample-data reporting preview.' });
const readBody = async req => {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 65536) throw new Error('Request too large');
  }
  return text ? JSON.parse(text) : {};
};

const server = await createServer({
  root, configFile: false, envFile: false, envPrefix: '__REPORTING_PREVIEW_UNUSED__',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(`${origin}${backendPath}`),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-reporting-preview-fake-key'),
  },
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port, strictPort: true, cors: false, fs: { strict: true, allow: [root] } },
  plugins: [react(), {
    name: 'local-reporting-preview',
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace(/<link[^>]+(?:dns-prefetch|preconnect)[^>]*>/g, '').replace('<head>', `<head><script>${bootstrap}</script>`)
        .replace('<body>', '<body><div role="status" style="position:fixed;bottom:8px;left:8px;z-index:99999;padding:6px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#555;font:12px system-ui;pointer-events:none">Sample data · Reporting preview</div>'),
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, origin);
        if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) return deny(res);
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:${port}; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'self'`);
        if (url.pathname.startsWith(backendPath)) {
          const route = url.pathname.slice(backendPath.length);
          if (route === '/auth/v1/user' && req.method === 'GET') return json(res, 200, makeUser(persona));
          if (route === '/auth/v1/token' && req.method === 'POST' && url.searchParams.get('grant_type') === 'refresh_token') {
            try {
              const body = await readBody(req);
              return body.refresh_token === session.refresh_token ? json(res, 200, session) : deny(res);
            } catch { return deny(res); }
          }
          const rpc = route.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
          if (req.method !== 'POST' || !allowedRpcs.has(rpc)) return deny(res);
          try { return json(res, 200, financeRpcResponse(rpc, persona, await readBody(req))); }
          catch { return deny(res); }
        }
        if (!['GET', 'HEAD'].includes(req.method)) return deny(res);
        if (url.pathname === '/') { res.writeHead(302, { Location: '/portal/reports?view=finance' }); return res.end(); }
        const appRoute = previewRoutes.includes(url.pathname);
        const moduleRoute = /^\/(?:src\/|node_modules\/|@vite\/|@id\/|@react-refresh$)/.test(url.pathname);
        const publicPath = path.resolve(root, 'public', `.${url.pathname}`);
        const publicAsset = publicPath.startsWith(`${path.join(root, 'public')}${path.sep}`) && existsSync(publicPath);
        if ((!appRoute && !moduleRoute && !publicAsset) || /(?:^|\/)\.|\.env|\.pem|\.key/i.test(url.pathname.replace('/node_modules/.vite/', '/node_modules/vite/'))) return deny(res);
        next();
      });
    },
  }],
});
await server.listen();
console.log(`Sample data · Reporting preview: ${origin}/portal/reports?view=finance`);
console.log('Loopback only. Real credentials and external requests disabled. Ctrl+C stops the preview.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
