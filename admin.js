/**
 * Admin cumulative view: how many people have submitted attendance, grouped by
 * network total, region, and TL (manager), over a date range.
 *
 * Reads the attendance sheet the app writes to. "Present" = a BDE submitted a
 * login row. TL setup rows are counted separately so they don't inflate the
 * BDE present count.
 */
const { readAttendance, ATTENDANCE_HEADERS } = require('./sheets');
const { authUser } = require('./handlers');
const { s, lc } = require('./roster');

function todayKey() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function handleAdminSummary(token, fromDate, toDate) {
  const a = await authUser(token, ['ADMIN', 'CL']);
  if (!a.ok) return a;

  const from = s(fromDate) || todayKey();
  const to = s(toDate) || from;

  const grid = await readAttendance();
  const idx = {};
  (grid[0] || ATTENDANCE_HEADERS).forEach((h, i) => { idx[lc(h)] = i; });
  const col = name => idx[name];

  // Distinct person per day: someone who submits twice in a day counts once.
  const seenBde = {};        // date|name
  const seenTl = {};
  const byRegion = {};       // region → Set-ish via object
  const byTl = {};           // manager → count
  let bdeTotal = 0, tlTotal = 0;
  const regionSet = {}, tlPersonSet = {};

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const date = s(r[col('activity_date')]);
    if (!date || date < from || date > to) continue;
    const role = (s(r[col('role')]) || '').toUpperCase();
    const name = s(r[col('name')]);
    const region = s(r[col('region')]) || 'UNKNOWN';
    const manager = s(r[col('manager')]) || (role === 'TL' ? name : 'UNKNOWN');

    const dayKey = date + '|' + lc(name);
    if (role === 'BDE') {
      if (seenBde[dayKey]) continue;
      seenBde[dayKey] = true;
      bdeTotal++;
      // region bucket, counting distinct person-days
      byRegion[region] = (byRegion[region] || 0) + 1;
      // tl bucket by manager name, distinct person-days
      byTl[manager] = (byTl[manager] || 0) + 1;
    } else if (role === 'TL') {
      if (seenTl[dayKey]) continue;
      seenTl[dayKey] = true;
      tlTotal++;
    }
  }

  const regions = Object.keys(byRegion).sort()
    .map(k => ({ region: k, present: byRegion[k] }));
  const tls = Object.keys(byTl).sort((x, y) => byTl[y] - byTl[x])
    .map(k => ({ tl: k, present: byTl[k] }));

  return {
    ok: true,
    from, to,
    totals: { bde_present: bdeTotal, tl_submitted: tlTotal },
    by_region: regions,
    by_tl: tls
  };
}

module.exports = { handleAdminSummary };
