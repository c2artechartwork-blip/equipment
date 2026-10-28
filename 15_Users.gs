/** 직원(사용자) 관리 — ADMIN 전용 (목록 일부는 담당자 선택용으로 공개) */

function adminCount_(exceptId) {
  return DB.filter('USERS', function (u) { return u.user_id !== exceptId && isUserActive_(u) && u.role === 'ADMIN'; }).length;
}

registerApi_('users.list', 'admin', function (ctx) {
  return { users: DB.all('USERS').map(stripMeta_).reverse() };
});

/** 담당자 선택용 최소 목록 (활성 사용자) */
registerApi_('users.directory', 'read', function (ctx) {
  return {
    users: DB.filter('USERS', isUserActive_).map(function (u) {
      return { user_id: u.user_id, name: u.name, department: u.department, role: u.role };
    })
  };
});

/** 이메일로 직원 사전 등록 — 직원이 해당 Gmail 로 첫 로그인하면 계정이 연결된다 */
registerApi_('users.invite', 'admin', function (ctx, p) {
  var email = normEmail_(p.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw AppError('VALIDATION', '이메일 형식이 올바르지 않습니다.');
  var role = str_(p.role);
  if (ROLES.indexOf(role) < 0) throw AppError('VALIDATION', '권한을 선택해 주세요.');
  if (!str_(p.name)) throw AppError('VALIDATION', '이름을 입력해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var dup = DB.filter('USERS', function (u) { return normEmail_(u.email) === email && u.status !== 'PENDING'; });
    if (dup.length) throw AppError('VALIDATION', '이미 등록된 이메일입니다.');
    // 같은 이메일로 승인 대기 중인 계정이 있으면 그 계정을 바로 승인
    var pending = DB.filter('USERS', function (u) { return normEmail_(u.email) === email && u.status === 'PENDING'; })[0];
    var base = {
      email: email, name: clip_(p.name, 80), department: clip_(p.department, 80), role: role, active: true,
      status: 'APPROVED', approved_by: ctx.user.user_id, updated_at: nowIso_()
    };
    if (pending) {
      DB.update('USERS', [Object.assign({}, pending, base)]);
      return { user_id: pending.user_id, linked: true };
    }
    var rec = Object.assign({ user_id: 'INVITE:' + email, created_at: nowIso_(), google_name: '', last_login_at: '' }, base);
    rec.status = 'INVITED';
    DB.insert('USERS', [rec]);
    return { user_id: rec.user_id, linked: false };
  });
});

/** 권한·활성 여부·이름 수정, 승인 대기 계정 승인 */
registerApi_('users.update', 'admin', function (ctx, p) {
  return idempotent_(ctx, p.request_id, function () {
    var u = DB.find('USERS', 'user_id', str_(p.user_id));
    if (!u) throw AppError('NOT_FOUND', '사용자를 찾을 수 없습니다.');
    var next = Object.assign({}, u);
    if ('role' in p) {
      if (ROLES.indexOf(p.role) < 0) throw AppError('VALIDATION', '권한이 올바르지 않습니다.');
      next.role = p.role;
    }
    if ('active' in p) next.active = p.active === true;
    if ('name' in p && str_(p.name)) next.name = clip_(p.name, 80);
    if ('department' in p) next.department = clip_(p.department, 80);
    if (p.approve && u.status === 'PENDING') {
      if (ROLES.indexOf(next.role) < 0) throw AppError('VALIDATION', '승인 시 권한을 지정해 주세요.');
      next.status = 'APPROVED';
      next.active = true;
      next.approved_by = ctx.user.user_id;
    }
    if (p.reject && u.status === 'PENDING') { next.status = 'REJECTED'; next.active = false; }
    // 자기 자신 잠금 / 마지막 관리자 제거 방지
    var losingAdmin = u.role === 'ADMIN' && isUserActive_(u) && !(next.role === 'ADMIN' && next.active);
    if (losingAdmin && u.user_id === ctx.user.user_id) throw AppError('VALIDATION', '자기 자신의 관리자 권한/활성 상태는 변경할 수 없습니다.');
    if (losingAdmin && adminCount_(u.user_id) < 1) throw AppError('VALIDATION', '최소 1명의 활성 관리자가 필요합니다.');
    next.updated_at = nowIso_();
    DB.update('USERS', [next]);
    return { user: stripMeta_(next) };
  });
});

/** 직원별 사용 내역 요약 */
registerApi_('users.activity', 'manage', function (ctx, p) {
  var uid = str_(p.user_id);
  var u = DB.find('USERS', 'user_id', uid);
  if (!u) throw AppError('NOT_FOUND', '사용자를 찾을 수 없습니다.');
  var rows = DB.all('TX').filter(function (t) { return t.actor_user_id === uid || t.receiver_user_id === uid; });
  var summary = {};
  rows.forEach(function (t) { if (t.actor_user_id === uid) summary[t.action_type] = (summary[t.action_type] || 0) + 1; });
  var holding = DB.filter('ASSETS', function (a) { return a.current_user_id === uid && a.current_status === STATUS.CHECKED_OUT; })
    .map(function (a) { var o = clientAsset_(ctx, a); o.overdue = isOverdue_(a); return o; });
  return { user: stripMeta_(u), summary: summary, holding: holding, transactions: rows.slice(-500).reverse().map(clientTx_) };
});

/** 내 반출 목록 (모바일) */
registerApi_('me.holdings', 'read', function (ctx) {
  var uid = ctx.user.user_id;
  var projects = indexBy_(DB.all('PROJECTS'), 'project_id');
  var list = DB.filter('ASSETS', function (a) { return a.current_user_id === uid && a.current_status === STATUS.CHECKED_OUT; })
    .map(function (a) {
      var o = clientAsset_(ctx, a);
      o.overdue = isOverdue_(a);
      o.project_name = projects[a.current_project_id] ? projects[a.current_project_id].project_name : '';
      return o;
    });
  return { assets: list, today: todayStr_() };
});
