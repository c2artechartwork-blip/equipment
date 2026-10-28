/* C2 EQUIPMENT MANAGER — 관리자 화면: 셸 · 대시보드 · 장비 · 등록 · 라벨 */
(function () {
  'use strict';
  var C = window.C2, esc = C.esc, icon = C.icon, Api = C.Api;
  var app = document.getElementById('app');

  var A = window.A = {
    boot: null, user: null, assets: null, assetsAt: 0, sel: {}, views: {},
    listState: { q: '', cat: '', status: '', loc: '', sort: 'asset_id', dir: 1, page: 1, size: 50 }
  };

  var NAV = [
    ['dashboard', '대시보드', 'grid', 'read'],
    ['assets', '전체 장비', 'box', 'read'],
    ['register', '장비 등록', 'plus', 'manage'],
    ['labels', 'QR 라벨 출력', 'qr', 'read'],
    ['ops', '반출 / 반납', 'swap', 'operate'],
    ['projects', '프로젝트 관리', 'folder', 'read'],
    ['sets', '장비 세트 관리', 'layers', 'read'],
    ['inspections', '점검 / 수리', 'tool', 'read'],
    ['history', '입출고 이력', 'history', 'read'],
    ['-'],
    ['users', '직원 관리', 'users', 'admin'],
    ['settings', '시스템 설정', 'gear', 'admin']
  ];

  A.can = function (p) { return !!(A.boot && A.boot.perms && A.boot.perms[p]); };
  A.req = function () { return C.uuid(); };
  A.catName = function (code) { var c = A.boot.settings.categories.filter(function (x) { return x.code === code; })[0]; return c ? c.name : code; };
  A.userName = function (id) { var u = (A.boot.users || []).filter(function (x) { return x.user_id === id; })[0]; return u ? u.name : (id ? '(알 수 없음)' : ''); };
  A.projectName = function (id) { var p = (A.allProjects || A.boot.projects).filter(function (x) { return x.project_id === id; })[0]; return p ? p.project_name : id; };
  A.loadAssets = function (force) {
    if (!force && A.assets && Date.now() - A.assetsAt < 30000) return Promise.resolve(A.assets);
    return Api.call('assets.list', {}).then(function (d) { A.assets = d.assets; A.assetsAt = Date.now(); return d.assets; });
  };
  A.loadProjects = function () {
    return Api.call('projects.list', {}).then(function (d) { A.allProjects = d.projects; return d.projects; });
  };
  A.refreshBoot = function () { return Api.call('app.bootstrap', {}).then(function (b) { A.boot = b; A.user = b.user; return b; }); };
  A.go = function (h) { if (location.hash === h) route(); else location.hash = h; };
  A.loading = function (el, msg) { el.innerHTML = '<div class="loading-block"><span class="spin"></span>' + esc(msg || '불러오는 중') + '</div>'; };
  A.err = function (el, e) { el.innerHTML = '<div class="card"><div class="empty">' + icon('warn', 'ic') + '<div>' + esc(e.message) + '</div></div></div>'; };
  A.setTitle = function (t, crumb) {
    var h = C.$('#a-title'); if (h) h.textContent = t;
    var c = C.$('#a-crumb'); if (c) c.textContent = crumb || '';
    document.title = t + ' — C2 EQUIPMENT MANAGER';
  };
  A.txActionBadge = function (t) {
    var cls = { CHECKOUT: 'b-out', RETURN: 'b-available', TRANSFER: 'b-out', INSPECT: 'b-inspect', REPAIR: 'b-inspect', LOST: 'b-danger', RETIRE: 'b-gray', CORRECTION: 'b-dark', REGISTER: 'b-yellow', EDIT: 'b-gray' }[t] || 'b-gray';
    return '<span class="badge ' + cls + '">' + esc(C.ACTION_LABEL[t] || t) + '</span>';
  };
  A.txTable = function (txs, opts) {
    opts = opts || {};
    if (!txs.length) return '<div class="empty">이력이 없습니다.</div>';
    return '<div class="table-wrap"><table class="tbl"><thead><tr>' + (opts.select ? '<th class="chk"></th>' : '') + '<th>시각</th><th>유형</th>' + (opts.noAsset ? '' : '<th>장비</th>') +
      '<th>프로젝트</th><th>처리자</th><th>담당자</th><th>상태 변화</th><th>메모</th><th>거래 ID</th></tr></thead><tbody>' +
      txs.map(function (t) {
        return '<tr' + (t.corrected ? ' style="opacity:.55"' : '') + '>' +
          (opts.select ? '<td class="chk">' + (t.corrected || t.action_type === 'CORRECTION' || t.action_type === 'REGISTER' ? '' : '<input type="checkbox" data-tx="' + esc(t.transaction_id) + '">') + '</td>' : '') +
          '<td class="nowrap">' + esc(C.fmtDateTime(t.timestamp)) + '</td><td>' + A.txActionBadge(t.action_type) + (t.corrected ? ' <span class="badge b-gray">정정됨</span>' : '') + '</td>' +
          (opts.noAsset ? '' : '<td class="nowrap"><a class="mono" href="#/asset/' + encodeURIComponent(t.asset_id) + '">' + esc(t.asset_id) + '</a></td>') +
          '<td class="nowrap">' + (t.project_id ? '<a href="#/project/' + encodeURIComponent(t.project_id) + '">' + esc(t.project_id) + '</a>' : '') + '</td>' +
          '<td class="nowrap">' + (t.actor_user_id ? '<a href="#/user/' + encodeURIComponent(t.actor_user_id) + '">' + esc(t.actor_name || A.userName(t.actor_user_id)) + '</a>' : '') + '<div class="small muted">' + esc(t.actor_email || '') + '</div></td>' +
          '<td class="nowrap">' + esc(t.receiver_name || A.userName(t.receiver_user_id)) + (t.due_date ? '<div class="small muted">~' + esc(t.due_date) + '</div>' : '') + '</td>' +
          '<td class="nowrap small">' + esc(C.STATUS_META[t.previous_status] ? C.STATUS_META[t.previous_status].label : t.previous_status || '—') + ' → ' + esc(C.STATUS_META[t.new_status] ? C.STATUS_META[t.new_status].label : t.new_status) +
          (t.condition === 'ISSUE' ? ' <span class="badge b-inspect">이상</span>' : '') + '</td>' +
          '<td class="small" style="min-width:160px;max-width:300px">' + esc(t.notes) + (t.photo_url ? ' <a href="#" data-photo-open="' + esc(t.photo_url) + '">[사진]</a>' : '') + '</td>' +
          '<td class="mono small muted nowrap">' + esc(t.transaction_id) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  };
  A.bindPhotoOpen = function (root) {
    C.$$('[data-photo-open]', root).forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var ref = a.getAttribute('data-photo-open');
        C.modal({ title: '사진', body: '<img data-photo="' + esc(ref) + '" data-size="full" style="width:100%;border-radius:8px;min-height:120px;background:#F0F0F0" alt="">', noFocus: true });
        C.Photos.hydrate(document.body);
      };
    });
  };

  // ---------------- 부트 ----------------
  function boot() {
    C.envRibbon();
    if (!C.Auth.restore()) {
      app.innerHTML = C.loginScreenHtml('관리자/매니저 Google 계정으로 로그인하세요.');
      C.Auth._waiters.push(start);
      C.Auth.renderButton(app.querySelector('[data-login]'));
      return;
    }
    start();
  }

  function start() {
    A.loading(app, '계정 확인 중');
    Api.call('session.me', {}).then(function (me) {
      if (me.status !== 'ACTIVE') {
        app.innerHTML = '<div class="state-screen"><div class="icon-circle">' + icon(me.status === 'PENDING' ? 'clock' : 'shield') + '</div><h2>' +
          (me.status === 'PENDING' ? '관리자 승인 대기 중' : '사용이 중지된 계정') + '</h2><p>' + esc(me.google.email || '') + '</p>' +
          '<p>승인되지 않은 계정은 데이터에 접근할 수 없습니다.</p><button class="btn" id="out">다른 계정으로 로그인</button></div>';
        C.$('#out').onclick = function () { C.Auth.signOut(); };
        return;
      }
      return A.refreshBoot().then(function () {
        if (!A.can('manage')) {
          app.innerHTML = '<div class="state-screen"><div class="icon-circle">' + icon('shield') + '</div><h2>관리자 화면 권한이 없습니다</h2>' +
            '<p>' + esc(A.user.name) + ' (' + esc(C.ROLE_LABEL[A.user.role]) + ') 계정은 모바일 화면을 이용하세요.</p><a class="btn primary lg" href="index.html">모바일 화면으로</a>' +
            '<button class="btn ghost" id="out">다른 계정</button></div>';
          C.$('#out').onclick = function () { C.Auth.signOut(); };
          return;
        }
        shell();
        route();
      });
    }).catch(function (e) {
      app.innerHTML = '<div class="state-screen"><div class="icon-circle">' + icon('warn') + '</div><h2>연결할 수 없습니다</h2><p>' + esc(e.message) + '</p><button class="btn primary" id="retry">다시 시도</button></div>';
      C.$('#retry').onclick = start;
    });
  }

  function shell() {
    app.innerHTML = '<div class="a-shell"><aside class="a-side" id="a-side"><div class="a-brand"><img src="logo-h-yellow.png" alt="C2 ARTECHNOLOZY"><div class="svc">EQUIPMENT MANAGER</div></div>' +
      '<nav class="a-nav">' + NAV.map(function (n) {
        if (n[0] === '-') return '<div class="nav-sep"></div>';
        if (!A.can(n[3])) return '';
        return '<a class="nav-item" href="#/' + n[0] + '" data-nav="' + n[0] + '">' + icon(n[2]) + '<span>' + n[1] + '</span>' + (n[0] === 'users' ? '<span class="pill hidden" id="pending-pill"></span>' : '') + '</a>';
      }).join('') + '</nav>' +
      '<div class="a-side-foot"><div class="who">' + esc(A.user.name) + '</div><div class="role">' + esc(C.ROLE_LABEL[A.user.role]) + ' · ' + esc(A.user.email) + '</div>' +
      '<div class="row" style="margin-top:8px;gap:14px"><a href="index.html">모바일 화면</a><button id="logout">로그아웃</button></div></div></aside>' +
      '<div class="a-main"><header class="a-top"><button class="btn ghost a-menu-btn" id="menu-btn" aria-label="메뉴">' + icon('list') + '</button>' +
      '<h1 id="a-title"></h1><span class="crumb" id="a-crumb"></span>' +
      '<form class="quick" id="quick">' + icon('search') + '<input class="input" id="quick-q" placeholder="관리번호로 바로 이동 / 장비 검색 (USB 스캐너 가능)" autocomplete="off"></form></header>' +
      '<div class="a-content" id="view"></div></div></div>';
    C.$('#logout').onclick = function () { C.Auth.signOut(); };
    C.$('#menu-btn').onclick = function () { C.$('#a-side').classList.toggle('open'); };
    C.$('#quick').onsubmit = function (e) {
      e.preventDefault();
      var q = C.$('#quick-q').value.trim();
      if (!q) return;
      C.$('#quick-q').value = '';
      var m = /[?&]a=([^&#]+)/.exec(q); if (m) q = decodeURIComponent(m[1]);
      if (/^C2-[A-Z]{2}-\d+$/i.test(q)) return A.go('#/asset/' + encodeURIComponent(q.toUpperCase()));
      if (/^SET[:-]/i.test(q)) return A.go('#/sets');
      A.listState.q = q; A.listState.page = 1;
      A.go('#/assets');
    };
    window.onhashchange = route;
    if (A.can('admin')) Api.call('users.list', {}).then(function (d) {
      var n = d.users.filter(function (u) { return u.status === 'PENDING'; }).length;
      var p = C.$('#pending-pill'); if (p && n) { p.textContent = n; p.classList.remove('hidden'); }
    }).catch(function () { /* noop */ });
  }

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = {};
    var i = h.indexOf('?');
    if (i >= 0) { h.slice(i + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); h = h.slice(0, i); }
    var parts = h.split('/');
    return { name: parts[0] || 'dashboard', arg: parts[1] ? decodeURIComponent(parts[1]) : '', q: q };
  }
  A.parseHash = parseHash;

  function route() {
    var r = parseHash();
    var navName = { asset: 'assets', project: 'projects', user: 'users' }[r.name] || r.name;
    C.$$('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === navName); });
    C.$('#a-side').classList.remove('open');
    var view = C.$('#view');
    view.innerHTML = '';
    window.scrollTo(0, 0);
    var fn = A.views[r.name] || A.views.dashboard;
    try { fn(view, r); } catch (e) { console.error(e); A.err(view, e); }
  }
  A.route = route;

  // ---------------- 대시보드 ----------------
  A.views.dashboard = function (view) {
    A.setTitle('대시보드', C.todayStr());
    A.loading(view);
    Api.call('dashboard.get', {}).then(function (d) {
      var c = d.counts;
      function stat(label, v, color, href, alert) {
        return '<a class="stat' + (alert && v ? ' alert' : '') + '" href="' + href + '"><div class="k"><i style="background:' + color + '"></i>' + label + '</div><div class="v">' + v + '</div></a>';
      }
      view.innerHTML = '<div class="stats">' +
        stat('총 등록 장비', c.total, '#111', '#/assets') +
        stat('보유', c.available, 'var(--st-available)', '#/assets?status=AVAILABLE') +
        stat('반출', c.checked_out, 'var(--st-out)', '#/assets?status=CHECKED_OUT') +
        stat('점검 · 수리', c.maintenance, 'var(--st-inspect)', '#/assets?status=MAINT') +
        stat('반납 지연', c.overdue, 'var(--st-danger)', '#/assets?status=OVERDUE', true) +
        stat('진행 중 프로젝트', d.active_projects, 'var(--yellow)', '#/projects') + '</div>' +
        '<div class="dash-grid"><div class="card"><div class="card-head"><h3>최근 입출고 이력</h3><span class="spacer"></span><a class="btn sm" href="#/history">전체 보기</a></div>' + A.txTable(d.recent) + '</div>' +
        '<div class="card"><div class="card-head"><h3>반납 예정 · 지연 (7일 이내)</h3></div>' +
        (d.due.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>반납일</th><th>장비</th><th>프로젝트</th><th>담당</th></tr></thead><tbody>' + d.due.map(function (a) {
          var dl = C.daysLeft(a.return_due_date);
          return '<tr class="clickable" data-href="#/asset/' + encodeURIComponent(a.asset_id) + '"><td class="nowrap">' + esc(a.return_due_date) + '<div class="small" style="color:' + (a.overdue ? 'var(--st-danger)' : 'var(--text-2)') + ';font-weight:600">' + (a.overdue ? '지연 ' + (-dl) + '일' : dl === 0 ? '오늘' : 'D-' + dl) + '</div></td>' +
            '<td><div class="mono small">' + esc(a.asset_id) + '</div>' + esc(a.asset_name) + '</td><td class="small">' + esc(a.project_name) + '</td><td class="small nowrap">' + esc(a.user_name) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">7일 이내 반납 예정 장비가 없습니다.</div>') + '</div></div>';
      C.$$('[data-href]', view).forEach(function (tr) { tr.onclick = function () { A.go(tr.getAttribute('data-href')); }; });
      A.bindPhotoOpen(view);
    }).catch(function (e) { A.err(view, e); });
  };

  // ---------------- 전체 장비 ----------------
  function filterAssets(list, st) {
    var q = st.q.toLowerCase();
    var out = list.filter(function (a) {
      if (st.cat && a.category !== st.cat) return false;
      if (st.loc && a.home_location !== st.loc && a.current_location !== st.loc) return false;
      if (st.status === 'OVERDUE') { if (!a.overdue) return false; }
      else if (st.status === 'MAINT') { if (['INSPECTION', 'REPAIR', 'DAMAGED'].indexOf(a.current_status) < 0) return false; }
      else if (st.status === 'ACTIVE') { if (a.current_status === 'RETIRED') return false; }
      else if (st.status && a.current_status !== st.status) return false;
      if (q && (a.asset_id + ' ' + a.asset_name + ' ' + a.manufacturer + ' ' + a.model + ' ' + a.serial_number + ' ' + a.notes + ' ' + a.current_project_id).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = st.sort, dir = st.dir;
    out.sort(function (x, y) {
      var a = x[key] === undefined ? '' : x[key], b = y[key] === undefined ? '' : y[key];
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
      return String(a).localeCompare(String(b), 'ko', { numeric: true }) * dir;
    });
    return out;
  }
  A.filterAssets = filterAssets;

  A.views.assets = function (view, r) {
    A.setTitle('전체 장비');
    var st = A.listState;
    if (r.q.status !== undefined) { st.status = r.q.status; st.page = 1; }
    A.loading(view);
    A.loadAssets(true).then(function (assets) {
      var cats = A.boot.settings.categories, locs = A.boot.settings.locations;
      view.innerHTML = '<div class="toolbar"><input class="input search" id="f-q" placeholder="관리번호·장비명·모델·시리얼 검색" value="' + esc(st.q) + '">' +
        '<select class="input" id="f-cat"><option value="">전체 카테고리</option>' + cats.map(function (c) { return '<option value="' + esc(c.code) + '"' + (st.cat === c.code ? ' selected' : '') + '>' + esc(c.name) + ' (' + esc(c.code) + ')</option>'; }).join('') + '</select>' +
        '<select class="input" id="f-status"><option value="">전체 상태</option>' + [['ACTIVE', '폐기 제외'], ['AVAILABLE', '보유'], ['CHECKED_OUT', '반출'], ['OVERDUE', '반납 지연'], ['MAINT', '점검·수리·파손'], ['INSPECTION', '점검'], ['REPAIR', '수리'], ['DAMAGED', '파손'], ['LOST', '분실'], ['RETIRED', '폐기']].map(function (o) {
          return '<option value="' + o[0] + '"' + (st.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>' +
        '<select class="input" id="f-loc"><option value="">전체 위치</option>' + locs.map(function (l) { return '<option' + (st.loc === l.name ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') + '</select>' +
        '<span class="spacer"></span>' + (A.can('manage') ? '<a class="btn" href="#/register?csv=1">' + icon('upload') + ' CSV 가져오기</a>' : '') +
        '<button class="btn" id="csv-out">' + icon('download') + ' CSV 내보내기</button>' + (A.can('manage') ? '<a class="btn primary" href="#/register">' + icon('plus') + ' 장비 등록</a>' : '') + '</div>' +
        '<div id="selbar"></div><div class="card"><div id="tbl"></div><div class="pager" id="pager"></div></div>';
      function render() {
        var list = filterAssets(assets, st);
        var pages = Math.max(1, Math.ceil(list.length / st.size));
        if (st.page > pages) st.page = pages;
        var rows = list.slice((st.page - 1) * st.size, st.page * st.size);
        var cols = [['', 'photo'], ['관리번호', 'asset_id'], ['장비명', 'asset_name'], ['제조사 / 모델', 'model'], ['카테고리', 'category'], ['상태', 'current_status'], ['현재 위치', 'current_location'], ['담당자', 'current_user_id'], ['프로젝트', 'current_project_id'], ['반납 예정', 'return_due_date']];
        var allChecked = rows.length && rows.every(function (a) { return A.sel[a.asset_id]; });
        C.$('#tbl').innerHTML = '<div class="table-wrap"><table class="tbl"><thead><tr><th class="chk"><input type="checkbox" id="chk-all"' + (allChecked ? ' checked' : '') + ' aria-label="페이지 전체 선택"></th>' +
          cols.map(function (c) { return c[1] === 'photo' ? '<th style="width:48px">사진</th>' : '<th class="sortable" data-sort="' + c[1] + '">' + c[0] + (st.sort === c[1] ? (st.dir > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
          (rows.length ? rows.map(function (a) {
            return '<tr class="clickable' + (A.sel[a.asset_id] ? ' selected' : '') + '" data-id="' + esc(a.asset_id) + '"><td class="chk"><input type="checkbox" data-chk="' + esc(a.asset_id) + '"' + (A.sel[a.asset_id] ? ' checked' : '') + '></td>' +
              '<td>' + C.photoThumb(a.photo_url) + '</td><td class="mono nowrap">' + esc(a.asset_id) + '</td><td>' + esc(a.asset_name) + '</td>' +
              '<td class="small">' + esc(a.manufacturer) + '<div class="muted">' + esc(a.model) + '</div></td><td class="small nowrap">' + esc(A.catName(a.category)) + '</td>' +
              '<td class="nowrap">' + C.statusBadge(a.current_status, a.overdue) + '</td><td class="small">' + esc(a.current_location) + '</td>' +
              '<td class="small nowrap">' + esc(A.userName(a.current_user_id)) + '</td><td class="small nowrap">' + (a.current_project_id ? esc(a.current_project_id) : '') + '</td>' +
              '<td class="small nowrap"' + (a.overdue ? ' style="color:var(--st-danger);font-weight:700"' : '') + '>' + esc(a.return_due_date) + '</td></tr>';
          }).join('') : '<tr><td colspan="11"><div class="empty">조건에 맞는 장비가 없습니다.</div></td></tr>') + '</tbody></table></div>';
        C.$('#pager').innerHTML = '<span class="muted">' + list.length.toLocaleString() + '개 중 ' + (rows.length ? ((st.page - 1) * st.size + 1) + '–' + ((st.page - 1) * st.size + rows.length) : 0) + '</span><span class="spacer"></span>' +
          '<select class="input" id="pg-size" style="width:auto;min-height:30px">' + [25, 50, 100, 200].map(function (n) { return '<option' + (n === st.size ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' +
          '<button class="btn sm" id="pg-prev"' + (st.page <= 1 ? ' disabled' : '') + '>이전</button><span>' + st.page + ' / ' + pages + '</span><button class="btn sm" id="pg-next"' + (st.page >= pages ? ' disabled' : '') + '>다음</button>';
        C.Photos.hydrate(view);
        C.$$('[data-sort]').forEach(function (th) { th.onclick = function () { var k2 = th.getAttribute('data-sort'); if (st.sort === k2) st.dir *= -1; else { st.sort = k2; st.dir = 1; } render(); }; });
        C.$$('tr[data-id]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('input')) return; A.go('#/asset/' + encodeURIComponent(tr.getAttribute('data-id'))); }; });
        C.$$('[data-chk]').forEach(function (x) { x.onchange = function () { var id = x.getAttribute('data-chk'); if (x.checked) A.sel[id] = true; else delete A.sel[id]; render(); }; });
        C.$('#chk-all').onchange = function (e) { rows.forEach(function (a) { if (e.target.checked) A.sel[a.asset_id] = true; else delete A.sel[a.asset_id]; }); render(); };
        C.$('#pg-prev').onclick = function () { st.page--; render(); };
        C.$('#pg-next').onclick = function () { st.page++; render(); };
        C.$('#pg-size').onchange = function (e) { st.size = +e.target.value; st.page = 1; render(); };
        renderSelbar(list);
      }
      function renderSelbar(list) {
        var ids = Object.keys(A.sel);
        var bar = C.$('#selbar');
        if (!ids.length) { bar.innerHTML = ''; return; }
        bar.innerHTML = '<div class="selbar"><b>' + ids.length + '개 선택</b><button class="btn sm ghost" style="color:#fff" id="sel-filtered">검색결과 ' + list.length + '개 모두 선택</button><span class="spacer"></span>' +
          '<button class="btn sm" id="sel-label">' + icon('qr') + ' 라벨 출력</button>' +
          (A.can('manage') ? '<button class="btn sm" id="sel-edit">' + icon('edit') + ' 일괄 편집</button><button class="btn sm" id="sel-status">상태 변경</button>' : '') +
          '<button class="btn sm ghost" style="color:#fff" id="sel-clear">선택 해제</button></div>';
        C.$('#sel-filtered').onclick = function () { list.forEach(function (a) { A.sel[a.asset_id] = true; }); render(); };
        C.$('#sel-clear').onclick = function () { A.sel = {}; render(); };
        C.$('#sel-label').onclick = function () { A.go('#/labels?from=sel'); };
        var be = C.$('#sel-edit'); if (be) be.onclick = function () { bulkEdit(ids, function () { A.views.assets(view, { q: {} }); }); };
        var bs = C.$('#sel-status'); if (bs) bs.onclick = function () { A.statusDialog(ids, function () { A.views.assets(view, { q: {} }); }); };
      }
      var deb = C.debounce(function () { st.q = C.$('#f-q').value.trim(); st.page = 1; render(); }, 150);
      C.$('#f-q').oninput = deb;
      C.$('#f-cat').onchange = function (e) { st.cat = e.target.value; st.page = 1; render(); };
      C.$('#f-status').onchange = function (e) { st.status = e.target.value; st.page = 1; render(); };
      C.$('#f-loc').onchange = function (e) { st.loc = e.target.value; st.page = 1; render(); };
      C.$('#csv-out').onclick = function () {
        var list = filterAssets(assets, st);
        var fields = ['asset_id', 'asset_name', 'category', 'manufacturer', 'model', 'serial_number', 'purchase_date', 'purchase_price', 'home_location', 'current_location', 'current_status', 'current_project_id', 'current_user_id', 'return_due_date', 'set_id', 'notes'];
        var rows = [fields.concat(['current_user_name', 'status_label'])].concat(list.map(function (a) {
          return fields.map(function (f) { return a[f] === undefined ? '' : a[f]; }).concat([A.userName(a.current_user_id), (C.STATUS_META[a.current_status] || {}).label || '']);
        }));
        C.downloadText('C2_장비목록_' + C.todayStr() + '.csv', C.toCsv(rows));
      };
      render();
    }).catch(function (e) { A.err(view, e); });
  };

  function bulkEdit(ids, done) {
    var locs = A.boot.settings.locations;
    C.modal({
      title: ids.length + '개 장비 일괄 편집',
      body: '<p class="small muted" style="margin-top:0">입력한 항목만 변경됩니다. (변경 내역은 이력에 기록)</p><div class="stack">' +
        '<div class="field"><label>기본 보관위치</label><select class="input" id="be-loc"><option value="">(변경 안 함)</option>' + locs.map(function (l) { return '<option>' + esc(l.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label>제조사</label><input class="input" id="be-man" placeholder="(변경 안 함)"></div>' +
        '<div class="field"><label>메모</label><input class="input" id="be-notes" placeholder="(변경 안 함)"></div></div>',
      actions: [{ label: '취소' }, {
        label: '적용', cls: 'primary', onClick: function () {
          var f = {};
          if (C.$('#be-loc').value) f.home_location = C.$('#be-loc').value;
          if (C.$('#be-man').value.trim()) f.manufacturer = C.$('#be-man').value.trim();
          if (C.$('#be-notes').value.trim()) f.notes = C.$('#be-notes').value.trim();
          if (!Object.keys(f).length) { C.toast('변경할 항목을 입력하세요.', 'err'); return false; }
          return Api.call('assets.bulkUpdate', { request_id: A.req(), asset_ids: ids, fields: f }).then(function (d) { C.toast(d.updated + '개 장비 수정됨'); done(); });
        }
      }]
    });
  }

  A.statusDialog = function (ids, done) {
    C.modal({
      title: ids.length + '개 장비 상태 변경',
      body: '<div class="stack"><div class="field"><label class="req">변경할 상태</label><select class="input" id="sd-st">' +
        [['INSPECTION', '점검'], ['REPAIR', '수리'], ['DAMAGED', '파손'], ['LOST', '분실'], ['RETIRED', '폐기(비활성)'], ['AVAILABLE', '보유(정상 복귀)']].map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label class="req">사유</label><textarea class="input" id="sd-notes" maxlength="500"></textarea></div>' +
        '<p class="small muted" style="margin:0">반출 중 장비는 분실 처리만 가능하며, 나머지는 반납 절차를 이용하세요.</p></div>',
      actions: [{ label: '취소' }, {
        label: '변경', cls: 'primary', onClick: function () {
          var notes = C.$('#sd-notes').value.trim();
          if (!notes) { C.toast('사유를 입력하세요.', 'err'); return false; }
          return Api.call('assets.setStatus', { request_id: A.req(), asset_ids: ids, status: C.$('#sd-st').value, notes: notes }).then(function (d) {
            var fail = d.results.filter(function (x) { return !x.ok; });
            C.toast(d.success_count + '개 변경' + (fail.length ? ' · ' + fail.length + '개 불가: ' + fail.map(function (f) { return f.asset_id + '(' + f.reason + ')'; }).join(', ') : ''), fail.length ? 'err' : 'ok', 6000);
            done();
          }, function (e) {
            if (e.details && e.details.results) C.toast(e.details.results.map(function (f) { return f.asset_id + ': ' + f.reason; }).join(' / '), 'err', 7000);
            else throw e;
          });
        }
      }]
    });
  };

  // ---------------- 장비 상세 ----------------
  A.views.asset = function (view, r) {
    var id = r.arg;
    A.setTitle(id, '장비 상세');
    A.loading(view);
    Api.call('assets.get', { asset_id: id }).then(function (d) {
      var a = d.asset;
      A.setTitle(a.asset_name, a.asset_id);
      var canM = A.can('manage');
      view.innerHTML = '<div class="row" style="margin-bottom:12px"><a class="btn ghost sm" href="#/assets">' + icon('back') + ' 목록</a><span class="spacer"></span>' +
        (canM ? '<button class="btn" id="ed">' + icon('edit') + ' 정보 수정</button><button class="btn" id="st">상태 변경</button>' : '') +
        (A.can('operate') && a.current_status !== 'CHECKED_OUT' && ['LOST', 'RETIRED'].indexOf(a.current_status) < 0 ? '<button class="btn" id="insp">' + icon('tool') + ' 점검 접수</button>' : '') +
        '<a class="btn primary" href="#/labels?ids=' + encodeURIComponent(a.asset_id) + '">' + icon('printer') + ' 라벨 출력</a></div>' +
        '<div class="detail-grid"><div class="stack">' +
        '<div class="card card-pad stack">' + (a.photo_url ? '<img class="photo-big" data-photo="' + esc(a.photo_url) + '" data-size="full" alt="장비 사진">' : '<div class="photo-big">' + icon('image') + '</div>') +
        (canM ? '<label class="btn block">' + icon('camera') + ' 사진 ' + (a.photo_url ? '변경' : '등록') + '<input type="file" accept="image/*" class="sr-only" id="ph"></label>' : '') + '</div>' +
        '<div class="card card-pad"><div class="qr-panel"><div class="qr-box">' + C.qrSvg(a.qr_value || a.asset_id, { quiet: 2 }) + '</div><div><div class="mono" style="font-size:18px;font-weight:800">' + esc(a.asset_id) + '</div>' +
        '<div class="small muted">QR 값: <span class="mono">' + esc(a.qr_value || a.asset_id) + '</span></div><div class="small muted">관리번호는 변경되지 않습니다.</div></div></div></div>' +
        '<div class="card card-pad"><div class="section-title">현재 상태</div><div style="margin-bottom:10px">' + C.statusBadge(a.current_status, a.overdue) + '</div><dl class="kv">' +
        '<dt>현재 위치</dt><dd>' + esc(a.current_location || '-') + '</dd>' +
        '<dt>현재 사용자</dt><dd>' + esc(d.current_user ? d.current_user.name : '-') + '</dd>' +
        '<dt>현재 프로젝트</dt><dd>' + (d.project ? '<a href="#/project/' + encodeURIComponent(d.project.project_id) + '">' + esc(d.project.project_name) + '</a>' : '-') + '</dd>' +
        '<dt>반납 예정일</dt><dd' + (a.overdue ? ' style="color:var(--st-danger);font-weight:700"' : '') + '>' + esc(a.return_due_date || '-') + '</dd>' +
        '<dt>소속 세트</dt><dd>' + (d.set ? esc(d.set.set_name) + ' <span class="mono small muted">' + esc(d.set.set_id) + '</span>' : '-') + '</dd></dl></div></div>' +
        '<div class="stack"><div class="card card-pad"><div class="section-title">장비 정보</div><dl class="kv">' +
        '<dt>관리번호</dt><dd class="mono">' + esc(a.asset_id) + '</dd><dt>장비명</dt><dd>' + esc(a.asset_name) + '</dd>' +
        '<dt>카테고리</dt><dd>' + esc(A.catName(a.category)) + ' (' + esc(a.category) + ')</dd>' +
        '<dt>제조사 / 모델</dt><dd>' + esc(a.manufacturer) + ' / ' + esc(a.model) + '</dd><dt>시리얼번호</dt><dd class="mono">' + esc(a.serial_number || '-') + '</dd>' +
        '<dt>구매일</dt><dd>' + esc(a.purchase_date || '-') + '</dd>' + ('purchase_price' in a ? '<dt>구매가격</dt><dd>' + esc(C.fmtWon(a.purchase_price) || '-') + '</dd>' : '') +
        '<dt>기본 보관위치</dt><dd>' + esc(a.home_location || '-') + '</dd><dt>메모</dt><dd>' + esc(a.notes || '-') + '</dd>' +
        '<dt>등록 / 수정</dt><dd class="small muted">' + esc(C.fmtDateTime(a.created_at)) + ' / ' + esc(C.fmtDateTime(a.updated_at)) + ' · v' + esc(a.version) + '</dd></dl></div>' +
        '<div class="card"><div class="tabs"><button class="on" data-t="h">입출고 이력 (' + d.history.length + ')</button><button data-t="i">점검 이력 (' + d.inspections.length + ')</button>' + (d.set ? '<button data-t="s">세트 구성</button>' : '') + '</div><div id="tab-body"></div></div></div></div>';
      C.Photos.hydrate(view);
      function tab(t) {
        C.$$('.tabs button', view).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === t); });
        var tb = C.$('#tab-body');
        if (t === 'h') {
          tb.innerHTML = (A.can('admin') && d.history.length ? '<div class="row" style="padding:10px 16px;border-bottom:1px solid var(--border)"><span class="small muted">잘못 처리된 최신 거래는 삭제 대신 "정정" 기록으로 되돌립니다.</span><span class="spacer"></span><button class="btn sm" id="corr">최신 거래 정정</button></div>' : '') + A.txTable(d.history, { noAsset: true });
          A.bindPhotoOpen(tb);
          var cb = C.$('#corr');
          if (cb) cb.onclick = function () {
            var latest = d.history[0];
            A.correctDialog([latest], function () { A.views.asset(view, r); });
          };
        } else if (t === 'i') {
          tb.innerHTML = d.inspections.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>접수</th><th>유형</th><th>내용</th><th>상태</th><th>처리</th></tr></thead><tbody>' + d.inspections.map(function (i) {
            return '<tr><td class="nowrap small">' + esc(C.fmtDateTime(i.reported_at)) + '</td><td>' + esc({ RETURN_ISSUE: '반납 이상', INSPECT: '점검', REPAIR: '수리' }[i.type] || i.type) + '</td><td class="small">' + esc(i.description) +
              (i.photo_url ? ' <a href="#" data-photo-open="' + esc(i.photo_url) + '">[사진]</a>' : '') + '</td><td>' + (i.status === 'RESOLVED' ? '<span class="badge b-available">완료</span>' : '<span class="badge b-inspect">' + (i.status === 'IN_PROGRESS' ? '진행' : '접수') + '</span>') + '</td>' +
              '<td class="small" style="white-space:pre-line">' + esc(i.resolution) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">점검 이력이 없습니다.</div>';
          A.bindPhotoOpen(tb);
        } else {
          tb.innerHTML = '<div class="table-wrap"><table class="tbl"><thead><tr><th>구성품</th><th>필수</th><th>수량</th></tr></thead><tbody>' + d.set.items.map(function (s) {
            return '<tr><td><a class="mono" href="#/asset/' + encodeURIComponent(s.asset_id) + '">' + esc(s.asset_id) + '</a></td><td>' + (s.required ? '필수' : '선택') + '</td><td>' + esc(s.quantity) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        }
      }
      C.$$('.tabs button', view).forEach(function (b) { b.onclick = function () { tab(b.getAttribute('data-t')); }; });
      tab('h');
      var ed = C.$('#ed'); if (ed) ed.onclick = function () { editAsset(a, function () { A.views.asset(view, r); }); };
      var stb = C.$('#st'); if (stb) stb.onclick = function () { A.statusDialog([a.asset_id], function () { A.views.asset(view, r); }); };
      var ins = C.$('#insp'); if (ins) ins.onclick = function () { A.reportDialog(a.asset_id, function () { A.views.asset(view, r); }); };
      var ph = C.$('#ph');
      if (ph) ph.onchange = function (e) {
        var f = e.target.files[0]; if (!f) return;
        var lbl = ph.parentNode; C.busy(lbl, true);
        C.Photos.upload(f, 'asset', a.asset_id).then(function (url) {
          return Api.call('assets.update', { request_id: A.req(), asset_id: a.asset_id, version: a.version, fields: { photo_url: url } });
        }).then(function () { C.toast('사진이 저장되었습니다.'); A.assets = null; A.views.asset(view, r); })
          .catch(function (err) { C.busy(lbl, false); C.showError(err); });
      };
    }).catch(function (e) { A.err(view, e); });
  };

  function assetFormHtml(a, isNew) {
    a = a || {};
    var cats = A.boot.settings.categories, locs = A.boot.settings.locations;
    return '<div class="grid-2">' +
      (isNew ? '<div class="field"><label class="req">카테고리</label><select class="input" name="category">' + cats.map(function (c) { return '<option value="' + esc(c.code) + '"' + (a.category === c.code ? ' selected' : '') + '>' + esc(c.name) + ' (' + esc(c.code) + ')</option>'; }).join('') + '</select><span class="hint">관리번호 C2-코드-번호 가 자동 부여됩니다.</span></div>' +
        '<div class="field"><label>관리번호 (선택)</label><input class="input mono" name="asset_id" placeholder="비우면 자동 (기존 라벨 번호가 있을 때만 입력)" value="' + esc(a.asset_id || '') + '"></div>' : '') +
      '<div class="field"><label class="req">장비명</label><input class="input" name="asset_name" maxlength="120" value="' + esc(a.asset_name || '') + '"></div>' +
      '<div class="field"><label>기본 보관위치</label><select class="input" name="home_location"><option value="">-</option>' + locs.map(function (l) { return '<option' + (a.home_location === l.name ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>제조사</label><input class="input" name="manufacturer" value="' + esc(a.manufacturer || '') + '"></div>' +
      '<div class="field"><label>모델명</label><input class="input" name="model" value="' + esc(a.model || '') + '"></div>' +
      '<div class="field"><label>시리얼번호</label><input class="input mono" name="serial_number" value="' + esc(a.serial_number || '') + '"><span class="hint">중복이면 경고 후 확인을 받습니다.</span></div>' +
      '<div class="field"><label>구매일</label><input class="input" type="date" name="purchase_date" value="' + esc(a.purchase_date || '') + '"></div>' +
      '<div class="field"><label>구매가격 (원)</label><input class="input" name="purchase_price" inputmode="numeric" value="' + esc(a.purchase_price === undefined ? '' : a.purchase_price) + '"></div>' +
      '<div class="field" style="grid-column:1/-1"><label>메모</label><textarea class="input" name="notes" maxlength="1000">' + esc(a.notes || '') + '</textarea></div></div>';
  }
  function formValues(root) {
    var o = {};
    C.$$('[name]', root).forEach(function (el) { o[el.name] = el.value.trim(); });
    return o;
  }

  function editAsset(a, done) {
    var m = C.modal({
      title: a.asset_id + ' 정보 수정', wide: true, body: assetFormHtml(a, false),
      actions: [{ label: '취소' }, {
        label: '저장', cls: 'primary', onClick: function (close, btn, body) {
          var f = formValues(body);
          var send = function (confirmWarn) {
            return Api.call('assets.update', { request_id: A.req(), asset_id: a.asset_id, version: a.version, fields: f, confirm_warnings: confirmWarn }).then(function (d) {
              C.toast(d.changed.length ? '저장되었습니다.' : '변경된 내용이 없습니다.'); A.assets = null; done();
            }, function (e) {
              if (e.code === 'NEEDS_CONFIRM') return C.confirmDialog('확인 필요', esc(e.message), '그래도 저장').then(function (ok) { if (ok) return send(true); return false; });
              if (e.code === 'CONFLICT') { C.toast(e.message, 'err'); done(); return; }
              throw e;
            });
          };
          return send(false);
        }
      }]
    });
    return m;
  }

  // ---------------- 장비 등록 + CSV ----------------
  var CSV_ALIASES = {
    '관리번호': 'asset_id', '장비명': 'asset_name', '카테고리': 'category', '제조사': 'manufacturer', '모델명': 'model', '모델': 'model',
    '시리얼번호': 'serial_number', '시리얼': 'serial_number', '구매일': 'purchase_date', '구매가격': 'purchase_price', '보관위치': 'home_location',
    '기본보관위치': 'home_location', '메모': 'notes', '비고': 'notes'
  };
  var CSV_FIELDS = ['asset_id', 'asset_name', 'category', 'manufacturer', 'model', 'serial_number', 'purchase_date', 'purchase_price', 'home_location', 'notes'];

  A.views.register = function (view, r) {
    A.setTitle('장비 등록');
    if (!A.can('manage')) { view.innerHTML = '<div class="card"><div class="empty">권한이 없습니다.</div></div>'; return; }
    view.innerHTML = '<div class="dash-grid"><div class="card"><div class="card-head"><h3>개별 등록</h3></div><form class="card-pad" id="reg-form">' + assetFormHtml({}, true) +
      '<div class="field" style="margin-top:12px"><label>사진</label><input type="file" accept="image/*" id="reg-photo" class="input"></div>' +
      '<div class="row" style="margin-top:16px;justify-content:flex-end"><button type="reset" class="btn">초기화</button><button class="btn primary" id="reg-btn">등록</button></div></form><div id="reg-result"></div></div>' +
      '<div class="card" id="csv-card"><div class="card-head"><h3>CSV 일괄 등록</h3><span class="spacer"></span><button class="btn sm" id="csv-sample">' + icon('download') + ' 샘플 CSV</button></div><div class="card-pad stack">' +
      '<p class="small muted" style="margin:0">첫 줄은 열 이름입니다. 영문(asset_name…) 또는 한글(장비명, 카테고리, 제조사, 모델명, 시리얼번호, 구매일, 구매가격, 보관위치, 메모) 모두 가능합니다. ' +
      '카테고리는 코드(PJ) 또는 이름(프로젝터), 관리번호는 비우면 자동 부여됩니다. 먼저 검사한 뒤 오류가 없을 때만 등록됩니다.</p>' +
      '<input type="file" accept=".csv,text/csv" class="input" id="csv-file"><div id="csv-report"></div></div></div></div>';
    if (r.q.csv) setTimeout(function () { C.$('#csv-card').scrollIntoView({ behavior: 'smooth' }); }, 50);
    C.$('#csv-sample').onclick = function () {
      C.downloadText('C2_장비등록_샘플.csv', C.toCsv([
        ['장비명', '카테고리', '제조사', '모델명', '시리얼번호', '구매일', '구매가격', '보관위치', '메모', '관리번호'],
        ['레이저 프로젝터 12K', 'PJ', 'Panasonic', 'PT-RZ120', 'SN-0001', '2024-03-15', '12000000', A.boot.settings.locations[0] ? A.boot.settings.locations[0].name : '', '', ''],
        ['줌 렌즈', '렌즈', 'Panasonic', 'ET-D75LE6', 'SN-0002', '2024-03-15', '3500000', A.boot.settings.locations[0] ? A.boot.settings.locations[0].name : '', '', '']
      ]));
    };
    var form = C.$('#reg-form');
    form.onsubmit = function (e) {
      e.preventDefault();
      var btn = C.$('#reg-btn');
      var f = formValues(form);
      if (!f.asset_name) return C.toast('장비명을 입력하세요.', 'err');
      var file = C.$('#reg-photo').files[0];
      var reqId = A.req();
      C.busy(btn, true);
      var photoP = file ? C.Photos.upload(file, 'asset', 'new') : Promise.resolve('');
      photoP.then(function (url) {
        if (url) f.photo_url = url;
        var send = function (cw) {
          return Api.call('assets.create', { request_id: reqId, asset: f, confirm_warnings: cw }).catch(function (e2) {
            if (e2.code === 'NEEDS_CONFIRM') return C.confirmDialog('확인 필요', esc(e2.message), '그래도 등록').then(function (ok) { if (ok) return send(true); throw new Error('등록을 취소했습니다.'); });
            throw e2;
          });
        };
        return send(false);
      }).then(function (d) {
        C.busy(btn, false);
        A.assets = null;
        C.toast(d.asset_id + ' 등록 완료');
        C.$('#reg-result').innerHTML = '<div class="card-pad" style="border-top:1px solid var(--border)"><div class="qr-panel"><div class="qr-box" style="width:90px">' + C.qrSvg(d.asset_id, { quiet: 2 }) + '</div><div><div class="mono" style="font-size:18px;font-weight:800">' + esc(d.asset_id) + '</div>' +
          '<div class="row" style="margin-top:8px"><a class="btn sm" href="#/asset/' + encodeURIComponent(d.asset_id) + '">상세 보기</a><a class="btn sm primary" href="#/labels?ids=' + encodeURIComponent(d.asset_id) + '">라벨 출력</a></div></div></div></div>';
        form.reset();
      }).catch(function (e2) { C.busy(btn, false); C.showError(e2); });
    };
    C.$('#csv-file').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { csvCheck(String(rd.result)); };
      rd.onerror = function () { C.toast('파일을 읽지 못했습니다.', 'err'); };
      rd.readAsText(f, 'utf-8');
    };
  };

  function csvCheck(text) {
    var box = C.$('#csv-report');
    var rows = C.parseCsv(text);
    if (rows.length < 2) { box.innerHTML = '<div class="notice bad">데이터 행이 없습니다.</div>'; return; }
    var hdr = rows[0].map(function (h) { h = h.trim(); return CSV_ALIASES[h] || CSV_ALIASES[h.replace(/\s/g, '')] || h.toLowerCase(); });
    var unknown = hdr.filter(function (h) { return CSV_FIELDS.indexOf(h) < 0 && h; });
    if (hdr.indexOf('asset_name') < 0 || hdr.indexOf('category') < 0) {
      box.innerHTML = '<div class="issue-row error">필수 열(장비명/asset_name, 카테고리/category)이 없습니다. 샘플 CSV를 참고하세요.</div>'; return;
    }
    var data = rows.slice(1).map(function (r) {
      var o = {};
      hdr.forEach(function (h, i) { if (CSV_FIELDS.indexOf(h) >= 0) o[h] = (r[i] || '').trim(); });
      return o;
    });
    A.loading(box, data.length + '행 검사 중');
    Api.call('assets.importCsv', { rows: data, dryRun: true }).then(function (d) {
      var warnRows = d.rows.filter(function (x) { return x.warnings.length; });
      box.innerHTML = '<div class="row wrap" style="margin-bottom:10px"><span class="badge b-dark">' + d.total + '행</span><span class="badge b-available">' + icon('check') + '정상 ' + d.valid + '</span>' +
        (d.errors ? '<span class="badge b-danger">' + icon('x') + '오류 ' + d.errors + '</span>' : '') + (warnRows.length ? '<span class="badge b-inspect">' + icon('warn') + '경고 ' + warnRows.length + '</span>' : '') +
        (unknown.length ? '<span class="small muted">무시된 열: ' + esc(unknown.join(', ')) + '</span>' : '') + '</div>' +
        '<div class="table-wrap" style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:8px"><table class="tbl"><thead><tr><th>행</th><th>부여 관리번호</th><th>장비명</th><th>결과</th></tr></thead><tbody>' +
        d.rows.map(function (x) {
          return '<tr' + (x.errors.length ? ' style="background:var(--st-danger-bg)"' : x.warnings.length ? ' style="background:var(--st-inspect-bg)"' : '') + '><td>' + x.row + '</td><td class="mono">' + esc(x.asset_id) + '</td><td>' + esc(x.asset_name) + '</td>' +
            '<td class="small">' + esc(x.errors.concat(x.warnings).join(' / ') || '정상') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="row" style="margin-top:12px;justify-content:flex-end">' + (d.errors ? '<span class="small" style="color:var(--st-danger)">오류를 수정한 CSV를 다시 선택하세요. (오류가 있으면 등록하지 않습니다)</span>' :
          '<button class="btn primary" id="csv-commit">' + d.valid + '개 장비 등록</button>') + '</div>';
      var cb = C.$('#csv-commit');
      if (cb) {
        var reqId = A.req();
        cb.onclick = function () {
          var go2 = function () {
            C.busy(cb, true);
            Api.call('assets.importCsv', { rows: data, dryRun: false, request_id: reqId }, { timeout: 300000 }).then(function (r2) {
              A.assets = null;
              box.innerHTML = '<div class="notice good">' + icon('check') + (r2.duplicate ? '이미 처리된 요청입니다 (중복 등록 없음).' : r2.imported + '개 장비가 등록되었습니다.') + '</div>' +
                '<div class="row" style="margin-top:10px"><a class="btn" href="#/assets">장비 목록 보기</a></div>';
              C.$('#csv-file').value = '';
            }).catch(function (e) { C.busy(cb, false); C.showError(e); });
          };
          if (warnRows.length) C.confirmDialog('경고 확인', warnRows.length + '개 행에 경고(시리얼 중복 등)가 있습니다. 그래도 등록할까요?', '등록').then(function (ok) { if (ok) go2(); });
          else go2();
        };
      }
    }).catch(function (e) { box.innerHTML = '<div class="issue-row error">' + esc(e.message) + '</div>'; });
  }

  // ---------------- QR 라벨 ----------------
  A.views.labels = function (view, r) {
    A.setTitle('QR 라벨 출력');
    A.loading(view);
    Promise.all([A.loadAssets(false), Api.call('sets.list', {})]).then(function (res) {
      var assets = res[0], sets = res[1].sets;
      var byId = {};
      assets.forEach(function (a) { byId[a.asset_id] = a; });
      var picked = {};
      if (r.q.ids) r.q.ids.split(',').forEach(function (id) { if (byId[id]) picked[id] = true; });
      else if (r.q.from === 'sel') Object.keys(A.sel).forEach(function (id) { if (byId[id]) picked[id] = true; });
      var pickedSets = {};
      if (r.q.set) pickedSets[r.q.set] = true;
      var sys = A.boot.settings.system;
      var opt = { type: 'A', start: 0, offsetX: Number(sys.LABEL_OFFSET_X_MM) || 0, offsetY: Number(sys.LABEL_OFFSET_Y_MM) || 0 };
      view.innerHTML = '<div class="dash-grid" style="grid-template-columns:380px minmax(0,1fr)"><div class="stack">' +
        '<div class="card card-pad stack"><div class="section-title" style="margin:0">라벨 규격</div><div class="row">' +
        '<label class="check"><input type="radio" name="lt" value="A" checked> A형 60×40mm (21칸)</label><label class="check"><input type="radio" name="lt" value="B"> B형 50×25mm (44칸)</label></div>' +
        '<div class="grid-3"><div class="field"><label>시작 칸</label><input class="input" type="number" min="1" id="l-start" value="1"><span class="hint">쓰다 남은 용지</span></div>' +
        '<div class="field"><label>가로 보정(mm)</label><input class="input" type="number" step="0.5" id="l-ox" value="' + opt.offsetX + '"></div>' +
        '<div class="field"><label>세로 보정(mm)</label><input class="input" type="number" step="0.5" id="l-oy" value="' + opt.offsetY + '"></div></div>' +
        '<button class="btn primary lg" id="l-print">' + icon('printer') + ' 인쇄</button><p class="small muted" style="margin:0">인쇄 대화상자에서 <b>배율 100%(실제 크기)</b>, 여백 없음으로 설정하세요. 첫 인쇄는 일반 A4에 테스트 후 라벨지에 겹쳐 확인하세요.</p></div>' +
        '<div class="card"><div class="card-head"><h3>출력할 장비</h3><span class="spacer"></span><span class="badge b-dark" id="l-count">0</span></div><div class="card-pad stack">' +
        '<div class="row"><input class="input" id="l-add" placeholder="관리번호 입력/스캔 후 Enter" style="font-family:var(--mono)"><button class="btn" id="l-filter">검색결과 추가</button></div>' +
        '<div class="chips" id="l-chips"></div><button class="btn sm ghost" id="l-clear" style="align-self:flex-start">모두 비우기</button></div></div>' +
        '<div class="card"><div class="card-head"><h3>세트 QR</h3></div><div class="card-pad">' + (sets.length ? sets.map(function (s) {
          return '<label class="check" style="display:flex;margin-bottom:6px"><input type="checkbox" data-set="' + esc(s.set_id) + '"' + (pickedSets[s.set_id] ? ' checked' : '') + '> ' + esc(s.set_name) + ' <span class="mono small muted">' + esc(s.set_id) + '</span></label>';
        }).join('') : '<span class="muted small">등록된 세트가 없습니다.</span>') + '</div></div></div>' +
        '<div class="card"><div class="card-head"><h3>미리보기</h3><span class="small muted">점선은 라벨 경계 (인쇄되지 않음)</span></div><div class="label-preview" id="l-prev"></div></div></div>';
      function items() {
        var list = Object.keys(picked).sort().map(function (id) {
          var a = byId[id];
          return { code: a.qr_value || a.asset_id, id: a.asset_id, name: a.asset_name, sub: a.model };
        });
        Object.keys(pickedSets).forEach(function (sid) {
          var s = sets.filter(function (x) { return x.set_id === sid; })[0];
          if (s) list.push({ code: 'SET:' + s.set_id, id: s.set_id, name: s.set_name, sub: '세트 · 구성품 ' + s.items.length + '개' });
        });
        return list;
      }
      function readOpt() {
        opt.type = C.$('input[name="lt"]:checked').value;
        opt.start = Math.max(0, (parseInt(C.$('#l-start').value, 10) || 1) - 1);
        opt.offsetX = Number(C.$('#l-ox').value) || 0;
        opt.offsetY = Number(C.$('#l-oy').value) || 0;
      }
      function render() {
        readOpt();
        var list = items();
        C.$('#l-count').textContent = list.length;
        var ids = Object.keys(picked).sort();
        C.$('#l-chips').innerHTML = ids.slice(0, 200).map(function (id) { return '<span class="chip"><span class="mono">' + esc(id) + '</span><button data-rm="' + esc(id) + '" aria-label="빼기">' + icon('x') + '</button></span>'; }).join('') + (ids.length > 200 ? '<span class="small muted">외 ' + (ids.length - 200) + '개</span>' : '') + (ids.length ? '' : '<span class="small muted">장비를 추가하세요.</span>');
        C.$$('[data-rm]', view).forEach(function (b) { b.onclick = function () { delete picked[b.getAttribute('data-rm')]; render(); }; });
        var prev = C.$('#l-prev');
        prev.innerHTML = list.length ? C2Labels.sheetsHtml(list.slice(0, 88), Object.assign({}, opt, { guide: true })) + (list.length > 88 ? '<p class="small muted" style="text-align:center">미리보기는 앞부분만 표시 — 인쇄 시 전체 ' + list.length + '장</p>' : '') : '<div class="empty">출력할 항목이 없습니다.</div>';
        var w = prev.clientWidth - 32;
        var scale = Math.min(1, w / (210 * 3.78));
        C.$$('.label-sheet', prev).forEach(function (s) { s.style.zoom = scale; });
      }
      C.$$('input[name="lt"], #l-start, #l-ox, #l-oy').forEach(function (el) { el.onchange = render; });
      C.$$('[data-set]', view).forEach(function (x) { x.onchange = function () { if (x.checked) pickedSets[x.getAttribute('data-set')] = true; else delete pickedSets[x.getAttribute('data-set')]; render(); }; });
      C.$('#l-add').onkeydown = function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var v = e.target.value.trim().toUpperCase();
        e.target.value = '';
        if (byId[v]) { picked[v] = true; render(); } else C.toast('등록되지 않은 관리번호: ' + v, 'err');
      };
      C.$('#l-filter').onclick = function () {
        var list = A.filterAssets(assets, A.listState);
        list.forEach(function (a) { picked[a.asset_id] = true; });
        C.toast('전체 장비 화면의 현재 검색결과 ' + list.length + '개 추가');
        render();
      };
      C.$('#l-clear').onclick = function () { picked = {}; pickedSets = {}; C.$$('[data-set]').forEach(function (x) { x.checked = false; }); render(); };
      C.$('#l-print').onclick = function () {
        readOpt();
        var list = items();
        if (!list.length) return C.toast('출력할 항목이 없습니다.', 'err');
        C2Labels.print(list, opt);
      };
      render();
    }).catch(function (e) { A.err(view, e); });
  };

  A.boot0 = boot; // admin-views.js 로드 후 호출
})();
