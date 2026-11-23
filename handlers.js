/**
 * Request handlers. Kept separate from server.js so the test harness can call
 * them directly without going through HTTP where that is simpler.
 */
const { issueToken, verifyToken } = require('./auth');
const { buildRoster, findForLogin, lc, s } = require('./roster');

function permissions(role) {
  return {
    can_punch: role === 'BDE' || role === 'TL',
    role,
    tabs: ['attendance'],                 // performance + analytics are "under maintenance"
    is_admin: role === 'ADMIN' || role === 'CL'
  };
}

// ── LOGIN ──────────────────────────────────────────────────────────────────
async function handleLogin(body) {
  const id = s(body.user_id || body.email || '');
  const pw = s(body.password || '');
  if (!id || !pw) return { ok: false, error: 'Enter your email and mobile number.' };

  // Admin is a fixed credential, not a roster row.
  const ADMIN_ID = process.env.ADMIN_ID || 'admin';
  const ADMIN_PW = process.env.ADMIN_PW || 'swish@246';
  if (lc(id) === lc(ADMIN_ID)) {
    if (pw !== ADMIN_PW) return { ok: false, error: 'Incorrect password.' };
    return {
      ok: true,
      token: issueToken({ k: 'admin', r: 'ADMIN' }),
      user: { name: 'Administrator', role: 'ADMIN', region: 'ALL' },
      permissions: permissions('ADMIN')
    };
  }

  const p = await findForLogin(id);
  if (!p) return { ok: false, error: 'We could not find that email. Check with your TL.' };
  if (lc(p.status) !== 'active') return { ok: false, error: 'This account is inactive.' };

  // Password is the mobile number. Compare on the last 10 digits either way.
  const supplied = pw.replace(/[^0-9]/g, '').slice(-10);
  if (!p.mobile || supplied !== p.mobile) return { ok: false, error: 'Incorrect password.' };

  return {
    ok: true,
    token: issueToken({ k: p.email || ('m:' + p.mobile), r: p.role }),
    user: {
      name: p.name, role: p.role, region: p.region,
      wr_code: p.wr_code, manager: p.manager
    },
    needs_wr_code: p.role === 'BDE' && !p.wr_code,   // ask on the attendance screen
    permissions: permissions(p.role)
  };
}

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
// Resolves the token back to a live roster person (or the admin), so a change
// in the sheet is reflected on the user's next action.
async function authUser(token, allowedRoles) {
  const v = verifyToken(token);
  if (!v.ok) return { ok: false, error: v.error };

  if (v.data.k === 'admin') {
    if (allowedRoles && !allowedRoles.includes('ADMIN')) return { ok: false, error: 'FORBIDDEN' };
    return { ok: true, user: { name: 'Administrator', role: 'ADMIN', region: 'ALL' } };
  }

  const roster = await buildRoster();
  const key = v.data.k;
  let p = null;
  if (key.startsWith('m:')) {
    p = roster.byMobile[key.slice(2)] || null;
  } else {
    p = roster.byEmail[key] || null;
  }
  if (!p) return { ok: false, error: 'USER_NOT_FOUND' };
  if (lc(p.status) !== 'active') return { ok: false, error: 'ACCOUNT_INACTIVE' };
  if (allowedRoles && !allowedRoles.includes(p.role)) return { ok: false, error: 'FORBIDDEN' };
  return { ok: true, user: p };
}

// ── BOOTSTRAP: who am I, re-fetched fresh ────────────────────────────────────
async function handleBootstrap(token) {
  const a = await authUser(token);
  if (!a.ok) return a;
  const u = a.user;
  return {
    ok: true,
    user: {
      name: u.name, role: u.role, region: u.region,
      wr_code: u.wr_code || '', manager: u.manager || ''
    },
    needs_wr_code: u.role === 'BDE' && !u.wr_code,
    permissions: permissions(u.role)
  };
}

module.exports = { handleLogin, authUser, handleBootstrap, permissions };
