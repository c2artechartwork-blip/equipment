/**
 * 입출고 트랜잭션 코어
 *
 * 쓰기 순서 (Google Sheets 는 시트 간 원자성이 없으므로):
 *   ① 락 획득 → ② 최신 데이터로 재검증 → ③ 이력(02_입출고이력) 먼저 추가(저널)
 *   → ④ 장비 마스터 상태 갱신
 * ③과 ④ 사이에 장애가 나도 이력의 after_json 이 "정답"이므로
 * 같은 request_id 재시도 또는 정합성 검사(repair)로 마스터를 복구할 수 있다.
 */

function stateOf_(asset) { return pick_(asset, STATE_FIELDS); }

function userName_(userId) {
  if (!userId) return '';
  var u = DB.find('USERS', 'user_id', userId);
  return u ? u.name : '';
}

/**
 * @param changes [{asset, action, state:{}, info:{}, project_id, receiver_user_id, due_date,
 *                   condition, location, photo_url, notes, correction_of, full:true(REGISTER)}]
 */
function commitChanges_(ctx, requestId, changes, groupId) {
  var actor = actorInfo_(ctx);
  var ts = nowIso_();
  var txRows = [];
  var assetUpdates = [];
  var assetInserts = [];
  changes.forEach(function (ch) {
    var a = ch.asset;
    var before = ch.isNew ? {} : stateOf_(a);
    var infoBefore = {};
    if (ch.info) Object.keys(ch.info).forEach(function (k) { if (!ch.isNew) infoBefore[k] = a[k]; });
    var next = Object.assign({}, a, ch.state || {}, ch.info || {});
    next.updated_at = ts;
    next.version = (Number(a.version) || 0) + 1;
    if (ch.isNew) { next.created_at = ts; next.version = 1; }
    var after = ch.isNew ? stripMeta_(next) : Object.assign(stateOf_(next), ch.info ? pick_(next, Object.keys(ch.info)) : {});
    var txId = newTxId_();
    ch.transaction_id = txId;
    txRows.push({
      transaction_id: txId,
      request_id: requestId,
      checkout_group_id: groupId || '',
      asset_id: a.asset_id,
      action_type: ch.action,
      project_id: ch.project_id || next.current_project_id || '',
      actor_user_id: actor.id,
      receiver_user_id: ch.receiver_user_id || '',
      timestamp: ts,
      due_date: ch.due_date || '',
      condition: ch.condition || '',
      location: ch.location || next.current_location || '',
      photo_url: ch.photo_url || '',
      notes: clip_(ch.notes, 1000),
      previous_status: ch.isNew ? '' : a.current_status,
      new_status: next.current_status,
      correction_of: ch.correction_of || '',
      actor_name: actor.name,
      actor_email: actor.email,
      receiver_name: ch.receiver_user_id ? userName_(ch.receiver_user_id) : '',
      before_json: JSON.stringify(Object.assign(before, infoBefore)),
      after_json: JSON.stringify(after)
    });
    if (ch.isNew) assetInserts.push(next); else assetUpdates.push(next);
  });
  // ③ 저널(이력) 먼저
  DB.insert('TX', txRows);
  // ④ 마스터 반영
  if (assetInserts.length) DB.insert('ASSETS', assetInserts);
  if (assetUpdates.length) DB.update('ASSETS', assetUpdates);
  return txRows;
}

function stripMeta_(o) {
  var c = {};
  Object.keys(o).forEach(function (k) { if (k.indexOf('__') !== 0) c[k] = o[k]; });
  return c;
}

/**
 * 이력(마지막 after_json)으로 장비 마스터 복구. 락 안에서 호출.
 * @return 복구된 asset_id 목록
 */
function reconcileFromHistory_(assetIds) {
  var want = {};
  assetIds.forEach(function (id) { want[id] = true; });
  var lastRow = {};
  DB.column('TX', 'asset_id').forEach(function (c) { if (want[c.value]) lastRow[c.value] = c.row; });
  var ids = Object.keys(lastRow);
  if (!ids.length) return [];
  var txs = DB.rowsAt('TX', ids.map(function (id) { return lastRow[id]; }));
  var repaired = [];
  var updates = [], inserts = [];
  txs.forEach(function (t) {
    var after;
    try { after = JSON.parse(t.after_json || '{}'); } catch (e) { return; }
    var master = DB.find('ASSETS', 'asset_id', t.asset_id);
    if (!master) {
      if (t.action_type === ACTION.REGISTER && after.asset_id) { inserts.push(after); repaired.push(t.asset_id); }
      return;
    }
    var diff = Object.keys(after).some(function (k) {
      return k !== 'version' && k !== 'updated_at' && k !== 'created_at' && str_(master[k]) !== str_(after[k]);
    });
    if (diff) {
      var fixed = Object.assign({}, master, after, { updated_at: nowIso_(), version: (Number(master.version) || 0) + 1 });
      fixed.__row = master.__row;
      updates.push(fixed);
      repaired.push(t.asset_id);
    }
  });
  if (inserts.length) DB.insert('ASSETS', inserts);
  if (updates.length) DB.update('ASSETS', updates);
  return repaired;
}

function activeProject_(projectId) {
  var p = DB.find('PROJECTS', 'project_id', str_(projectId));
  if (!p) throw AppError('VALIDATION', '프로젝트를 찾을 수 없습니다.');
  if (p.status === 'DONE' || p.status === 'CANCELLED') throw AppError('VALIDATION', '종료/취소된 프로젝트에는 반출할 수 없습니다.');
  return p;
}

function activeReceiver_(ctx, receiverId) {
  var id = str_(receiverId) || ctx.user.user_id;
  var u = DB.find('USERS', 'user_id', id);
  if (!isUserActive_(u)) throw AppError('VALIDATION', '담당자가 승인된 활성 사용자가 아닙니다.');
  return u;
}

function checkoutBlockReason_(a) {
  if (!a) return '등록되지 않은 장비입니다.';
  switch (a.current_status) {
    case STATUS.AVAILABLE: return null;
    case STATUS.CHECKED_OUT: return '이미 반출 중인 장비입니다.' + (a.current_project_id ? ' (' + a.current_project_id + ')' : '');
    case STATUS.INSPECTION: return '점검 중인 장비는 반출할 수 없습니다.';
    case STATUS.REPAIR: return '수리 중인 장비는 반출할 수 없습니다.';
    case STATUS.DAMAGED: return '파손 장비는 반출할 수 없습니다.';
    case STATUS.LOST: return '분실 처리된 장비입니다.';
    case STATUS.RETIRED: return '폐기(비활성) 장비입니다.';
    default: return '반출 가능한 상태가 아닙니다.';
  }
}

function uniqIds_(ids) {
  var seen = {}, out = [];
  (ids || []).forEach(function (id) {
    var s = str_(id).toUpperCase();
    if (s && !seen[s]) { seen[s] = true; out.push(s); }
  });
  return out;
}

// ---------------- 반출 ----------------
registerApi_('tx.checkout', 'operate', function (ctx, p) {
  var ids = uniqIds_(p.asset_ids);
  if (!ids.length) throw AppError('VALIDATION', '반출할 장비가 없습니다.');
  if (ids.length > APP.MAX_BATCH) throw AppError('VALIDATION', '한 번에 최대 ' + APP.MAX_BATCH + '개까지 반출할 수 있습니다.');
  if (!isDateStr_(p.due_date)) throw AppError('VALIDATION', '반납 예정일을 입력해 주세요.');
  if (p.due_date < todayStr_()) throw AppError('VALIDATION', '반납 예정일은 오늘 이후여야 합니다.');

  return idempotent_(ctx, p.request_id, function () {
    var project = activeProject_(p.project_id);
    var receiver = activeReceiver_(ctx, p.receiver_user_id);
    var results = [];
    var changes = [];
    ids.forEach(function (id) {
      var a = DB.find('ASSETS', 'asset_id', id);
      var reason = checkoutBlockReason_(a);
      if (reason) { results.push({ asset_id: id, ok: false, reason: reason }); return; }
      results.push({ asset_id: id, ok: true });
      changes.push({
        asset: a, action: ACTION.CHECKOUT,
        state: {
          current_status: STATUS.CHECKED_OUT,
          current_location: project.location || project.project_name,
          current_project_id: project.project_id,
          current_user_id: receiver.user_id,
          return_due_date: p.due_date
        },
        project_id: project.project_id, receiver_user_id: receiver.user_id,
        due_date: p.due_date, notes: p.notes
      });
    });
    var failed = results.filter(function (r) { return !r.ok; });
    if (failed.length && !p.allow_partial) {
      // 전체 거부 — 아무것도 기록하지 않는다. (캐시에 남지 않도록 throw)
      throw AppError('PARTIAL_INVALID', failed.length + '개 장비를 반출할 수 없습니다. 목록을 확인해 주세요.', { results: results });
    }
    if (!changes.length) throw AppError('PARTIAL_INVALID', '반출 가능한 장비가 없습니다.', { results: results });
    var groupId = 'CO-' + stampCompact_() + '-' + shortId_().slice(0, 6);
    var txs = commitChanges_(ctx, p.request_id, changes, groupId);
    var byAsset = indexBy_(txs, 'asset_id');
    results.forEach(function (r) { if (r.ok) r.transaction_id = byAsset[r.asset_id].transaction_id; });
    return {
      checkout_group_id: groupId, project_id: project.project_id, project_name: project.project_name,
      receiver: publicUser_(receiver), due_date: p.due_date,
      results: results, success_count: changes.length, fail_count: failed.length
    };
  });
});

// ---------------- 반납 ----------------
registerApi_('tx.return', 'operate', function (ctx, p) {
  var items = (p.items || []).map(function (it) {
    return { asset_id: str_(it.asset_id).toUpperCase(), condition: it.condition === 'ISSUE' ? 'ISSUE' : 'OK', notes: clip_(it.notes, 1000), photo_url: str_(it.photo_url) };
  });
  var seen = {};
  items = items.filter(function (it) { if (!it.asset_id || seen[it.asset_id]) return false; seen[it.asset_id] = true; return true; });
  if (!items.length) throw AppError('VALIDATION', '반납할 장비가 없습니다.');
  if (items.length > APP.MAX_BATCH) throw AppError('VALIDATION', '한 번에 최대 ' + APP.MAX_BATCH + '개까지 반납할 수 있습니다.');
  var requirePhoto = toBool_(getSetting_('SYSTEM', 'REQUIRE_PHOTO_ON_ISSUE', 'TRUE'));

  return idempotent_(ctx, p.request_id, function () {
    var results = [], changes = [], inspections = [];
    var outRows = lastCheckoutRows_(items.map(function (i) { return i.asset_id; }));
    items.forEach(function (it) {
      var a = DB.find('ASSETS', 'asset_id', it.asset_id);
      if (!a) { results.push({ asset_id: it.asset_id, ok: false, reason: '등록되지 않은 장비입니다.' }); return; }
      if (a.current_status !== STATUS.CHECKED_OUT) { results.push({ asset_id: it.asset_id, ok: false, reason: '반출 상태가 아닙니다. (현재: ' + (STATUS_LABEL[a.current_status] || a.current_status) + ')' }); return; }
      if (!outRows[it.asset_id]) { results.push({ asset_id: it.asset_id, ok: false, reason: '반출 기록이 없습니다. 관리자에게 문의하세요.' }); return; }
      if (it.condition === 'ISSUE') {
        if (!it.notes) { results.push({ asset_id: it.asset_id, ok: false, reason: '이상 내용 메모가 필요합니다.' }); return; }
        if (requirePhoto && !it.photo_url) { results.push({ asset_id: it.asset_id, ok: false, reason: '이상 장비는 사진 첨부가 필요합니다.' }); return; }
      }
      var inspId = '';
      if (it.condition === 'ISSUE') {
        inspId = 'INS-' + stampCompact_() + '-' + shortId_().slice(0, 6);
        inspections.push({
          inspection_id: inspId, asset_id: a.asset_id, type: 'RETURN_ISSUE', condition: 'ISSUE',
          description: it.notes, photo_url: it.photo_url, reported_by: ctx.user.user_id, inspected_by: '',
          reported_at: nowIso_(), resolved_at: '', resolution: '', status: 'OPEN'
        });
      }
      results.push({ asset_id: it.asset_id, ok: true, condition: it.condition, inspection_id: inspId });
      changes.push({
        asset: a, action: ACTION.RETURN,
        state: {
          current_status: it.condition === 'ISSUE' ? STATUS.INSPECTION : STATUS.AVAILABLE,
          current_location: a.home_location || '',
          current_project_id: '', current_user_id: '', return_due_date: ''
        },
        project_id: a.current_project_id, receiver_user_id: a.current_user_id,
        condition: it.condition, location: a.home_location, photo_url: it.photo_url,
        notes: (inspId ? '[' + inspId + '] ' : '') + it.notes
      });
    });
    var failed = results.filter(function (r) { return !r.ok; });
    if (failed.length && !p.allow_partial) throw AppError('PARTIAL_INVALID', failed.length + '개 장비를 반납할 수 없습니다.', { results: results });
    if (!changes.length) throw AppError('PARTIAL_INVALID', '반납 가능한 장비가 없습니다.', { results: results });
    var txs = commitChanges_(ctx, p.request_id, changes, '');
    if (inspections.length) DB.insert('INSPECTIONS', inspections);
    var byAsset = indexBy_(txs, 'asset_id');
    results.forEach(function (r) { if (r.ok) r.transaction_id = byAsset[r.asset_id].transaction_id; });
    return { results: results, success_count: changes.length, fail_count: failed.length };
  });
});

/** 각 장비의 마지막 CHECKOUT/TRANSFER 이력 행 번호 (반출 기록 존재 확인) */
function lastCheckoutRows_(assetIds) {
  var want = {};
  assetIds.forEach(function (id) { want[id] = true; });
  var col = DB.column('TX', 'asset_id');
  var act = DB.column('TX', 'action_type');
  var out = {};
  for (var i = 0; i < col.length; i++) {
    if (want[col[i].value] && (act[i].value === ACTION.CHECKOUT || act[i].value === ACTION.TRANSFER ||
      (act[i].value === ACTION.CORRECTION))) {
      out[col[i].value] = col[i].row;
    }
  }
  return out;
}

// ---------------- 이관 (현장 간 이동, 반납 없이 프로젝트 변경) ----------------
registerApi_('tx.transfer', 'operate', function (ctx, p) {
  var ids = uniqIds_(p.asset_ids);
  if (!ids.length) throw AppError('VALIDATION', '이관할 장비가 없습니다.');
  if (!isDateStr_(p.due_date)) throw AppError('VALIDATION', '반납 예정일을 입력해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var project = activeProject_(p.project_id);
    var receiver = activeReceiver_(ctx, p.receiver_user_id);
    var results = [], changes = [];
    ids.forEach(function (id) {
      var a = DB.find('ASSETS', 'asset_id', id);
      if (!a || a.current_status !== STATUS.CHECKED_OUT) { results.push({ asset_id: id, ok: false, reason: '반출 중인 장비만 이관할 수 있습니다.' }); return; }
      results.push({ asset_id: id, ok: true });
      changes.push({
        asset: a, action: ACTION.TRANSFER,
        state: {
          current_status: STATUS.CHECKED_OUT, current_location: project.location || project.project_name,
          current_project_id: project.project_id, current_user_id: receiver.user_id, return_due_date: p.due_date
        },
        project_id: project.project_id, receiver_user_id: receiver.user_id, due_date: p.due_date,
        notes: '이관: ' + a.current_project_id + ' → ' + project.project_id + (p.notes ? ' / ' + p.notes : '')
      });
    });
    var failed = results.filter(function (r) { return !r.ok; });
    if (failed.length && !p.allow_partial) throw AppError('PARTIAL_INVALID', failed.length + '개 장비를 이관할 수 없습니다.', { results: results });
    if (!changes.length) throw AppError('PARTIAL_INVALID', '이관 가능한 장비가 없습니다.', { results: results });
    commitChanges_(ctx, p.request_id, changes, 'TR-' + stampCompact_() + '-' + shortId_().slice(0, 6));
    return { results: results, success_count: changes.length, fail_count: failed.length };
  });
});

// ---------------- 이력 조회 ----------------
function clientTx_(t) {
  var o = stripMeta_(t);
  delete o.before_json; delete o.after_json;
  return o;
}

registerApi_('tx.list', 'read', function (ctx, p) {
  var limit = Math.min(Number(p.limit) || 300, 2000);
  var rows;
  var filterAsset = str_(p.asset_id).toUpperCase();
  var hasFilter = filterAsset || p.project_id || p.user_id || p.action_type || p.from || p.to || p.q;
  if (filterAsset && !p.project_id && !p.user_id) {
    var rowNums = DB.column('TX', 'asset_id').filter(function (c) { return c.value === filterAsset; }).map(function (c) { return c.row; });
    rows = DB.rowsAt('TX', rowNums);
  } else if (hasFilter) {
    rows = DB.all('TX');
  } else {
    rows = DB.tail('TX', limit);
  }
  var q = str_(p.q).toLowerCase();
  rows = rows.filter(function (t) {
    if (filterAsset && t.asset_id !== filterAsset) return false;
    if (p.project_id && t.project_id !== p.project_id) return false;
    if (p.user_id && t.actor_user_id !== p.user_id && t.receiver_user_id !== p.user_id) return false;
    if (p.action_type && t.action_type !== p.action_type) return false;
    if (p.from && String(t.timestamp).slice(0, 10) < p.from) return false;
    if (p.to && String(t.timestamp).slice(0, 10) > p.to) return false;
    if (q && (t.asset_id + ' ' + t.notes + ' ' + t.actor_name + ' ' + t.project_id + ' ' + t.transaction_id).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  var total = hasFilter ? rows.length : DB.count('TX');
  rows = rows.slice(-limit).reverse(); // 최신순
  // 정정된 거래 표시
  var corrected = {};
  DB.column('TX', 'correction_of').forEach(function (c) { if (c.value) corrected[c.value] = true; });
  return {
    total: total,
    transactions: rows.map(function (t) { var o = clientTx_(t); o.corrected = !!corrected[t.transaction_id]; return o; })
  };
});

// ---------------- 정정 (삭제 대신 CORRECTION 기록) ----------------
registerApi_('tx.correct', 'admin', function (ctx, p) {
  var txIds = (p.transaction_ids || []).map(str_).filter(Boolean);
  if (!txIds.length) throw AppError('VALIDATION', '정정할 거래를 선택해 주세요.');
  if (!str_(p.reason)) throw AppError('VALIDATION', '정정 사유를 입력해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var col = DB.column('TX', 'transaction_id');
    var assetCol = DB.column('TX', 'asset_id');
    var corrCol = DB.column('TX', 'correction_of');
    var already = {};
    corrCol.forEach(function (c) { if (c.value) already[c.value] = true; });
    var lastByAsset = {};
    assetCol.forEach(function (c) { lastByAsset[c.value] = c.row; });
    var rowOf = {};
    col.forEach(function (c) { rowOf[c.value] = c.row; });
    var results = [], changes = [];
    var targets = DB.rowsAt('TX', txIds.map(function (id) { return rowOf[id]; }).filter(Boolean));
    var byId = indexBy_(targets, 'transaction_id');
    txIds.forEach(function (id) {
      var t = byId[id];
      if (!t) { results.push({ transaction_id: id, ok: false, reason: '거래를 찾을 수 없습니다.' }); return; }
      if (already[id]) { results.push({ transaction_id: id, ok: false, reason: '이미 정정된 거래입니다.' }); return; }
      if (t.action_type === ACTION.CORRECTION || t.action_type === ACTION.REGISTER) { results.push({ transaction_id: id, ok: false, reason: '이 유형은 정정할 수 없습니다. (등록 취소는 폐기 처리)' }); return; }
      if (lastByAsset[t.asset_id] !== t.__row) { results.push({ transaction_id: id, ok: false, reason: '이후 거래가 있어 정정할 수 없습니다. 최신 거래부터 정정하세요.' }); return; }
      var a = DB.find('ASSETS', 'asset_id', t.asset_id);
      var before;
      try { before = JSON.parse(t.before_json || '{}'); } catch (e) { before = null; }
      if (!a || !before || !before.current_status) { results.push({ transaction_id: id, ok: false, reason: '복원할 이전 상태 정보가 없습니다.' }); return; }
      var state = pick_(before, STATE_FIELDS);
      var info = {};
      Object.keys(before).forEach(function (k) { if (STATE_FIELDS.indexOf(k) < 0 && k in a) info[k] = before[k]; });
      results.push({ transaction_id: id, ok: true, asset_id: t.asset_id });
      changes.push({
        asset: a, action: ACTION.CORRECTION, state: state, info: Object.keys(info).length ? info : null,
        project_id: state.current_project_id, receiver_user_id: state.current_user_id,
        due_date: state.return_due_date, correction_of: id, notes: '정정(' + t.action_type + ' 취소): ' + p.reason
      });
    });
    if (!changes.length) throw AppError('PARTIAL_INVALID', '정정 가능한 거래가 없습니다.', { results: results });
    commitChanges_(ctx, p.request_id, changes, '');
    return { results: results, success_count: changes.length };
  });
});
