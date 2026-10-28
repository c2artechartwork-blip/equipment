/**
 * 웹앱 진입점 — JSON API
 *
 * 프런트엔드(고정 도메인의 정적 페이지)는 다음 형식으로 POST 한다.
 *   Content-Type: text/plain;charset=utf-8   (CORS preflight 회피)
 *   body: {"action":"tx.checkout","idToken":"<Google ID Token>","payload":{...}}
 *
 * Apps Script는 HTTP 상태코드를 지정할 수 없으므로 항상 200 + {ok:false,error:{code,message}} 로 응답한다.
 */

var API = {}; // action -> { perm: 'read'|'operate'|'manage'|'admin'|null, fn: function(ctx, payload) }

function registerApi_(action, perm, fn) { API[action] = { perm: perm, fn: fn }; }

function doPost(e) {
  var out = handleRequest_(e && e.postData ? e.postData.contents : '');
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  // 화면은 고정 도메인의 정적 프런트엔드가 담당한다. GET 은 상태 확인용.
  var info = { ok: true, app: APP.NAME, version: APP.VERSION, api: 'POST JSON', time: nowIso_() };
  return ContentService.createTextOutput(JSON.stringify(info)).setMimeType(ContentService.MimeType.JSON);
}

function handleRequest_(raw) {
  var started = Date.now();
  var req;
  try {
    DB.invalidate(); // 실행 단위 캐시 초기화 (Apps Script 는 매 실행 새 전역이지만 명시적으로)
    if (!raw || raw.length > 12 * 1024 * 1024) throw AppError('BAD_REQUEST', '요청 형식이 올바르지 않습니다.');
    try { req = JSON.parse(raw); } catch (pe) { throw AppError('BAD_REQUEST', '요청 형식이 올바르지 않습니다.'); }
    var action = str_(req.action);
    var entry = API[action];
    if (!entry) throw AppError('BAD_REQUEST', '알 수 없는 요청: ' + action);

    // 1) 인증 — 모든 액션에서 예외 없이 수행
    var auth = authenticate_(req.idToken);
    var ctx = { user: auth.user, claims: auth.claims, action: action };

    // 2) 권한 — 승인/활성 여부와 역할을 매 요청마다 재검증
    if (entry.perm !== null) {
      if (!auth.user || auth.user.status === 'PENDING') throw AppError('NOT_APPROVED', '관리자 승인 대기 중인 계정입니다.');
      if (!isUserActive_(auth.user)) throw AppError('FORBIDDEN', '비활성화되었거나 권한이 없는 계정입니다.');
      if (!hasPerm_(auth.user, entry.perm)) throw AppError('FORBIDDEN', '이 기능을 사용할 권한이 없습니다.');
      touchLogin_(auth.user);
    }

    var payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
    var data = entry.fn(ctx, payload);
    return { ok: true, data: data, ms: Date.now() - started };
  } catch (err) {
    var isApp = err && err.name === 'AppError';
    if (!isApp) {
      try { console.error('API error', err && err.stack ? err.stack : err); } catch (x) { /* noop */ }
    }
    return {
      ok: false,
      error: {
        code: isApp ? err.code : 'SERVER_ERROR',
        message: isApp ? err.message : '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        details: isApp ? err.details : null
      },
      ms: Date.now() - started
    };
  }
}

/** 공개 사용자 정보 (클라이언트 전달용) */
function publicUser_(u) {
  if (!u) return null;
  return { user_id: u.user_id, email: u.email, name: u.name, department: u.department, role: u.role, active: u.active, status: u.status };
}
function actorInfo_(ctx) {
  return { id: ctx.user.user_id, name: ctx.user.name || ctx.claims.name || '', email: ctx.user.email || normEmail_(ctx.claims.email) };
}

/**
 * 멱등 실행: 같은 request_id 로 재시도/중복 클릭해도 한 번만 반영된다.
 * - 캐시(6h)에 결과 보관 → 즉시 재응답
 * - 캐시가 없더라도 이력 시트에서 request_id 를 찾으면 기존 결과로 간주하고
 *   장비 마스터가 이력과 다르면 복구(reconcile)한다.
 */
function idempotent_(ctx, requestId, fn) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(str_(requestId))) throw AppError('BAD_REQUEST', 'request_id 가 필요합니다.');
  var key = 'req:' + sha256Hex_(ctx.user.user_id + ':' + requestId).slice(0, 40);
  var hit = cache_().get(key);
  if (hit) { var r1 = JSON.parse(hit); r1.duplicate = true; return r1; }
  return withLock_(function () {
    var hit2 = cache_().get(key);
    if (hit2) { var r2 = JSON.parse(hit2); r2.duplicate = true; return r2; }
    var prior = findTxByRequestId_(requestId);
    if (prior.length) {
      var repaired = reconcileFromHistory_(prior.map(function (t) { return t.asset_id; }));
      var r3 = {
        duplicate: true, repaired: repaired,
        results: prior.map(function (t) { return { asset_id: t.asset_id, ok: true, transaction_id: t.transaction_id }; }),
        checkout_group_id: prior[0].checkout_group_id || ''
      };
      return r3;
    }
    var result = fn();
    var s = JSON.stringify(result);
    if (s.length < 90000) cache_().put(key, s, APP.IDEMPOTENCY_TTL_SEC);
    return result;
  });
}

function findTxByRequestId_(requestId) {
  var col = DB.column('TX', 'request_id');
  var rows = [];
  for (var i = col.length - 1; i >= 0; i--) if (col[i].value === requestId) rows.push(col[i].row);
  return DB.rowsAt('TX', rows.reverse());
}

// ---- 세션 ----
registerApi_('session.me', null, function (ctx) {
  var u = ctx.user;
  return {
    status: !u ? 'PENDING' : (isUserActive_(u) ? 'ACTIVE' : (u.status === 'PENDING' ? 'PENDING' : 'INACTIVE')),
    user: isUserActive_(u) ? publicUser_(u) : null,
    google: { sub: ctx.claims.sub, email: ctx.claims.email, name: ctx.claims.name, picture: ctx.claims.picture }
  };
});
