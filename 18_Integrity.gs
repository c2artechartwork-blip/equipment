/** 데이터 정합성 검사 / 복구 / 백업 (ADMIN) */

function integrityReport_() {
  var issues = [];
  var add = function (level, code, msg, ids) { issues.push({ level: level, code: code, message: msg, ids: (ids || []).slice(0, 50), count: (ids || []).length }); };
  var assets = DB.all('ASSETS');
  var projects = indexBy_(DB.all('PROJECTS'), 'project_id');
  var users = indexBy_(DB.all('USERS'), 'user_id');

  var seen = {}, dups = [];
  assets.forEach(function (a) { if (seen[a.asset_id]) dups.push(a.asset_id); seen[a.asset_id] = true; });
  if (dups.length) add('error', 'DUP_ASSET_ID', '관리번호 중복', dups);

  var badStatus = assets.filter(function (a) { return !STATUS[a.current_status]; }).map(function (a) { return a.asset_id; });
  if (badStatus.length) add('error', 'BAD_STATUS', '알 수 없는 상태값', badStatus);

  var outBad = assets.filter(function (a) {
    return a.current_status === STATUS.CHECKED_OUT && (!a.current_project_id || !a.current_user_id || !a.return_due_date || !projects[a.current_project_id]);
  }).map(function (a) { return a.asset_id; });
  if (outBad.length) add('error', 'CHECKOUT_INCOMPLETE', '반출 상태인데 프로젝트/담당자/반납예정일 누락', outBad);

  var staleRef = assets.filter(function (a) {
    return a.current_status !== STATUS.CHECKED_OUT && a.current_status !== STATUS.LOST && (a.current_project_id || a.return_due_date);
  }).map(function (a) { return a.asset_id; });
  if (staleRef.length) add('warn', 'STALE_CHECKOUT_FIELDS', '반출 상태가 아닌데 프로젝트/반납예정일이 남아 있음', staleRef);

  var unknownUser = assets.filter(function (a) { return a.current_user_id && !users[a.current_user_id]; }).map(function (a) { return a.asset_id; });
  if (unknownUser.length) add('warn', 'UNKNOWN_USER', '현재 사용자가 사용자 목록에 없음', unknownUser);

  // 이력(저널) vs 마스터
  var lastRow = {};
  DB.column('TX', 'asset_id').forEach(function (c) { lastRow[c.value] = c.row; });
  var noHistory = assets.filter(function (a) { return !lastRow[a.asset_id]; }).map(function (a) { return a.asset_id; });
  if (noHistory.length) add('warn', 'NO_HISTORY', '등록 이력이 없는 장비(시트에 직접 입력된 것으로 추정) — "기준선 등록"으로 해결', noHistory);
  var orphan = Object.keys(lastRow).filter(function (id) { return !seen[id]; });
  if (orphan.length) add('error', 'ORPHAN_HISTORY', '이력은 있는데 장비 마스터에 없음 — 복구 가능', orphan);

  var txs = DB.rowsAt('TX', Object.keys(lastRow).filter(function (id) { return seen[id]; }).map(function (id) { return lastRow[id]; }));
  var byId = indexBy_(assets, 'asset_id');
  var mismatch = [];
  txs.forEach(function (t) {
    var after; try { after = JSON.parse(t.after_json || '{}'); } catch (e) { return; }
    var a = byId[t.asset_id];
    var diff = STATE_FIELDS.some(function (k) { return k in after && str_(a[k]) !== str_(after[k]); });
    if (diff) mismatch.push(t.asset_id);
  });
  if (mismatch.length) add('error', 'STATE_MISMATCH', '장비 상태가 마지막 이력과 다름 (처리 중 중단 추정) — 복구 가능', mismatch);

  var serials = {};
  assets.forEach(function (a) { var s = str_(a.serial_number).toUpperCase(); if (s) (serials[s] = serials[s] || []).push(a.asset_id); });
  var dupSerial = [];
  Object.keys(serials).forEach(function (s) { if (serials[s].length > 1) dupSerial = dupSerial.concat(serials[s]); });
  if (dupSerial.length) add('warn', 'DUP_SERIAL', '시리얼번호 중복', dupSerial);

  var setRows = DB.all('SETS');
  var setMissing = setRows.filter(function (s) { return !byId[s.asset_id]; }).map(function (s) { return s.set_id + ':' + s.asset_id; });
  if (setMissing.length) add('error', 'SET_MISSING_ASSET', '세트에 없는 장비가 포함됨', setMissing);
  var setMismatch = setRows.filter(function (s) { return byId[s.asset_id] && byId[s.asset_id].set_id !== s.set_id; }).map(function (s) { return s.asset_id; });
  if (setMismatch.length) add('warn', 'SET_ID_MISMATCH', '세트 구성과 장비의 set_id 가 다름', setMismatch);

  var emails = {}, dupEmail = [];
  DB.all('USERS').forEach(function (u) {
    if (u.status === 'PENDING' || u.status === 'REJECTED') return;
    var e = normEmail_(u.email); if (!e) return;
    if (emails[e]) dupEmail.push(e); emails[e] = true;
  });
  if (dupEmail.length) add('warn', 'DUP_USER_EMAIL', '같은 이메일의 사용자 중복', dupEmail);

  return {
    checked_at: nowIso_(),
    totals: { assets: assets.length, transactions: DB.count('TX'), projects: Object.keys(projects).length, users: Object.keys(users).length },
    ok: !issues.some(function (i) { return i.level === 'error'; }),
    issues: issues
  };
}

registerApi_('admin.integrityCheck', 'admin', function (ctx) {
  return withLock_(integrityReport_);
});

/** 이력 기준 복구 (+선택: 이력 없는 장비 기준선 등록) */
registerApi_('admin.repair', 'admin', function (ctx, p) {
  return idempotent_(ctx, p.request_id, function () {
    var ids = {};
    DB.column('TX', 'asset_id').forEach(function (c) { ids[c.value] = true; });
    var repaired = reconcileFromHistory_(Object.keys(ids));
    var baselined = 0;
    if (p.baseline) {
      var changes = DB.all('ASSETS').filter(function (a) { return !ids[a.asset_id]; }).map(function (a) {
        return { asset: a, action: ACTION.REGISTER, state: {}, info: null, notes: '기준선 등록(정합성 복구)' };
      });
      if (changes.length) {
        // 기존 행을 그대로 두고 REGISTER 이력만 남긴다
        var actor = actorInfo_(ctx);
        DB.insert('TX', changes.map(function (ch) {
          var a = ch.asset;
          return {
            transaction_id: newTxId_(), request_id: p.request_id, checkout_group_id: '', asset_id: a.asset_id,
            action_type: ACTION.REGISTER, project_id: a.current_project_id, actor_user_id: actor.id, receiver_user_id: a.current_user_id,
            timestamp: nowIso_(), due_date: a.return_due_date, condition: '', location: a.current_location, photo_url: '',
            notes: ch.notes, previous_status: '', new_status: a.current_status, correction_of: '',
            actor_name: actor.name, actor_email: actor.email, receiver_name: '', before_json: '{}', after_json: JSON.stringify(stripMeta_(a))
          };
        }));
        baselined = changes.length;
      }
    }
    return { repaired: repaired, repaired_count: repaired.length, baselined: baselined, report: integrityReport_() };
  });
});

registerApi_('admin.backup', 'admin', function (ctx) {
  return backupSpreadsheet_('수동 ' + (ctx.user.name || ''));
});

registerApi_('admin.info', 'admin', function (ctx) {
  var ss = DB.spreadsheet();
  return {
    spreadsheet_url: ss.getUrl(), spreadsheet_name: ss.getName(),
    schema_version: getProp_('SCHEMA_VERSION', '0'), app_version: APP.VERSION,
    client_id_set: !!getProp_('GOOGLE_CLIENT_ID'),
    data_env: getProp_('DATA_ENV', 'PRODUCTION'),
    token_check: { iss: ctx.claims.iss, aud_ok: true, exp: ctx.claims.exp, sub: ctx.claims.sub, email: ctx.claims.email, email_verified: ctx.claims.email_verified }
  };
});
