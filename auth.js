/**
 * Stateless auth tokens. Signed with a server secret so a token cannot be
 * forged, and carrying an expiry so a copied one does not live forever.
 * Identity is re-checked against the live roster on every request, so a token
 * is only ever a claim — the roster is the authority.
 */
const crypto = require('crypto');

const SECRET = process.env.TOKEN_SECRET || 'dev-only-insecure-secret-change-me';
const TTL_MS = (parseInt(process.env.SESSION_HOURS || '12', 10)) * 3600 * 1000;

const b64 = buf => Buffer.from(buf).toString('base64url');
const unb64 = str => Buffer.from(str, 'base64url').toString('utf8');

function issueToken(payload) {
  const body = b64(JSON.stringify({ ...payload, e: Date.now() + TTL_MS }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { ok: false, error: 'BAD_TOKEN' };
  const expect = crypto.createHmac('sha256', SECRET).update(parts[0]).digest('base64url');
  // constant-time compare
  const a = Buffer.from(parts[1]), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'BAD_TOKEN' };
  let data;
  try { data = JSON.parse(unb64(parts[0])); } catch (e) { return { ok: false, error: 'BAD_TOKEN' }; }
  if (Date.now() > data.e) return { ok: false, error: 'SESSION_EXPIRED' };
  return { ok: true, data };
}

module.exports = { issueToken, verifyToken };
