/**
 * 사진 저장 — 관리자 계정 드라이브의 전용 폴더에 저장한다.
 * 공개 링크 공유를 하지 않는다. 사진은 인증된 API(files.get)로만 내려받는다.
 * photo_url 형식: drive://<원본ID>|<썸네일ID>
 */

var IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

function photoFolder_() {
  var id = getProp_('PHOTO_FOLDER_ID');
  if (!id) throw AppError('NOT_CONFIGURED', '사진 폴더가 설정되지 않았습니다. setup()을 실행해 주세요.');
  return DriveApp.getFolderById(id);
}

function saveImage_(b64, mime, name) {
  if (IMAGE_MIMES.indexOf(mime) < 0) throw AppError('VALIDATION', 'JPG/PNG/WEBP 이미지만 업로드할 수 있습니다.');
  var bytes = Utilities.base64Decode(String(b64 || ''));
  if (!bytes.length) throw AppError('VALIDATION', '빈 파일입니다.');
  if (bytes.length > APP.MAX_UPLOAD_BYTES) throw AppError('VALIDATION', '사진은 5MB 이하여야 합니다.');
  var file = photoFolder_().createFile(Utilities.newBlob(bytes, mime, name));
  return file.getId();
}

registerApi_('files.upload', 'operate', function (ctx, p) {
  var kind = /^(asset|return|inspection)$/.test(str_(p.kind)) ? p.kind : 'misc';
  var base = kind + '_' + clip_(str_(p.ref).replace(/[^A-Za-z0-9_-]/g, ''), 30) + '_' + Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMdd-HHmmss') + '_' + shortId_().slice(0, 4);
  var fullId = saveImage_(p.data, str_(p.mime), base + '.jpg');
  var thumbId = p.thumb ? saveImage_(p.thumb, 'image/jpeg', base + '_thumb.jpg') : fullId;
  return { photo_url: 'drive://' + fullId + '|' + thumbId };
});

function parsePhotoRef_(ref, size) {
  var m = /^drive:\/\/([A-Za-z0-9_-]+)(?:\|([A-Za-z0-9_-]+))?$/.exec(str_(ref));
  if (!m) return null;
  return size === 'full' ? m[1] : (m[2] || m[1]);
}

/** 우리 사진 폴더 안의 파일만 내려준다 (관리자 드라이브의 다른 파일 접근 차단) */
function readPhoto_(fileId) {
  var folderId = getProp_('PHOTO_FOLDER_ID');
  var f;
  try { f = DriveApp.getFileById(fileId); } catch (e) { return null; }
  var parents = f.getParents();
  var inFolder = false;
  while (parents.hasNext()) { if (parents.next().getId() === folderId) { inFolder = true; break; } }
  if (!inFolder) return null;
  var blob = f.getBlob();
  return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

registerApi_('files.get', 'read', function (ctx, p) {
  var refs = (p.refs || [p.ref]).slice(0, 40);
  var size = p.size === 'full' ? 'full' : 'thumb';
  if (size === 'full' && refs.length > 3) refs = refs.slice(0, 3);
  var out = {};
  refs.forEach(function (ref) {
    var id = parsePhotoRef_(ref, size);
    if (!id) return;
    var r = readPhoto_(id);
    if (r) out[ref] = 'data:' + r.mime + ';base64,' + r.data;
  });
  return { images: out };
});
