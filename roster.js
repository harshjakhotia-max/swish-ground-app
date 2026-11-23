/**
 * Builds one clean view of each person by joining three sheets:
 *   NCR Team      → name, role, WR code, manager, region   (the login directory)
 *   FTE "All"     → email, mobile, status                  (matched by name)
 *   Activity_Tracker → today's POAs                        (matched by TL name)
 *
 * Names are spelled inconsistently across sheets, so matching is tolerant:
 * lower-cased, trimmed, and accepting a first-name prefix when it is unambiguous.
 */
const { readGrid } = require('./sheets');

const lc = v => String(v == null ? '' : v).trim().toLowerCase();
const s  = v => String(v == null ? '' : v).trim();
const digits10 = v => s(v).replace(/[^0-9]/g, '').slice(-10);

// ── name matching, shared by every join ────────────────────────────────────
function resolveName(query, candidates) {
  const q = lc(query);
  if (!q || q.length < 3) return null;
  const exact = candidates.filter(c => c.key === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;                 // ambiguous, refuse
  const pre = candidates.filter(c => c.key.indexOf(q) === 0 || q.indexOf(c.key) === 0);
  return pre.length === 1 ? pre[0] : null;
}

// Region normalisation to the codes used elsewhere.
const REGION = {
  ggn: 'GGN', gurgaon: 'GGN', gurugram: 'GGN',
  noida: 'NOI', noi: 'NOI',
  gzbd: 'GZBD', gzb: 'GZBD', ghaziabad: 'GZBD',
  del: 'DEL', delhi: 'DEL',
  blr: 'BLR', bangalore: 'BLR', bengaluru: 'BLR'
};
const region = v => REGION[lc(v)] || s(v).toUpperCase();

/**
 * The master roster, keyed by lower-cased email and by mobile for login.
 * Cached inside readGrid, so this is cheap to call per request.
 */
async function buildRoster() {
  const rosterRows  = await readGrid('roster');
  const detailRows  = await readGrid('details');

  // ── detail lookup: name → {email, mobile, status} ────────────────────────
  // FTE Team Details, "All" + "NCR" tabs (same layout):
  //   D Name, F Designation, O Email, T Mobile, AE Status
  // The same person can appear on both tabs. Keyed by name, the record with
  // more filled fields wins, so a complete NCR row isn't shadowed by a sparse
  // All row or vice versa.
  const detailByName = {};
  const score = d => (d.email ? 1 : 0) + (d.mobile ? 1 : 0);
  for (let i = 1; i < detailRows.length; i++) {
    const r = detailRows[i] || [];
    const name = s(r[3]);
    if (!name) continue;
    const rec = {
      key: lc(name),
      email: lc(r[14]),
      mobile: digits10(r[19]),
      status: s(r[30]) || 'Active'
    };
    const have = detailByName[rec.key];
    if (!have || score(rec) > score(have)) detailByName[rec.key] = rec;
  }
  const detailCands = Object.values(detailByName);

  // ── roster: the people who can log in ────────────────────────────────────
  // NCR Team: A Emp Name, B Role, C WR Code, E Manager, F Region  (D ignored)
  const people = [];
  for (let i = 1; i < rosterRows.length; i++) {
    const r = rosterRows[i] || [];
    const name = s(r[0]);
    if (!name) continue;
    const role = s(r[1]).toUpperCase();
    if (role !== 'BDE' && role !== 'TL') continue;        // only field roles here

    const det = resolveName(name, detailCands) || {};
    people.push({
      name,
      role,
      wr_code: s(r[2]),
      manager: s(r[4]),
      region: region(r[5]),
      email: det.email || '',
      mobile: det.mobile || '',
      status: det.status || 'Active'
    });
  }

  // ── login indexes ────────────────────────────────────────────────────────
  const byEmail = {}, byMobile = {}, mobileDupe = {};
  people.forEach(p => {
    if (p.email) byEmail[p.email] = p;
    if (p.mobile) {
      if (byMobile[p.mobile]) mobileDupe[p.mobile] = true;
      else byMobile[p.mobile] = p;
    }
  });

  return { people, byEmail, byMobile, mobileDupe };
}

/**
 * Who someone can log in as. Email is the primary key; mobile is a fallback
 * for the handful with no email, unless two people share it.
 */
async function findForLogin(idRaw) {
  const { byEmail, byMobile, mobileDupe } = await buildRoster();
  const id = lc(idRaw);
  if (byEmail[id]) return byEmail[id];
  const mob = digits10(idRaw);
  if (mob && byMobile[mob] && !mobileDupe[mob]) return byMobile[mob];
  return null;
}

module.exports = { buildRoster, findForLogin, resolveName, region, lc, s, digits10 };
