/** 프로젝트 관리 */

function nextProjectId_() {
  var year = todayStr_().slice(0, 4);
  var max = 0;
  DB.all('PROJECTS').forEach(function (p) {
    var m = /^PRJ-(\d{4})-(\d+)$/.exec(p.project_id);
    if (m && m[1] === year) max = Math.max(max, parseInt(m[2], 10));
  });
  return 'PRJ-' + year + '-' + ('00' + (max + 1)).slice(-3);
}

registerApi_('projects.list', 'read', function (ctx, p) {
  var assets = DB.all('ASSETS');
  var out = {};
  assets.forEach(function (a) {
    if (a.current_status !== STATUS.CHECKED_OUT || !a.current_project_id) return;
    var o = out[a.current_project_id] = out[a.current_project_id] || { out: 0, overdue: 0 };
    o.out++;
    if (isOverdue_(a)) o.overdue++;
  });
  var users = indexBy_(DB.all('USERS'), 'user_id');
  return {
    projects: DB.all('PROJECTS').map(function (pr) {
      var o = stripMeta_(pr);
      o.out_count = out[pr.project_id] ? out[pr.project_id].out : 0;
      o.overdue_count = out[pr.project_id] ? out[pr.project_id].overdue : 0;
      o.manager_name = users[pr.manager_id] ? users[pr.manager_id].name : '';
      return o;
    }).reverse()
  };
});

registerApi_('projects.get', 'read', function (ctx, p) {
  var pr = DB.find('PROJECTS', 'project_id', str_(p.project_id));
  if (!pr) throw AppError('NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
  var outAssets = DB.filter('ASSETS', function (a) { return a.current_project_id === pr.project_id && a.current_status === STATUS.CHECKED_OUT; })
    .map(function (a) { var o = clientAsset_(ctx, a); o.overdue = isOverdue_(a); o.user_name = userName_(a.current_user_id); return o; });
  var rowNums = DB.column('TX', 'project_id').filter(function (c) { return c.value === pr.project_id; }).map(function (c) { return c.row; });
  var history = DB.rowsAt('TX', rowNums.slice(-500)).map(clientTx_).reverse();
  var o = stripMeta_(pr);
  o.manager_name = userName_(pr.manager_id);
  // 반출 이력 기준 장비별 집계: 반출된 적 있는 모든 장비 / 미반납
  var everOut = {};
  history.forEach(function (t) { if (t.action_type === ACTION.CHECKOUT || t.action_type === ACTION.TRANSFER) everOut[t.asset_id] = true; });
  return { project: o, out_assets: outAssets, history: history, total_ever_out: Object.keys(everOut).length };
});

registerApi_('projects.save', 'manage', function (ctx, p) {
  var f = p.project || {};
  var name = clip_(f.project_name, 120);
  if (!name) throw AppError('VALIDATION', '프로젝트명은 필수입니다.');
  ['start_date', 'end_date'].forEach(function (k) {
    if (str_(f[k]) && !isDateStr_(str_(f[k]))) throw AppError('VALIDATION', '날짜 형식은 YYYY-MM-DD 입니다.');
  });
  if (f.start_date && f.end_date && f.end_date < f.start_date) throw AppError('VALIDATION', '종료일이 시작일보다 빠릅니다.');
  var status = str_(f.status) || 'PLANNED';
  if (!PROJECT_STATUS[status]) throw AppError('VALIDATION', '프로젝트 상태가 올바르지 않습니다.');
  return idempotent_(ctx, p.request_id, function () {
    if (f.manager_id && !DB.find('USERS', 'user_id', f.manager_id)) throw AppError('VALIDATION', '담당자를 찾을 수 없습니다.');
    var rec = {
      project_name: name, client: clip_(f.client, 120), location: clip_(f.location, 120),
      start_date: str_(f.start_date), end_date: str_(f.end_date), manager_id: str_(f.manager_id),
      status: status, notes: clip_(f.notes, 1000), updated_at: nowIso_()
    };
    if (f.project_id) {
      var cur = DB.find('PROJECTS', 'project_id', f.project_id);
      if (!cur) throw AppError('NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
      if ((status === 'DONE' || status === 'CANCELLED') && cur.status !== status) {
        var out = DB.filter('ASSETS', function (a) { return a.current_project_id === cur.project_id && a.current_status === STATUS.CHECKED_OUT; }).length;
        if (out && !p.force) throw AppError('NEEDS_CONFIRM', '미반납 장비 ' + out + '개가 있습니다. 그래도 상태를 변경하시겠습니까?');
      }
      DB.update('PROJECTS', [Object.assign({}, cur, rec)]);
      return { project_id: cur.project_id };
    }
    rec.project_id = nextProjectId_();
    rec.created_at = nowIso_();
    DB.insert('PROJECTS', [rec]);
    return { project_id: rec.project_id };
  });
});
