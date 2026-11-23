/**
 * Google Sheets access layer.
 *
 * Reads the three source sheets live (cached briefly) and writes attendance to
 * the one sheet the app owns. Authenticates as a service account, so nothing
 * here depends on a human being signed in.
 */
const { google } = require('googleapis');

// ── source sheet IDs and the tabs/columns we read ──────────────────────────
const SRC = {
  // NCR Team roster: Emp Name | Role | WR Code | Discount Code | Manager | Region
  roster:   { id: process.env.ROSTER_SHEET_ID   || 'MOCK_ROSTER',   tab: 'NCR Team',         range: 'A1:F200' },
  // FTE Team Details: the "All" and "NCR" tabs share the same column layout —
  // Name(D), Designation(F), Email(O), Mobile(T), Status(AE) — so both are read
  // and merged. People onboarded on NCR but not yet copied to All still appear.
  details:  { id: process.env.DETAILS_SHEET_ID  || 'MOCK_DETAILS',  tabs: ['All', 'NCR'],   range: 'A1:AG200' },
  // Activity tracker: Date(B) POD(C) POA(D) Type(E) Time(H) TL(I) Count(J) Names(L) Codes(M)
  activity: { id: process.env.ACTIVITY_SHEET_ID || 'MOCK_ACTIVITY', tab: 'Activity_Tracker', range: 'A1:AE2000' }
};

// ── the sheet the app writes to ────────────────────────────────────────────
const ATTENDANCE_ID = process.env.ATTENDANCE_SHEET_ID || 'MOCK_ATTENDANCE';
const ATTENDANCE_TAB = 'Attendance';
const ATTENDANCE_HEADERS = [
  'timestamp', 'activity_date', 'role', 'name', 'wr_code', 'region', 'manager',
  'poa_name', 'pod_id', 'punch_type', 'photo_url', 'device_lat', 'device_lng',
  'exif_lat', 'exif_lng', 'exif_ts', 'status', 'remarks'
];

let _sheets = null, _drive = null;

function _auth() {
  // The key arrives as a JSON string in an env var on Render. Locally it can be
  // a file path for convenience.
  const raw = process.env.GOOGLE_CREDENTIALS;
  let creds;
  if (raw && raw.trim().startsWith('{')) creds = JSON.parse(raw);
  else if (raw) creds = require(raw);
  else throw new Error('GOOGLE_CREDENTIALS not set');
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
}
function sheetsClient() {
  if (!_sheets) _sheets = google.sheets({ version: 'v4', auth: _auth() });
  return _sheets;
}
function driveClient() {
  if (!_drive) _drive = google.drive({ version: 'v3', auth: _auth() });
  return _drive;
}

// ── a tiny read cache so one page load doesn't hammer the API ───────────────
const _cache = {};
const CACHE_MS = 5 * 60 * 1000;

async function readGrid(which) {
  const src = SRC[which];
  const key = 'src_' + which;
  const hit = _cache[key];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;

  // A test harness can inject rows without touching the network.
  if (global.__MOCK_SHEETS && global.__MOCK_SHEETS[which]) {
    const rows = global.__MOCK_SHEETS[which];
    _cache[key] = { at: Date.now(), rows };
    return rows;
  }

  // A source may span several tabs with the same layout (e.g. details: All+NCR).
  // One batchGet, then concatenate — the header row of the extra tabs is dropped
  // so a single logical grid comes back.
  const tabs = src.tabs || [src.tab];
  const res = await sheetsClient().spreadsheets.values.batchGet({
    spreadsheetId: src.id,
    ranges: tabs.map(t => `${t}!${src.range}`),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  const ranges = res.data.valueRanges || [];
  let rows = [];
  ranges.forEach((vr, i) => {
    const vals = vr.values || [];
    if (i === 0) rows = rows.concat(vals);          // keep first tab's header
    else rows = rows.concat(vals.slice(1));         // drop other tabs' headers
  });
  _cache[key] = { at: Date.now(), rows };
  return rows;
}

function clearCache() { for (const k in _cache) delete _cache[k]; }

async function appendAttendance(rowObj) {
  const row = ATTENDANCE_HEADERS.map(h => rowObj[h] === undefined ? '' : rowObj[h]);
  if (global.__MOCK_SHEETS) {
    (global.__MOCK_SHEETS.attendance = global.__MOCK_SHEETS.attendance || []).push(row);
    return { updates: { updatedRows: 1 } };
  }
  const res = await sheetsClient().spreadsheets.values.append({
    spreadsheetId: ATTENDANCE_ID,
    range: `${ATTENDANCE_TAB}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
  return res.data;
}

async function readAttendance() {
  if (global.__MOCK_SHEETS) {
    return [ATTENDANCE_HEADERS].concat(global.__MOCK_SHEETS.attendance || []);
  }
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: ATTENDANCE_ID,
    range: `${ATTENDANCE_TAB}!A1:R10000`
  });
  return res.data.values || [[]];
}

module.exports = {
  SRC, ATTENDANCE_ID, ATTENDANCE_TAB, ATTENDANCE_HEADERS,
  sheetsClient, driveClient, readGrid, clearCache, appendAttendance, readAttendance
};
