/** 공통 유틸리티 */

/** 사용자에게 보여줄 수 있는 업무 오류 */
function AppError(code, message, details) {
  var e = new Error(message);
  e.name = 'AppError';
  e.code = code;
  e.details = details || null;
  return e;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}
function todayStr_() {
  return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd');
}
function stampCompact_() {
  return Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMdd');
}
function addDaysStr_(dateStr, days) {
  var p = dateStr.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + days * 86400000);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}
function isDateStr_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  var p = s.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return d.getUTCFullYear() === +p[0] && d.getUTCMonth() === +p[1] - 1 && d.getUTCDate() === +p[2];
}

function shortId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}
function newTxId_() { return 'TX-' + stampCompact_() + '-' + shortId_(); }

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/** 시트 수식 주입 방지 (=, +, @ 및 숫자가 아닌 '-' 시작) */
function cellSafe_(v) {
  if (typeof v !== 'string') return v;
  if (/^[=+@]/.test(v) || /^-[^\d.]/.test(v)) return "'" + v;
  return v;
}
function clip_(v, max) {
  var s = str_(v);
  return s.length > max ? s.slice(0, max) : s;
}
function normEmail_(e) { return str_(e).toLowerCase(); }

function props_() { return PropertiesService.getScriptProperties(); }
function getProp_(k, def) {
  var v = props_().getProperty(k);
  return v === null || v === undefined || v === '' ? (def === undefined ? null : def) : v;
}
function setProp_(k, v) { props_().setProperty(k, String(v)); }

function cache_() { return CacheService.getScriptCache(); }

/** 스크립트 전역 락 안에서 fn 실행 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  var ok = lock.tryLock(APP.LOCK_WAIT_MS);
  if (!ok) throw AppError('BUSY', '다른 사용자가 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  try {
    DB.invalidate(); // 락 획득 후에는 항상 최신 데이터를 다시 읽는다
    return fn();
  } finally {
    try { SpreadsheetApp.flush(); } catch (e) { /* noop */ }
    lock.releaseLock();
  }
}

function bytesToUnsigned_(bytes) {
  var out = new Array(bytes.length);
  for (var i = 0; i < bytes.length; i++) out[i] = bytes[i] & 0xff;
  return out;
}
function b64urlToBytes_(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return bytesToUnsigned_(Utilities.base64Decode(s));
}
function bytesToUtf8_(bytes) {
  return Utilities.newBlob(bytes.map(function (b) { return b > 127 ? b - 256 : b; })).getDataAsString('UTF-8');
}
function sha256Hex_(s) {
  return bytesToUnsigned_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8))
    .map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

function pick_(obj, fields) {
  var o = {};
  fields.forEach(function (f) { o[f] = obj[f]; });
  return o;
}
function indexBy_(arr, field) {
  var m = {};
  arr.forEach(function (r) { m[r[field]] = r; });
  return m;
}
function toBool_(v) {
  if (v === true) return true;
  var s = str_(v).toUpperCase();
  return s === 'TRUE' || s === 'Y' || s === 'YES' || s === '1' || s === '예';
}
