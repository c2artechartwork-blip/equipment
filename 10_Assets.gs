/** 장비 등록·조회·수정, CSV 가져오기, 스캔 조회, 대시보드 */

var ASSET_INFO_FIELDS = ['asset_name', 'manufacturer', 'model', 'serial_number', 'purchase_date',
  'purchase_price', 'photo_url', 'home_location', 'notes'];
var ASSET_ID_RE = /^C2-([A-Z]{2})-(\d{3,6})$/;

function clientAsset_(ctx, a) {
  var o = stripMeta_(a);
  if (!hasPerm_(ctx.user, 'manage')) delete o.purchase_price;
  return o;
}

function isOverdue_(a) {
  return a.current_status === STATUS.CHECKED_OUT && a.return_due_date && a.return_due_date < todayStr_();
}

/** 입력 검증 + 정리. errors 배열에 사유 추가 */
function cleanAssetInfo_(input, errors, opts) {
  var out = {};
  opts = opts || {};
  ASSET_INFO_FIELDS.forEach(function (f) {
    if (!(f in input)) return;
    var v = input[f];
    if (f === 'purchase_price') {
      var s = str_(v).replace(/[,\s원₩]/g, '');
      if (s === '') { out[f] = ''; return; }
      var n = Number(s);
      if (isNaN(n) || n < 0) { errors.push('구매가격은 0 이상의 숫자여야 합니다.'); return; }
      out[f] = Math.round(n);
      return;
    }
    if (f === 'purchase_date') {
      var d = str_(v).replace(/\./g, '-').replace(/\//g, '-');
      if (d && !isDateStr_(d)) { errors.push('구매일 형식은 YYYY-MM-DD 입니다.'); return; }
      out[f] = d;
      return;
    }
    if (f === 'home_location') {
      var loc = str_(v);
      if (loc && opts.locations && opts.locations.indexOf(loc) < 0) { errors.push('등록되지 않은 보관위치: ' + loc); return; }
      out[f] = loc;
      return;
    }
    if (f === 'photo_url') { out[f] = clip_(v, 300); return; }
    out[f] = clip_(v, f === 'notes' ? 1000 : 120);
  });
  if ('asset_name' in out && !out.asset_name) errors.push('장비명은 필수입니다.');
  return out;
}

/** 다음 관리번호 (락 안에서 호출). 폐기된 장비 번호도 재사용하지 않는다. */
function nextAssetIds_(code, count, reserved) {
  var max = 0;
  DB.all('ASSETS').forEach(function (a) {
    var m = ASSET_ID_RE.exec(a.asset_id);
    if (m && m[1] === code) max = Math.max(max, parseInt(m[2], 10));
  });
  Object.keys(reserved || {}).forEach(function (id) {
    var m = ASSET_ID_RE.exec(id);
    if (m && m[1] === code) max = Math.max(max, parseInt(m[2], 10));
  });
  var out = [];
  for (var i = 1; i <= count; i++) {
    var n = max + i;
    out.push('C2-' + code + '-' + (n < 1000 ? ('00' + n).slice(-3) : String(n)));
  }
  return out;
}

function serialIndex_() {
  var m = {};
  DB.all('ASSETS').forEach(function (a) {
    var s = str_(a.serial_number).toUpperCase();
    if (s) (m[s] = m[s] || []).push(a.asset_id);
  });
  return m;
}

/**
 * 신규 장비 행들을 검증해 REGISTER 변경 목록으로 만든다 (락 안에서).
 * rows: [{category, asset_id?, asset_name, ...}]
 */
function prepareNewAssets_(rows) {
  var cats = getCategoryMap_();
  var locations = getLocations_();
  var serials = serialIndex_();
  var existingIds = indexBy_(DB.all('ASSETS'), 'asset_id');
  var reserved = {};
  var fileSerials = {};
  var report = [];
  rows.forEach(function (r, i) {
    var errors = [], warnings = [];
    var code = str_(r.category).toUpperCase();
    if (!cats[code]) {
      // 카테고리 이름으로도 허용
      Object.keys(cats).forEach(function (k) { if (cats[k] === str_(r.category)) code = k; });
    }
    if (!cats[code]) errors.push('알 수 없는 카테고리: ' + str_(r.category));
    var info = cleanAssetInfo_(r, errors, { locations: locations });
    if (!info.asset_name) { if (errors.indexOf('장비명은 필수입니다.') < 0) errors.push('장비명은 필수입니다.'); }
    var wantId = str_(r.asset_id).toUpperCase();
    if (wantId) {
      var m = ASSET_ID_RE.exec(wantId);
      if (!m) errors.push('관리번호 형식 오류(C2-XX-001): ' + wantId);
      else if (cats[code] && m[1] !== code) errors.push('관리번호의 카테고리 코드가 카테고리와 다릅니다: ' + wantId);
      if (existingIds[wantId] || reserved[wantId]) errors.push('이미 존재하는 관리번호: ' + wantId);
    }
    var serial = str_(info.serial_number).toUpperCase();
    if (serial) {
      if (serials[serial]) warnings.push('시리얼번호 중복(기존 ' + serials[serial].join(', ') + ')');
      if (fileSerials[serial]) warnings.push('시리얼번호 중복(파일 ' + fileSerials[serial] + '행)');
      fileSerials[serial] = i + 1;
    }
    if (!errors.length && wantId) reserved[wantId] = true;
    report.push({ index: i, code: code, wantId: wantId, info: info, errors: errors, warnings: warnings });
  });
  // ID 부여
  report.forEach(function (r) {
    if (r.errors.length) return;
    if (!r.wantId) {
      r.wantId = nextAssetIds_(r.code, 1, reserved)[0];
      reserved[r.wantId] = true;
    }
  });
  return report;
}

function newAssetRecord_(id, code, info) {
  var a = {
    asset_id: id, asset_name: '', category: code, manufacturer: '', model: '', serial_number: '',
    purchase_date: '', purchase_price: '', photo_url: '', home_location: '', current_location: '',
    current_status: STATUS.AVAILABLE, current_project_id: '', current_user_id: '', return_due_date: '',
    set_id: '', qr_value: id, notes: '', created_at: '', updated_at: '', version: 0
  };
  Object.assign(a, info);
  a.current_location = a.home_location || '';
  return a;
}

registerApi_('assets.list', 'read', function (ctx, p) {
  var assets = DB.all('ASSETS').map(function (a) {
    var o = clientAsset_(ctx, a);
    o.overdue = isOverdue_(a);
    return o;
  });
  return { assets: assets, today: todayStr_() };
});

registerApi_('assets.get', 'read', function (ctx, p) {
  var id = str_(p.asset_id).toUpperCase();
  var a = DB.find('ASSETS', 'asset_id', id);
  if (!a) throw AppError('NOT_FOUND', '장비를 찾을 수 없습니다: ' + id);
  var rowNums = DB.column('TX', 'asset_id').filter(function (c) { return c.value === id; }).map(function (c) { return c.row; });
  var history = DB.rowsAt('TX', rowNums.slice(-300)).map(clientTx_).reverse();
  var inspections = DB.filter('INSPECTIONS', function (i) { return i.asset_id === id; }).map(stripMeta_).reverse();
  var set = null;
  if (a.set_id) {
    var items = DB.filter('SETS', function (s) { return s.set_id === a.set_id; });
    if (items.length) set = { set_id: a.set_id, set_name: items[0].set_name, items: items.map(stripMeta_) };
  }
  var o = clientAsset_(ctx, a);
  o.overdue = isOverdue_(a);
  var project = a.current_project_id ? DB.find('PROJECTS', 'project_id', a.current_project_id) : null;
  return {
    asset: o, history: history, inspections: inspections, set: set,
    project: project ? stripMeta_(project) : null,
    current_user: publicUser_(a.current_user_id ? DB.find('USERS', 'user_id', a.current_user_id) : null)
  };
});

/** QR/관리번호 조회. 세트 QR(SET:...) 은 구성품 목록을 반환 */
function parseScanCode_(code) {
  var s = str_(code);
  var m = /[?&]a=([^&#]+)/.exec(s);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toUpperCase().replace(/\s+/g, '');
  if (s.indexOf('SET:') === 0) return { type: 'set', id: s.slice(4) };
  if (/^SET-/.test(s)) return { type: 'set', id: s };
  return { type: 'asset', id: s };
}

registerApi_('assets.lookup', 'read', function (ctx, p) {
  var parsed = parseScanCode_(p.code);
  if (!parsed.id) throw AppError('VALIDATION', '코드를 인식하지 못했습니다.');
  var canOperate = hasPerm_(ctx.user, 'operate');
  if (parsed.type === 'set') {
    var items = DB.filter('SETS', function (s) { return s.set_id === parsed.id; });
    if (!items.length) throw AppError('NOT_FOUND', '세트를 찾을 수 없습니다: ' + parsed.id);
    return {
      type: 'set', set_id: parsed.id, set_name: items[0].set_name,
      items: items.map(function (it) {
        var a = DB.find('ASSETS', 'asset_id', it.asset_id);
        return {
          asset_id: it.asset_id, required: it.required, quantity: it.quantity, notes: it.notes,
          asset: a ? clientAsset_(ctx, a) : null,
          can_checkout: canOperate && !checkoutBlockReason_(a),
          block_reason: checkoutBlockReason_(a)
        };
      })
    };
  }
  var a = DB.find('ASSETS', 'asset_id', parsed.id);
  if (!a) throw AppError('NOT_FOUND', '등록되지 않은 장비입니다: ' + parsed.id);
  var o = clientAsset_(ctx, a);
  o.overdue = isOverdue_(a);
  var project = a.current_project_id ? DB.find('PROJECTS', 'project_id', a.current_project_id) : null;
  return {
    type: 'asset', asset: o,
    project: project ? pick_(project, ['project_id', 'project_name', 'location']) : null,
    current_user: publicUser_(a.current_user_id ? DB.find('USERS', 'user_id', a.current_user_id) : null),
    can_checkout: canOperate && !checkoutBlockReason_(a),
    block_reason: checkoutBlockReason_(a),
    can_return: canOperate && a.current_status === STATUS.CHECKED_OUT
  };
});

registerApi_('assets.create', 'manage', function (ctx, p) {
  var input = p.asset || {};
  return idempotent_(ctx, p.request_id, function () {
    var report = prepareNewAssets_([input])[0];
    if (report.errors.length) throw AppError('VALIDATION', report.errors.join(' / '));
    if (report.warnings.length && !p.confirm_warnings) {
      throw AppError('NEEDS_CONFIRM', report.warnings.join(' / ') + ' — 계속 등록하시겠습니까?', { warnings: report.warnings });
    }
    var rec = newAssetRecord_(report.wantId, report.code, report.info);
    var txs = commitChanges_(ctx, p.request_id, [{ asset: rec, isNew: true, action: ACTION.REGISTER, notes: '신규 등록' }], '');
    return { asset_id: rec.asset_id, transaction_id: txs[0].transaction_id };
  });
});

registerApi_('assets.update', 'manage', function (ctx, p) {
  var id = str_(p.asset_id).toUpperCase();
  return idempotent_(ctx, p.request_id, function () {
    var a = DB.find('ASSETS', 'asset_id', id);
    if (!a) throw AppError('NOT_FOUND', '장비를 찾을 수 없습니다.');
    if (Number(p.version) !== Number(a.version)) {
      throw AppError('CONFLICT', '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.');
    }
    var errors = [];
    var info = cleanAssetInfo_(p.fields || {}, errors, { locations: getLocations_() });
    if (errors.length) throw AppError('VALIDATION', errors.join(' / '));
    var changed = {};
    Object.keys(info).forEach(function (k) { if (str_(info[k]) !== str_(a[k])) changed[k] = info[k]; });
    if (!Object.keys(changed).length) return { asset_id: id, changed: [] };
    if (changed.serial_number && !p.confirm_warnings) {
      var dup = serialIndex_()[str_(changed.serial_number).toUpperCase()];
      if (dup && dup.filter(function (x) { return x !== id; }).length) {
        throw AppError('NEEDS_CONFIRM', '시리얼번호 중복(기존 ' + dup.join(', ') + ') — 계속 저장하시겠습니까?');
      }
    }
    // 보관 중인 장비의 기본 위치를 바꾸면 현재 위치도 함께 이동
    var state = null;
    if ('home_location' in changed && a.current_status !== STATUS.CHECKED_OUT) state = { current_location: changed.home_location };
    commitChanges_(ctx, p.request_id, [{ asset: a, action: ACTION.EDIT, info: changed, state: state, notes: '정보 수정: ' + Object.keys(changed).join(', ') }], '');
    return { asset_id: id, changed: Object.keys(changed) };
  });
});

registerApi_('assets.bulkUpdate', 'manage', function (ctx, p) {
  var ids = uniqIds_(p.asset_ids);
  if (!ids.length) throw AppError('VALIDATION', '선택된 장비가 없습니다.');
  if (ids.length > 500) throw AppError('VALIDATION', '한 번에 최대 500개까지 수정할 수 있습니다.');
  var allowed = ['home_location', 'manufacturer', 'notes'];
  var fields = {};
  allowed.forEach(function (f) { if (p.fields && f in p.fields && p.fields[f] !== null) fields[f] = p.fields[f]; });
  if (!Object.keys(fields).length) throw AppError('VALIDATION', '변경할 항목이 없습니다.');
  return idempotent_(ctx, p.request_id, function () {
    var errors = [];
    var info = cleanAssetInfo_(fields, errors, { locations: getLocations_() });
    if (errors.length) throw AppError('VALIDATION', errors.join(' / '));
    var changes = [];
    ids.forEach(function (id) {
      var a = DB.find('ASSETS', 'asset_id', id);
      if (!a) return;
      var state = ('home_location' in info && a.current_status !== STATUS.CHECKED_OUT) ? { current_location: info.home_location } : null;
      changes.push({ asset: a, action: ACTION.EDIT, info: info, state: state, notes: '일괄 수정: ' + Object.keys(info).join(', ') });
    });
    commitChanges_(ctx, p.request_id, changes, 'BE-' + stampCompact_() + '-' + shortId_().slice(0, 6));
    return { updated: changes.length };
  });
});

registerApi_('assets.importCsv', 'manage', function (ctx, p) {
  var rows = p.rows || [];
  if (!Array.isArray(rows) || !rows.length) throw AppError('VALIDATION', '가져올 행이 없습니다.');
  if (rows.length > APP.MAX_IMPORT_ROWS) throw AppError('VALIDATION', '한 번에 최대 ' + APP.MAX_IMPORT_ROWS + '행까지 가져올 수 있습니다.');
  var run = function () {
    var report = prepareNewAssets_(rows);
    var errorRows = report.filter(function (r) { return r.errors.length; });
    var summary = report.map(function (r) {
      return { row: r.index + 2, asset_id: r.errors.length ? '' : r.wantId, asset_name: r.info.asset_name || '', errors: r.errors, warnings: r.warnings };
    });
    if (p.dryRun) return { dryRun: true, total: rows.length, valid: rows.length - errorRows.length, errors: errorRows.length, rows: summary };
    if (errorRows.length) throw AppError('VALIDATION', errorRows.length + '개 행에 오류가 있어 가져오지 않았습니다.', { rows: summary });
    var changes = report.map(function (r) {
      return { asset: newAssetRecord_(r.wantId, r.code, r.info), isNew: true, action: ACTION.REGISTER, notes: 'CSV 일괄 등록' };
    });
    commitChanges_(ctx, p.request_id, changes, 'IM-' + stampCompact_() + '-' + shortId_().slice(0, 6));
    return { dryRun: false, imported: changes.length, rows: summary };
  };
  if (p.dryRun) return withLock_(run);
  return idempotent_(ctx, p.request_id, run);
});

/** 상태 변경: 분실/폐기/점검/수리/파손/복귀 (반출 중 장비는 반납 절차로) */
registerApi_('assets.setStatus', 'manage', function (ctx, p) {
  var ids = uniqIds_(p.asset_ids || [p.asset_id]);
  var target = str_(p.status);
  var map = {
    LOST: ACTION.LOST, RETIRED: ACTION.RETIRE, INSPECTION: ACTION.INSPECT, REPAIR: ACTION.REPAIR,
    DAMAGED: ACTION.INSPECT, AVAILABLE: ACTION.INSPECT
  };
  if (!map[target]) throw AppError('VALIDATION', '변경할 수 없는 상태입니다.');
  if (!str_(p.notes)) throw AppError('VALIDATION', '사유를 입력해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var results = [], changes = [];
    ids.forEach(function (id) {
      var a = DB.find('ASSETS', 'asset_id', id);
      if (!a) { results.push({ asset_id: id, ok: false, reason: '장비 없음' }); return; }
      if (a.current_status === STATUS.CHECKED_OUT && target !== STATUS.LOST) {
        results.push({ asset_id: id, ok: false, reason: '반출 중 장비는 먼저 반납 처리하세요. (분실 처리만 가능)' }); return;
      }
      if (a.current_status === target) { results.push({ asset_id: id, ok: false, reason: '이미 해당 상태입니다.' }); return; }
      var st = { current_status: target };
      if (target !== STATUS.LOST) { st.current_location = a.home_location || ''; }
      if (target !== STATUS.CHECKED_OUT) { st.current_project_id = target === STATUS.LOST ? a.current_project_id : ''; st.current_user_id = target === STATUS.LOST ? a.current_user_id : ''; st.return_due_date = ''; }
      results.push({ asset_id: id, ok: true });
      changes.push({ asset: a, action: map[target], state: st, notes: p.notes, photo_url: p.photo_url });
    });
    if (!changes.length) throw AppError('PARTIAL_INVALID', '변경 가능한 장비가 없습니다.', { results: results });
    commitChanges_(ctx, p.request_id, changes, '');
    return { results: results, success_count: changes.length };
  });
});

registerApi_('dashboard.get', 'read', function (ctx) {
  var assets = DB.all('ASSETS');
  var today = todayStr_();
  var soon = addDaysStr_(today, 7);
  var count = { total: 0, available: 0, checked_out: 0, maintenance: 0, overdue: 0, lost: 0, retired: 0 };
  var due = [];
  assets.forEach(function (a) {
    if (a.current_status === STATUS.RETIRED) { count.retired++; return; }
    count.total++;
    if (a.current_status === STATUS.AVAILABLE) count.available++;
    if (a.current_status === STATUS.CHECKED_OUT) {
      count.checked_out++;
      if (isOverdue_(a)) count.overdue++;
      if (a.return_due_date && a.return_due_date <= soon) due.push(a);
    }
    if ([STATUS.INSPECTION, STATUS.REPAIR, STATUS.DAMAGED].indexOf(a.current_status) >= 0) count.maintenance++;
    if (a.current_status === STATUS.LOST) count.lost++;
  });
  due.sort(function (x, y) { return x.return_due_date < y.return_due_date ? -1 : 1; });
  var projects = DB.all('PROJECTS');
  var activeProjects = projects.filter(function (pr) { return pr.status === 'ACTIVE' || pr.status === 'PLANNED'; });
  var pmap = indexBy_(projects, 'project_id');
  var recent = DB.tail('TX', 15).reverse().map(clientTx_);
  return {
    today: today, counts: count, active_projects: activeProjects.length,
    due: due.slice(0, 50).map(function (a) {
      return {
        asset_id: a.asset_id, asset_name: a.asset_name, return_due_date: a.return_due_date, overdue: isOverdue_(a),
        project_id: a.current_project_id, project_name: pmap[a.current_project_id] ? pmap[a.current_project_id].project_name : '',
        user_name: userName_(a.current_user_id)
      };
    }),
    recent: recent
  };
});
