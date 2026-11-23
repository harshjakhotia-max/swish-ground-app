/**
 * Swish Ground — Node backend (Render).
 * Step 1: skeleton, Google auth, roster resolution, health check.
 */
const express = require('express');
const { buildRoster } = require('./roster');
const { readGrid } = require('./sheets');
const { handleLogin, handleBootstrap } = require('./handlers');
const { authUser } = require('./handlers');
const { poasFor } = require('./poas');
const { handleSubmit } = require('./submit');
const { handleAdminSummary } = require('./admin');

const app = express();
app.use(express.json({ limit: '12mb' }));

// Permissive CORS: the frontend is hosted on a different origin (GitHub Pages).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => res.json({ ok: true, service: 'swish-ground', version: '0.1' }));

app.get('/health', async (req, res) => {
  const checks = [];
  async function check(label, fn) {
    try { checks.push({ check: label, ok: true, detail: String(await fn()) }); }
    catch (e) { checks.push({ check: label, ok: false, detail: e.message }); }
  }
  await check('roster sheet', async () => (await readGrid('roster')).length + ' rows');
  await check('details sheet', async () => (await readGrid('details')).length + ' rows');
  await check('activity sheet', async () => (await readGrid('activity')).length + ' rows');
  await check('roster resolves', async () => {
    const r = await buildRoster();
    const withEmail = r.people.filter(p => p.email).length;
    return `${r.people.length} people, ${withEmail} with email`;
  });
  const ok = checks.every(c => c.ok);
  res.status(ok ? 200 : 500).json({ ok, checks });
});

// Debug view of the resolved roster. Removed before go-live, but invaluable now.
app.get('/debug/roster', async (req, res) => {
  try {
    const r = await buildRoster();
    res.json({
      ok: true,
      total: r.people.length,
      by_role: r.people.reduce((m, p) => (m[p.role] = (m[p.role] || 0) + 1, m), {}),
      by_region: r.people.reduce((m, p) => (m[p.region] = (m[p.region] || 0) + 1, m), {}),
      no_email: r.people.filter(p => !p.email).map(p => p.name),
      no_wr_code: r.people.filter(p => !p.wr_code).map(p => p.name),
      shared_mobiles: Object.keys(r.mobileDupe),
      sample: r.people.slice(0, 5)
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/login', async (req, res) => {
  try { res.json(await handleLogin(req.body || {})); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/bootstrap', async (req, res) => {
  try { res.json(await handleBootstrap(req.query.token)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/poas', async (req, res) => {
  try {
    const a = await authUser(req.query.token, ['BDE', 'TL']);
    if (!a.ok) return res.json(a);
    const result = await poasFor(a.user, req.query.date);
    res.json({ ok: true, role: a.user.role, wr_code: a.user.wr_code || '',
               needs_wr_code: a.user.role === 'BDE' && !a.user.wr_code, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/submit', async (req, res) => {
  try { res.json(await handleSubmit(req.body || {})); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/admin/summary', async (req, res) => {
  try { res.json(await handleAdminSummary(req.query.token, req.query.from, req.query.to)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('swish-ground listening on ' + port));
}
module.exports = app;
