/**
 * Attendance submit.
 *
 * One submit = one login record for the day. Logout is a later increment, so
 * punch_type is 'login' here but the column already exists for when we add it.
 *
 * GPS is recorded, never blocking: the browser extracts EXIF and reads device
 * location, we store whatever arrives. Validation can be tightened later by
 * flipping a flag, without changing the row shape.
 */
const { driveClient, appendAttendance } = require('./sheets');
const { authUser } = require('./handlers');
const { poasFor } = require('./poas');
const { s } = require('./roster');

const PHOTO_FOLDER_ID = process.env.PHOTO_FOLDER_ID || '';

function nowIso() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}
function todayKey() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function uploadPhoto(dataB64, mime, name) {
  if (!dataB64) return '';
  if (global.__MOCK_SHEETS) return 'https://drive.google.com/mock/' + encodeURIComponent(name);
  if (!PHOTO_FOLDER_ID) throw new Error('PHOTO_FOLDER_ID not set');

  const { Readable } = require('stream');
  const buffer = Buffer.from(dataB64, 'base64');
  const res = await driveClient().files.create({
    requestBody: { name, parents: [PHOTO_FOLDER_ID] },
    media: { mimeType: mime || 'image/jpeg', body: Readable.from(buffer) },
    fields: 'id'
  });
  const id = res.data.id;
  // make it viewable by link so ops can open it from the sheet
  try {
    await driveClient().permissions.create({
      fileId: id, requestBody: { role: 'reader', type: 'anyone' }
    });
  } catch (e) { /* folder may already grant access */ }
  return `https://drive.google.com/file/d/${id}/view`;
}

async function handleSubmit(body) {
  const a = await authUser(body.token, ['BDE', 'TL']);
  if (!a.ok) return a;
  const u = a.user;
  const date = todayKey();

  // The POA must be one actually planned for this person today. This stops a
  // free-text venue and ties the record back to the plan.
  const poaName = s(body.poa_name);
  if (u.role === 'BDE' && !poaName) return { ok: false, error: 'Choose where you are.' };

  let podId = s(body.pod_id);
  if (poaName) {
    const plan = await poasFor(u, date);
    const match = plan.poas.find(p => p.poa_name.toLowerCase() === poaName.toLowerCase());
    if (!match && plan.poas.length) {
      return { ok: false, error: 'That venue is not in today\'s plan. Pick from the list.' };
    }
    if (match) podId = match.pod_id || podId;
  }

  // A BDE must have a WR code by now — either from the roster or supplied here.
  let wr = s(u.wr_code);
  if (u.role === 'BDE' && !wr) {
    wr = s(body.wr_code);
    if (!wr) return { ok: false, error: 'Enter your wallet recharge code.' };
  }

  const photo = body.photo || {};
  let photoUrl = '';
  try {
    photoUrl = await uploadPhoto(photo.data_b64, photo.mime,
      `${date}_${u.role}_${(u.name || 'x').replace(/\s+/g, '')}_${Date.now()}.jpg`);
  } catch (e) {
    return { ok: false, error: 'Could not save the photo. Try again.' };
  }

  await appendAttendance({
    timestamp: nowIso(),
    activity_date: date,
    role: u.role,
    name: u.name,
    wr_code: wr,
    region: u.region || '',
    manager: u.manager || (u.role === 'TL' ? '' : ''),
    poa_name: poaName,
    pod_id: podId,
    punch_type: 'login',
    photo_url: photoUrl,
    device_lat: s(photo.device_lat),
    device_lng: s(photo.device_lon),
    exif_lat: s(photo.exif_lat),
    exif_lng: s(photo.exif_lon),
    exif_ts: s(photo.exif_ts),
    status: 'P',
    remarks: u.role === 'TL' ? 'TL setup' : ''
  });

  return {
    ok: true,
    message: u.role === 'TL' ? 'Setup image submitted.' : 'Attendance recorded.',
    poa_name: poaName, photo_url: photoUrl
  };
}

module.exports = { handleSubmit, uploadPhoto };
