/**
 * Builds the "Where are you?" / "Your plan" list from the Activity_Tracker.
 *
 * Activity_Tracker columns (0-indexed):
 *   B(1) Activity Date, C(2) POD ID, D(3) POA Name, E(4) POA Type,
 *   H(7) Activity Time, I(8) TL Name, J(9) BDE Count, L(11) BDE Names, M(12) BDE Codes
 *
 * A TL sees rows whose TL Name resolves to them, dated today.
 * A BDE sees their manager's rows for today — the plan is written per TL, so a
 * BDE picks from whatever their manager is running. If the plan happens to name
 * the BDE (BDE Names / BDE Codes), we narrow to just their venues.
 */
const { readGrid, SRC } = require('./sheets');
const { resolveName, lc, s } = require('./roster');

// Dates arrive in many shapes from Sheets. Normalise to YYYY-MM-DD.
function dateKey(v) {
  if (v == null || v === '') return '';
  // Sheets serial number (days since 1899-12-30)
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const str = s(v);
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);     // DD/MM/YYYY or MM/DD/YYYY
  if (m) {
    // Activity trackers here use MM-DD-YYYY (e.g. 11-3-2026). Treat first as month.
    const mm = m[1].padStart(2, '0'), dd = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  const d = new Date(str);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

function todayKey() {
  // IST — the team and the plan are both in India.
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

/**
 * @param who  { role, name, manager, wr_code }
 * @param dateOverride optional YYYY-MM-DD for testing
 */
async function poasFor(who, dateOverride) {
  const rows = await readGrid('activity');
  const today = dateOverride || todayKey();

  // The name we match the tracker's TL Name column against.
  const targetName = who.role === 'TL' ? who.name : (who.manager || '');
  if (!targetName) return { poas: [], target: '', found_plan: false, reason: 'no_manager' };

  // Candidate list for tolerant matching is just this one name; we ask whether
  // each row's TL Name resolves to it.
  const cand = [{ key: lc(targetName), id: targetName }];

  const seen = {}, out = [];
  let anyForTarget = false;
  const myCode = lc(who.wr_code || '');
  const myName = lc(who.name || '');
  const explicit = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const tl = s(r[8]);
    if (!tl) continue;
    if (!resolveName(tl, cand)) continue;              // not this TL's row
    anyForTarget = true;
    if (dateKey(r[1]) !== today) continue;             // not today

    const poa = s(r[3]);
    if (!poa) continue;
    const entry = {
      poa_name: poa,
      pod_id: s(r[2]),
      poa_type: s(r[4]),
      activity_time: s(r[7]),
      bde_count: r[9] === '' ? null : Number(r[9])
    };
    const codes = lc(r[12]), names = lc(r[11]);
    const namedMe = (myCode && codes.includes(myCode)) || (myName && names && names.includes(myName));

    if (!seen[lc(poa)]) { seen[lc(poa)] = true; out.push(entry); }
    if (namedMe) explicit.push(entry);
  }

  // If the plan explicitly names this BDE, show only their venues.
  const list = (who.role === 'BDE' && explicit.length) ? explicit : out;
  const dedup = [];
  const d2 = {};
  list.forEach(e => { if (!d2[lc(e.poa_name)]) { d2[lc(e.poa_name)] = true; dedup.push(e); } });

  return {
    poas: dedup.sort((a, b) => a.poa_name < b.poa_name ? -1 : 1),
    target: targetName,
    date: today,
    found_plan: dedup.length > 0,
    explicitly_assigned: who.role === 'BDE' && explicit.length > 0,
    plan_exists_other_days: anyForTarget && dedup.length === 0
  };
}

module.exports = { poasFor, dateKey, todayKey };
