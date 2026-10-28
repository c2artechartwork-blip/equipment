/** 설정 — 카테고리 / 보관위치 / 시스템 기본값 (관리자 화면에서 코드 수정 없이 변경) */

function settingRows_(category) {
  return DB.filter('SETTINGS', function (s) { return s.category === category; });
}
function getSetting_(category, key, def) {
  var r = DB.filter('SETTINGS', function (s) { return s.category === category && s.setting_key === key; })[0];
  return r ? r.setting_value : def;
}
function getCategoryMap_() {
  var m = {};
  settingRows_('CATEGORY').forEach(function (s) { m[s.setting_key] = s.setting_value; });
  return m;
}
function getLocations_() {
  return settingRows_('LOCATION').map(function (s) { return s.setting_value; });
}
function systemSettings_() {
  var o = Object.assign({}, DEFAULT_SYSTEM_SETTINGS);
  settingRows_('SYSTEM').forEach(function (s) { o[s.setting_key] = s.setting_value; });
  return o;
}

function settingsPayload_() {
  var usage = {};
  var locUsage = {};
  DB.all('ASSETS').forEach(function (a) {
    usage[a.category] = (usage[a.category] || 0) + 1;
    if (a.home_location) locUsage[a.home_location] = (locUsage[a.home_location] || 0) + 1;
  });
  return {
    categories: settingRows_('CATEGORY').map(function (s) { return { code: s.setting_key, name: s.setting_value, count: usage[s.setting_key] || 0 }; }),
    locations: settingRows_('LOCATION').map(function (s) { return { key: s.setting_key, name: s.setting_value, count: locUsage[s.setting_value] || 0 }; }),
    system: systemSettings_(),
    project_status: PROJECT_STATUS,
    status_label: STATUS_LABEL
  };
}

registerApi_('app.bootstrap', 'read', function (ctx) {
  return {
    app: { name: APP.NAME, version: APP.VERSION },
    user: publicUser_(ctx.user),
    perms: ROLE_PERMS[ctx.user.role],
    today: todayStr_(),
    settings: settingsPayload_(),
    projects: DB.all('PROJECTS').filter(function (p) { return p.status === 'ACTIVE' || p.status === 'PLANNED'; })
      .map(function (p) { return pick_(p, ['project_id', 'project_name', 'client', 'location', 'start_date', 'end_date', 'status']); }).reverse(),
    users: DB.filter('USERS', isUserActive_).map(function (u) { return { user_id: u.user_id, name: u.name, department: u.department }; })
  };
});

registerApi_('settings.get', 'read', function () { return settingsPayload_(); });

registerApi_('settings.saveCategory', 'admin', function (ctx, p) {
  var code = str_(p.code).toUpperCase();
  var name = clip_(p.name, 40);
  if (!/^[A-Z]{2}$/.test(code)) throw AppError('VALIDATION', '카테고리 코드는 영문 대문자 2자입니다. (예: PJ)');
  if (!name) throw AppError('VALIDATION', '카테고리 이름을 입력해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var cur = settingRows_('CATEGORY').filter(function (s) { return s.setting_key === code; })[0];
    var dupName = settingRows_('CATEGORY').filter(function (s) { return s.setting_value === name && s.setting_key !== code; })[0];
    if (dupName) throw AppError('VALIDATION', '같은 이름의 카테고리가 있습니다.');
    if (cur) DB.update('SETTINGS', [Object.assign({}, cur, { setting_value: name, updated_at: nowIso_() })]);
    else DB.insert('SETTINGS', [{ setting_key: code, setting_value: name, category: 'CATEGORY', updated_at: nowIso_() }]);
    return settingsPayload_();
  });
});

registerApi_('settings.deleteCategory', 'admin', function (ctx, p) {
  var code = str_(p.code).toUpperCase();
  return idempotent_(ctx, p.request_id, function () {
    var used = DB.filter('ASSETS', function (a) { return a.category === code; }).length;
    if (used) throw AppError('VALIDATION', '사용 중인 카테고리는 삭제할 수 없습니다. (' + used + '개 장비)');
    var rows = settingRows_('CATEGORY').filter(function (s) { return s.setting_key === code; });
    DB.remove('SETTINGS', rows);
    return settingsPayload_();
  });
});

/** 보관위치 추가/이름 변경. 이름 변경 시 해당 위치의 장비도 함께 갱신(EDIT 이력) */
registerApi_('settings.saveLocation', 'admin', function (ctx, p) {
  var name = clip_(p.name, 60);
  if (!name) throw AppError('VALIDATION', '보관위치 이름을 입력해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var rows = settingRows_('LOCATION');
    if (rows.some(function (s) { return s.setting_value === name && s.setting_key !== p.key; })) throw AppError('VALIDATION', '이미 있는 보관위치입니다.');
    if (p.key) {
      var cur = rows.filter(function (s) { return s.setting_key === p.key; })[0];
      if (!cur) throw AppError('NOT_FOUND', '보관위치를 찾을 수 없습니다.');
      var oldName = cur.setting_value;
      DB.update('SETTINGS', [Object.assign({}, cur, { setting_value: name, updated_at: nowIso_() })]);
      var changes = [];
      DB.all('ASSETS').forEach(function (a) {
        if (a.home_location !== oldName && a.current_location !== oldName) return;
        var info = a.home_location === oldName ? { home_location: name } : null;
        var state = a.current_location === oldName ? { current_location: name } : null;
        changes.push({ asset: a, action: ACTION.EDIT, info: info, state: state, notes: '보관위치 이름 변경: ' + oldName + ' → ' + name });
      });
      if (changes.length) commitChanges_(ctx, p.request_id, changes, '');
      return settingsPayload_();
    }
    DB.insert('SETTINGS', [{ setting_key: 'LOC-' + shortId_().slice(0, 6), setting_value: name, category: 'LOCATION', updated_at: nowIso_() }]);
    return settingsPayload_();
  });
});

registerApi_('settings.deleteLocation', 'admin', function (ctx, p) {
  return idempotent_(ctx, p.request_id, function () {
    var cur = settingRows_('LOCATION').filter(function (s) { return s.setting_key === p.key; })[0];
    if (!cur) throw AppError('NOT_FOUND', '보관위치를 찾을 수 없습니다.');
    var used = DB.filter('ASSETS', function (a) { return a.home_location === cur.setting_value; }).length;
    if (used) throw AppError('VALIDATION', '이 위치를 기본 보관위치로 쓰는 장비가 ' + used + '개 있어 삭제할 수 없습니다.');
    DB.remove('SETTINGS', [cur]);
    return settingsPayload_();
  });
});

registerApi_('settings.saveSystem', 'admin', function (ctx, p) {
  var key = str_(p.key);
  if (!(key in DEFAULT_SYSTEM_SETTINGS)) throw AppError('VALIDATION', '알 수 없는 설정입니다.');
  var value = str_(p.value);
  if (key === 'DEFAULT_DUE_DAYS' && !(parseInt(value, 10) >= 1 && parseInt(value, 10) <= 365)) throw AppError('VALIDATION', '1~365 사이 숫자를 입력해 주세요.');
  if (key === 'REQUIRE_PHOTO_ON_ISSUE') value = toBool_(value) ? 'TRUE' : 'FALSE';
  if (/^LABEL_OFFSET/.test(key) && isNaN(Number(value))) throw AppError('VALIDATION', '숫자(mm)를 입력해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var cur = settingRows_('SYSTEM').filter(function (s) { return s.setting_key === key; })[0];
    if (cur) DB.update('SETTINGS', [Object.assign({}, cur, { setting_value: value, updated_at: nowIso_() })]);
    else DB.insert('SETTINGS', [{ setting_key: key, setting_value: value, category: 'SYSTEM', updated_at: nowIso_() }]);
    return settingsPayload_();
  });
});
