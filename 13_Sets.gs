/** 장비 세트 관리 — 한 장비는 하나의 세트에만 속한다 */

function nextSetId_() {
  var max = 0;
  DB.all('SETS').forEach(function (s) {
    var m = /^SET-(\d+)$/.exec(s.set_id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'SET-' + ('00' + (max + 1)).slice(-3);
}

registerApi_('sets.list', 'read', function (ctx) {
  var groups = {};
  var assets = indexBy_(DB.all('ASSETS'), 'asset_id');
  DB.all('SETS').forEach(function (s) {
    var g = groups[s.set_id] = groups[s.set_id] || { set_id: s.set_id, set_name: s.set_name, items: [] };
    var a = assets[s.asset_id];
    g.items.push({
      asset_id: s.asset_id, required: s.required, quantity: s.quantity, notes: s.notes,
      asset_name: a ? a.asset_name : '(삭제/없음)', status: a ? a.current_status : ''
    });
  });
  return { sets: Object.keys(groups).sort().map(function (k) { return groups[k]; }) };
});

registerApi_('sets.save', 'manage', function (ctx, p) {
  var s = p.set || {};
  var name = clip_(s.set_name, 120);
  if (!name) throw AppError('VALIDATION', '세트명은 필수입니다.');
  var items = (s.items || []).map(function (it) {
    return { asset_id: str_(it.asset_id).toUpperCase(), required: it.required !== false, quantity: Math.max(1, parseInt(it.quantity, 10) || 1), notes: clip_(it.notes, 200) };
  });
  var seen = {};
  items = items.filter(function (it) { if (!it.asset_id || seen[it.asset_id]) return false; seen[it.asset_id] = true; return true; });
  if (!items.length) throw AppError('VALIDATION', '구성품을 1개 이상 추가해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var setId = str_(s.set_id) || nextSetId_();
    var errors = [];
    items.forEach(function (it) {
      var a = DB.find('ASSETS', 'asset_id', it.asset_id);
      if (!a) errors.push(it.asset_id + ': 등록되지 않은 장비');
      else if (a.set_id && a.set_id !== setId) errors.push(it.asset_id + ': 이미 ' + a.set_id + ' 세트에 속해 있음');
    });
    if (errors.length) throw AppError('VALIDATION', errors.join(' / '));
    var oldRows = DB.filter('SETS', function (r) { return r.set_id === setId; });
    var oldMembers = oldRows.map(function (r) { return r.asset_id; });
    DB.remove('SETS', oldRows);
    DB.insert('SETS', items.map(function (it) {
      return { set_id: setId, set_name: name, asset_id: it.asset_id, quantity: it.quantity, required: it.required, notes: it.notes };
    }));
    // 장비 마스터 set_id 동기화 (EDIT 이력 기록)
    var newMembers = items.map(function (it) { return it.asset_id; });
    var changes = [];
    newMembers.forEach(function (id) {
      var a = DB.find('ASSETS', 'asset_id', id);
      if (a.set_id !== setId) changes.push({ asset: a, action: ACTION.EDIT, info: { set_id: setId }, notes: '세트 편입: ' + setId });
    });
    oldMembers.forEach(function (id) {
      if (newMembers.indexOf(id) >= 0) return;
      var a = DB.find('ASSETS', 'asset_id', id);
      if (a && a.set_id === setId) changes.push({ asset: a, action: ACTION.EDIT, info: { set_id: '' }, notes: '세트 제외: ' + setId });
    });
    if (changes.length) commitChanges_(ctx, p.request_id, changes, '');
    return { set_id: setId, count: items.length };
  });
});

registerApi_('sets.delete', 'manage', function (ctx, p) {
  var setId = str_(p.set_id);
  return idempotent_(ctx, p.request_id, function () {
    var rows = DB.filter('SETS', function (r) { return r.set_id === setId; });
    if (!rows.length) throw AppError('NOT_FOUND', '세트를 찾을 수 없습니다.');
    DB.remove('SETS', rows);
    var changes = [];
    rows.forEach(function (r) {
      var a = DB.find('ASSETS', 'asset_id', r.asset_id);
      if (a && a.set_id === setId) changes.push({ asset: a, action: ACTION.EDIT, info: { set_id: '' }, notes: '세트 해체: ' + setId });
    });
    if (changes.length) commitChanges_(ctx, p.request_id, changes, '');
    return { set_id: setId };
  });
});
