/**
 * 인증 — Google Identity Services ID Token(JWT, RS256) 서버 검증
 *
 * 검증 항목: 서명(RS256, Google JWKS 공개키), alg, kid, iss, aud, exp, iat, sub
 * tokeninfo 엔드포인트는 사용하지 않는다. 공개키(JWKS)만 가져와 캐시하고
 * 서명은 이 스크립트 안에서 직접 검증한다 (RSASSA-PKCS1-v1_5 + SHA-256).
 *
 * 서버 세션 캐시가 없다: 모든 요청마다 토큰을 검증하고 사용자 시트를 다시 읽는다.
 * → 관리자가 계정을 비활성화하면 다음 요청부터 즉시 차단된다.
 */

function getClientId_() {
  var id = getProp_('GOOGLE_CLIENT_ID');
  if (!id) throw AppError('NOT_CONFIGURED', 'GOOGLE_CLIENT_ID 스크립트 속성이 설정되지 않았습니다.');
  return id;
}

/** Google 공개키 (JWKS) — Cache-Control max-age 만큼 캐시 */
function getGoogleJwks_(forceRefresh) {
  var cache = cache_();
  if (!forceRefresh) {
    var cached = cache.get(GOOGLE_AUTH.JWKS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  }
  var res = UrlFetchApp.fetch(GOOGLE_AUTH.JWKS_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw AppError('AUTH_UNAVAILABLE', 'Google 공개키를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  var body = JSON.parse(res.getContentText());
  if (!body || !body.keys || !body.keys.length) throw AppError('AUTH_UNAVAILABLE', 'Google 공개키 형식이 올바르지 않습니다.');
  var ttl = 3600;
  var headers = res.getHeaders() || {};
  var cc = headers['Cache-Control'] || headers['cache-control'] || '';
  var m = /max-age=(\d+)/.exec(cc);
  if (m) ttl = Math.max(300, Math.min(21600, parseInt(m[1], 10)));
  cache.put(GOOGLE_AUTH.JWKS_CACHE_KEY, JSON.stringify(body), ttl);
  return body;
}

function bytesToBigInt_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
  return hex ? BigInt('0x' + hex) : BigInt(0);
}
function bigIntToBytes_(n, len) {
  var hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  var out = [];
  for (var i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  while (out.length < len) out.unshift(0);
  return out;
}
function modPow_(base, exp, mod) {
  var result = BigInt(1);
  base = base % mod;
  var zero = BigInt(0), one = BigInt(1), two = BigInt(2);
  while (exp > zero) {
    if (exp % two === one) result = (result * base) % mod;
    exp = exp / two;
    base = (base * base) % mod;
  }
  return result;
}

// DER DigestInfo prefix for SHA-256 (RFC 8017 9.2)
var SHA256_DIGEST_INFO_ = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03,
  0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];

/** RSASSA-PKCS1-v1_5 SHA-256 서명 검증 */
function verifyRs256_(signingInput, sigBytes, nB64, eB64) {
  var nBytes = b64urlToBytes_(nB64);
  while (nBytes.length && nBytes[0] === 0) nBytes.shift();
  var k = nBytes.length;
  if (k < 256) return false; // 2048비트 미만 키 거부
  if (sigBytes.length !== k) return false;
  var n = bytesToBigInt_(nBytes);
  var e = bytesToBigInt_(b64urlToBytes_(eB64));
  var s = bytesToBigInt_(sigBytes);
  if (s >= n) return false;
  var em = bigIntToBytes_(modPow_(s, e, n), k);
  var hash = bytesToUnsigned_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signingInput, Utilities.Charset.UTF_8));
  var t = SHA256_DIGEST_INFO_.concat(hash);
  var psLen = k - t.length - 3;
  if (psLen < 8) return false;
  var expected = [0x00, 0x01];
  for (var i = 0; i < psLen; i++) expected.push(0xff);
  expected.push(0x00);
  expected = expected.concat(t);
  var diff = 0;
  for (var j = 0; j < k; j++) diff |= (em[j] ^ expected[j]);
  return diff === 0;
}

/**
 * ID Token 검증. 성공 시 claims 반환, 실패 시 AppError('UNAUTHENTICATED').
 */
function verifyGoogleIdToken_(idToken) {
  var fail = function (why) {
    throw AppError('UNAUTHENTICATED', '로그인이 필요합니다. (' + why + ')');
  };
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) fail('토큰 없음');
  var parts = idToken.split('.');
  if (parts.length !== 3) fail('토큰 형식');
  var header, claims;
  try {
    header = JSON.parse(bytesToUtf8_(b64urlToBytes_(parts[0])));
    claims = JSON.parse(bytesToUtf8_(b64urlToBytes_(parts[1])));
  } catch (e) { fail('토큰 해석'); }
  if (header.alg !== 'RS256') fail('알고리즘');
  if (!header.kid) fail('kid 없음');

  var jwks = getGoogleJwks_(false);
  var jwk = (jwks.keys || []).filter(function (k) { return k.kid === header.kid; })[0];
  if (!jwk) { // 키 교체 직후일 수 있으므로 1회 갱신
    jwks = getGoogleJwks_(true);
    jwk = (jwks.keys || []).filter(function (k) { return k.kid === header.kid; })[0];
  }
  if (!jwk || jwk.kty !== 'RSA') fail('알 수 없는 서명 키');
  var sig = b64urlToBytes_(parts[2]);
  if (!verifyRs256_(parts[0] + '.' + parts[1], sig, jwk.n, jwk.e)) fail('서명 불일치');

  var now = Math.floor(Date.now() / 1000);
  var skew = GOOGLE_AUTH.CLOCK_SKEW_SEC;
  if (GOOGLE_AUTH.ISSUERS.indexOf(claims.iss) < 0) fail('발급자 불일치');
  var clientId = getClientId_();
  var audOk = Array.isArray(claims.aud) ? claims.aud.indexOf(clientId) >= 0 : claims.aud === clientId;
  if (!audOk) fail('대상 불일치');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) fail('만료됨');
  if (typeof claims.iat === 'number' && claims.iat - skew > now) fail('발급 시각 오류');
  if (!claims.sub || typeof claims.sub !== 'string') fail('sub 없음');
  return claims;
}

/**
 * 검증된 claims → 사용자 행.
 * 1) user_id(sub) 일치 → 해당 사용자
 * 2) 관리자가 이메일로 초대한 행(INVITE:<email>) + email_verified → sub 연결(최초 1회)
 * 3) 둘 다 아니면 승인 대기 행 생성 후 null
 */
function resolveUser_(claims) {
  var user = DB.find('USERS', 'user_id', claims.sub);
  if (user) return user;
  var email = normEmail_(claims.email);
  var verified = claims.email_verified === true || claims.email_verified === 'true';
  return withLock_(function () {
    var again = DB.find('USERS', 'user_id', claims.sub);
    if (again) return again;
    if (email && verified) {
      var invite = DB.find('USERS', 'user_id', 'INVITE:' + email);
      if (invite) {
        var bound = Object.assign({}, invite, {
          user_id: claims.sub, email: email, status: 'APPROVED',
          google_name: clip_(claims.name, 80), updated_at: nowIso_()
        });
        if (!bound.name) bound.name = clip_(claims.name || email, 80);
        DB.update('USERS', [bound]);
        return bound;
      }
    }
    var pendingCount = DB.filter('USERS', function (u) { return u.status === 'PENDING'; }).length;
    if (pendingCount < APP.MAX_PENDING_USERS) {
      DB.insert('USERS', [{
        user_id: claims.sub, email: verified ? email : '', name: clip_(claims.name || email, 80),
        department: '', role: '', active: false, created_at: nowIso_(), status: 'PENDING',
        google_name: clip_(claims.name, 80), last_login_at: nowIso_(), approved_by: '', updated_at: nowIso_()
      }]);
    }
    return null;
  });
}

function isUserActive_(u) {
  return !!u && u.status === 'APPROVED' && u.active === true && ROLES.indexOf(u.role) >= 0;
}

function hasPerm_(u, perm) {
  return isUserActive_(u) && !!(ROLE_PERMS[u.role] || {})[perm];
}

/** 요청 컨텍스트 생성 — 모든 API 호출의 입구 */
function authenticate_(idToken) {
  var claims = verifyGoogleIdToken_(idToken);
  var user = resolveUser_(claims);
  return { claims: claims, user: user };
}

/** 하루 1회 정도만 last_login_at 갱신 (쓰기 최소화) */
function touchLogin_(user) {
  var today = todayStr_();
  if (String(user.last_login_at || '').slice(0, 10) === today) return;
  try {
    withLock_(function () {
      var u = DB.find('USERS', 'user_id', user.user_id);
      if (u) DB.update('USERS', [Object.assign({}, u, { last_login_at: nowIso_() })]);
    });
  } catch (e) { /* 로그인 시각 기록 실패는 무시 */ }
}

/** Apps Script 편집기에서 실행: BigInt/RSA 검증 동작 자체 점검 */
function selfTestCrypto() {
  var ok = typeof BigInt === 'function' && modPow_(BigInt(4), BigInt(13), BigInt(497)) === BigInt(445);
  Logger.log('BigInt/modPow: ' + (ok ? 'OK' : 'FAIL'));
  var jwks = getGoogleJwks_(true);
  Logger.log('Google JWKS keys: ' + jwks.keys.map(function (k) { return k.kid; }).join(', '));
  return ok;
}
