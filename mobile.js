/* C2 EQUIPMENT MANAGER — 직원용 모바일 웹앱 */
(function () {
  'use strict';
  var C = window.C2, esc = C.esc, icon = C.icon, Api = C.Api;
  var app = document.getElementById('app');
  var S = { boot: null, user: null, assets: null, assetsAt: 0, scanner: null, fileScanner: null, last: { code: '', t: 0 }, busyScan: false, lastDone: null, holdings: null };

  // ---------------- 로컬 상태 (새로고침해도 유지) ----------------
  function k(name) { return 'c2em.' + name + '.' + S.user.user_id; }
  function getCart() { return C.Store.get(k('cart'), { project_id: '', items: [], due_date: '', receiver_user_id: '', notes: '', request_id: null, fails: {} }); }
  function saveCart(c) { C.Store.set(k('cart'), c); badges(); }
  function touchCart(c) { c.request_id = null; saveCart(c); }
  function getRet() { return C.Store.get(k('ret'), { items: [], request_id: null, fails: {} }); }
  function saveRet(r) { C.Store.set(k('ret'), r); badges(); }
  function touchRet(r) { r.request_id = null; saveRet(r); }
  function can(p) { return !!(S.boot && S.boot.perms && S.boot.perms[p]); }
  function setting(key, def) { var s = S.boot.settings.system || {}; return key in s ? s[key] : def; }
  function projectById(id) { return S.boot.projects.filter(function (p) { return p.project_id === id; })[0] || null; }
  function userName(id) { var u = S.boot.users.filter(function (x) { return x.user_id === id; })[0]; return u ? u.name : ''; }
  function catName(code) { var c = S.boot.settings.categories.filter(function (x) { return x.code === code; })[0]; return c ? c.name : code; }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* noop */ } }

  function loadAssets(force) {
    if (!force && S.assets && Date.now() - S.assetsAt < 60000) return Promise.resolve(S.assets);
    return Api.call('assets.list', {}).then(function (d) { S.assets = d.assets; S.assetsAt = Date.now(); return S.assets; });
  }

  // ---------------- 부트 ----------------
  function boot() {
    C.envRibbon();
    Api.onAuthState = function (err) { if (err.code === 'NOT_APPROVED' || err.code === 'FORBIDDEN') { if (S.user) start(); } };
    if (!C.Auth.restore()) return showLogin();
    start();
  }

  function showLogin() {
    app.innerHTML = C.loginScreenHtml();
    C.Auth._waiters.push(function () { start(); });
    C.Auth.renderButton(app.querySelector('[data-login]'));
  }

  function start() {
    app.innerHTML = '<div class="loading-block"><span class="spin"></span>계정 확인 중</div>';
    Api.call('session.me', {}).then(function (me) {
      if (me.status !== 'ACTIVE') return stateScreen(me);
      return Api.call('app.bootstrap', {}).then(function (b) {
        S.boot = b; S.user = b.user;
        shell();
        route();
      });
    }).catch(function (e) {
      app.innerHTML = '<div class="state-screen"><div class="icon-circle">' + icon('warn') + '</div><h2>연결할 수 없습니다</h2><p>' + esc(e.message) + '</p><button class="btn primary lg" id="retry">다시 시도</button></div>';
      C.$('#retry').onclick = start;
    });
  }

  function stateScreen(me) {
    var pending = me.status === 'PENDING';
    app.innerHTML = '<div class="state-screen"><img src="logo-h-black.png" alt="C2" style="height:28px;margin-bottom:12px">' +
      '<div class="icon-circle">' + icon(pending ? 'clock' : 'shield') + '</div>' +
      '<h2>' + (pending ? '관리자 승인 대기 중' : '사용이 중지된 계정') + '</h2>' +
      '<p>' + esc(me.google.email || '') + '</p>' +
      '<p>' + (pending ? '관리자에게 이 Gmail 주소의 승인을 요청하세요. 승인 후 새로고침하면 사용할 수 있습니다.' : '이 계정은 비활성화되었습니다. 관리자에게 문의하세요.') + '</p>' +
      '<div class="row"><button class="btn lg" id="reload">새로고침</button><button class="btn lg ghost" id="out">다른 계정</button></div></div>';
    C.$('#reload').onclick = start;
    C.$('#out').onclick = function () { C.Auth.signOut(); };
  }

  // ---------------- 셸 / 라우팅 ----------------
  function shell() {
    app.innerHTML =
      '<header class="m-head"><a href="#/home" aria-label="홈"><img class="logo" src="logo-h-yellow.png" alt="C2 ARTECHNOLOZY"></a>' +
      '<button class="me" id="me-btn">' + icon('user') + '<span>' + esc(S.user.name) + '</span></button></header>' +
      '<main class="m-view" id="view"></main>' +
      '<nav class="m-nav" aria-label="주요 메뉴">' +
      '<a href="#/home" data-tab="home">' + icon('home') + '홈</a>' +
      '<a href="#/cart" data-tab="cart">' + icon('cart') + '바구니<span class="cnt hidden" id="cnt-cart"></span></a>' +
      '<a href="#/scan" data-tab="scan" class="scan-tab" aria-label="QR 스캔"><span class="scan-dot">' + icon('scan') + '</span></a>' +
      '<a href="#/return" data-tab="return">' + icon('ret') + '반납<span class="cnt hidden" id="cnt-ret"></span></a>' +
      '<a href="#/mine" data-tab="mine">' + icon('list') + '내 목록</a></nav>' +
      '<div id="file-reader" class="hidden"></div>';
    C.$('#me-btn').onclick = meSheet;
    window.onhashchange = route;
    badges();
  }

  function badges() {
    if (!S.user) return;
    var c = getCart().items.length, r = getRet().items.length;
    var a = C.$('#cnt-cart'), b = C.$('#cnt-ret');
    if (a) { a.textContent = c; a.classList.toggle('hidden', !c); }
    if (b) { b.textContent = r; b.classList.toggle('hidden', !r); }
  }

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = {};
    var i = h.indexOf('?');
    if (i >= 0) { h.slice(i + 1).split('&').forEach(function (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); h = h.slice(0, i); }
    var parts = h.split('/');
    return { name: parts[0] || 'home', arg: parts[1] ? decodeURIComponent(parts[1]) : '', q: q };
  }

  function route() {
    stopScanner();
    var r = parseHash();
    C.$$('.m-nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === r.name); });
    var view = C.$('#view');
    view.innerHTML = '';
    window.scrollTo(0, 0);
    var fn = { home: vHome, scan: vScan, cart: vCart, return: vReturn, mine: vMine, search: vSearch, done: vDone }[r.name] || vHome;
    fn(view, r);
  }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }

  // ---------------- 홈 ----------------
  function vHome(view) {
    var cart = getCart(), ret = getRet();
    var p = projectById(cart.project_id);
    view.innerHTML =
      '<div class="m-hello"><div><div class="muted small">' + esc(C.todayStr()) + '</div><b>' + esc(S.user.name) + '님, 안녕하세요</b></div>' +
      '<span class="badge b-yellow">' + esc(C.ROLE_LABEL[S.user.role] || S.user.role) + '</span></div>' +
      (can('operate') ? projectChip(p) : '') +
      '<div class="tiles">' +
      '<a class="tile hero" href="#/scan"><div><b style="font-size:20px">QR 스캔</b><span>' + (can('operate') ? '장비 QR을 비추면 바로 반출·반납' : '장비 정보 조회') + '</span></div><div class="hero-ic">' + icon('scan') + '</div></a>' +
      (can('operate') ? '<a class="tile" href="#/cart">' + icon('cart') + '<div><b>반출 바구니</b><span><span class="count">' + cart.items.length + '</span> 개 담김</span></div></a>' +
        '<a class="tile" href="#/return">' + icon('ret') + '<div><b>반납</b><span><span class="count">' + ret.items.length + '</span> 개 대기</span></div></a>' : '') +
      '<a class="tile" href="#/search">' + icon('search') + '<div><b>장비 검색</b><span>관리번호·이름·모델</span></div></a>' +
      '<a class="tile" href="#/mine">' + icon('list') + '<div><b>내 반출 목록</b><span id="mine-count">확인 중…</span></div></a>' +
      '</div>' +
      (can('manage') ? '<p class="small muted" style="margin-top:20px;text-align:center"><a href="admin.html">PC 관리자 화면 열기 →</a></p>' : '');
    var chip = C.$('#project-chip');
    if (chip) chip.onclick = function () { pickProject(function () { route(); }); };
    Api.call('me.holdings', {}).then(function (d) {
      S.holdings = d.assets;
      var late = d.assets.filter(function (a) { return a.overdue; }).length;
      var el = C.$('#mine-count');
      if (el) el.innerHTML = '<span class="count">' + d.assets.length + '</span> 개' + (late ? ' · <b style="color:var(--st-danger)">지연 ' + late + '</b>' : '');
    }).catch(function () { var el = C.$('#mine-count'); if (el) el.textContent = '불러오기 실패'; });
  }

  function projectChip(p) {
    return '<button class="m-project-chip' + (p ? '' : ' empty-p') + '" id="project-chip"><div class="grow"><div class="lbl">반출 프로젝트</div>' +
      '<div class="val ellipsis">' + (p ? esc(p.project_name) : '프로젝트를 선택하세요') + '</div>' +
      (p ? '<div class="small muted ellipsis">' + esc(p.project_id) + (p.location ? ' · ' + esc(p.location) : '') + '</div>' : '') + '</div>' + icon('chevron') + '</button>';
  }

  function pickProject(done) {
    var list = S.boot.projects;
    var cart = getCart();
    var body = document.createElement('div');
    body.innerHTML = '<input class="input" placeholder="프로젝트 검색" id="pp-q" style="margin-bottom:10px">' +
      '<div class="m-list" id="pp-list"></div>' +
      (list.length ? '' : '<div class="empty">진행 중인 프로젝트가 없습니다. 관리자에게 프로젝트 등록을 요청하세요.</div>');
    var m = C.modal({ title: '프로젝트 선택', body: body, actions: [{ label: '닫기' }] });
    function render(q) {
      q = (q || '').toLowerCase();
      body.querySelector('#pp-list').innerHTML = list.filter(function (p) {
        return !q || (p.project_name + ' ' + p.project_id + ' ' + (p.client || '') + ' ' + (p.location || '')).toLowerCase().indexOf(q) >= 0;
      }).map(function (p) {
        return '<div class="m-item clickable" data-pid="' + esc(p.project_id) + '"><div class="grow"><div class="t1">' + esc(p.project_name) + '</div>' +
          '<div class="t2">' + esc(p.project_id) + ' · ' + esc(C.PROJECT_STATUS[p.status] || p.status) + (p.location ? ' · ' + esc(p.location) : '') + '</div></div>' +
          (p.project_id === cart.project_id ? '<span class="badge b-dark">' + icon('check') + '선택됨</span>' : '') + '</div>';
      }).join('');
      C.$$('[data-pid]', body).forEach(function (el) {
        el.onclick = function () {
          var c = getCart();
          c.project_id = el.getAttribute('data-pid');
          touchCart(c);
          m.close();
          if (done) done(c.project_id);
        };
      });
    }
    render('');
    body.querySelector('#pp-q').oninput = function (e) { render(e.target.value); };
  }

  // ---------------- 스캔 ----------------
  function vScan(view, r) {
    var mode = r.q.mode || (can('operate') ? 'out' : 'view');
    if (!can('operate')) mode = 'view';
    var cart = getCart();
    var p = projectById(cart.project_id);
    view.innerHTML =
      (can('operate') ? '<div class="mode-toggle" role="tablist"><button data-mode="out" class="' + (mode === 'out' ? 'on' : '') + '">반출 스캔</button><button data-mode="in" class="' + (mode === 'in' ? 'on' : '') + '">반납 스캔</button></div>' : '') +
      (mode === 'out' ? projectChip(p) : '') +
      '<div class="scan-wrap"><div id="reader"></div><div class="scan-frame"></div><div class="scan-msg" id="scan-msg">QR코드를 사각형 안에 맞춰 주세요</div>' +
      '<div class="scan-off hidden" id="scan-off"></div></div>' +
      '<form class="manual" id="manual"><input class="input" id="manual-code" placeholder="관리번호 직접 입력 (예: C2-PJ-001)" autocomplete="off" autocapitalize="characters" inputmode="text"><button class="btn dark">확인</button></form>' +
      '<div class="row" style="margin-top:10px"><label class="btn block" style="min-height:44px">' + icon('camera') + ' 사진으로 QR 인식<input type="file" accept="image/*" capture="environment" id="file-scan" class="sr-only"></label></div>' +
      '<p class="small muted" style="text-align:center;margin-top:12px">' + (mode === 'out' ? '바구니 ' + cart.items.length + '개 · 연속으로 스캔하세요' : mode === 'in' ? '반납 목록 ' + getRet().items.length + '개 · 반출 중 장비를 스캔하면 바로 담깁니다' : '조회 전용 계정입니다') + '</p>';
    C.$$('[data-mode]', view).forEach(function (b) { b.onclick = function () { go('#/scan?mode=' + b.getAttribute('data-mode')); }; });
    var chip = C.$('#project-chip', view);
    if (chip) chip.onclick = function () { pickProject(function () { route(); }); };
    C.$('#manual', view).onsubmit = function (e) {
      e.preventDefault();
      var v = C.$('#manual-code').value.trim();
      if (v) { handleCode(v, mode, true); C.$('#manual-code').value = ''; }
    };
    C.$('#file-scan', view).onchange = function (e) {
      var f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (!window.Html5Qrcode) return C.toast('QR 인식 모듈을 불러오지 못했습니다.', 'err');
      if (!S.fileScanner) S.fileScanner = new Html5Qrcode('file-reader', { verbose: false });
      S.fileScanner.scanFile(f, false).then(function (code) { handleCode(code, mode, true); })
        .catch(function () { C.toast('사진에서 QR코드를 찾지 못했습니다. 더 가까이, 밝게 찍어 주세요.', 'err'); });
    };
    startScanner(function (code) { handleCode(code, mode, false); });
  }

  function cameraOff(msg) {
    var off = C.$('#scan-off');
    if (!off) return;
    off.classList.remove('hidden');
    off.innerHTML = icon('camera') + '<div style="font-weight:700">' + esc(msg) + '</div><div class="small" style="color:#AAA">아래에서 관리번호를 직접 입력하거나 "사진으로 QR 인식"을 이용하세요.</div>';
    var m = C.$('#scan-msg'); if (m) m.classList.add('hidden');
    var f = C.$('.scan-frame'); if (f) f.classList.add('hidden');
  }

  function startScanner(onCode) {
    if (!window.isSecureContext) return cameraOff('보안 연결(HTTPS)에서만 카메라를 사용할 수 있습니다.');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return cameraOff('이 브라우저는 카메라 스캔을 지원하지 않습니다.');
    if (!window.Html5Qrcode) return cameraOff('QR 인식 모듈을 불러오지 못했습니다.');
    try {
      var sc = new Html5Qrcode('reader', { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
      S.scanner = sc;
      sc.start({ facingMode: 'environment' }, {
        fps: 12,
        qrbox: function (w, h) { var s = Math.max(60, Math.floor(Math.min(w, h) * 0.64)); return { width: s, height: s }; },
        aspectRatio: 1
      }, function (text) { onCode(text); }, function () { /* 프레임별 인식 실패는 무시 */ })
        .catch(function (err) {
          S.scanner = null;
          var s = String(err && (err.name || err.message || err));
          if (/NotAllowed|Permission/i.test(s)) cameraOff('카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용하면 바로 스캔할 수 있습니다.');
          else if (/NotFound|Overconstrained|no camera/i.test(s)) cameraOff('사용 가능한 카메라를 찾지 못했습니다.');
          else if (/NotReadable|in use/i.test(s)) cameraOff('다른 앱이 카메라를 사용 중입니다.');
          else cameraOff('카메라를 시작하지 못했습니다.');
        });
    } catch (e) { cameraOff('카메라를 시작하지 못했습니다.'); }
  }
  function pauseScanner() { try { if (S.scanner && S.scanner.getState && S.scanner.getState() === 2) S.scanner.pause(true); } catch (e) { /* noop */ } }
  function resumeScanner() { try { if (S.scanner && S.scanner.getState && S.scanner.getState() === 3) S.scanner.resume(); } catch (e) { /* noop */ } }
  function stopScanner() {
    var sc = S.scanner;
    S.scanner = null;
    if (!sc) return;
    try {
      var st = sc.getState ? sc.getState() : 0;
      if (st === 2 || st === 3) sc.stop().then(function () { try { sc.clear(); } catch (e) { /* noop */ } }).catch(function () { /* noop */ });
    } catch (e) { /* noop */ }
  }

  function handleCode(code, mode, manual) {
    var now = Date.now();
    if (!manual && code === S.last.code && now - S.last.t < 2500) return; // 같은 코드 연속 인식 방지
    if (S.busyScan) return;
    S.last = { code: code, t: now };
    S.busyScan = true;
    pauseScanner();
    vibrate(30);
    Api.call('assets.lookup', { code: code }).then(function (res) {
      S.busyScan = false;
      if (res.type === 'set') return setSheet(res, mode);
      if (mode === 'in' && res.can_return) { // 반납 스캔: 바로 담기
        addToReturn([res.asset]);
        C.toast(res.asset.asset_id + ' 반납 목록에 담김 (' + getRet().items.length + '개)');
        refreshScanHint(mode);
        setTimeout(resumeScanner, 600);
        return;
      }
      assetSheet(res, mode);
    }).catch(function (e) {
      S.busyScan = false;
      sheet('<div class="notice bad">' + icon('warn') + '<div>' + esc(e.message) + '<div class="small mono" style="margin-top:4px;font-weight:400">' + esc(code) + '</div></div></div>' +
        '<button class="btn lg block" style="margin-top:14px" data-close>다시 스캔</button>', resumeScanner);
    });
  }

  function refreshScanHint(mode) {
    var p = C.$('#view .small.muted:last-child');
    if (p && parseHash().name === 'scan') p.textContent = mode === 'out' ? '바구니 ' + getCart().items.length + '개 · 연속으로 스캔하세요' : '반납 목록 ' + getRet().items.length + '개 · 반출 중 장비를 스캔하면 바로 담깁니다';
  }

  /** 바텀시트 */
  function sheet(html, onClose) {
    var back = document.createElement('div');
    back.className = 'sheet-back';
    back.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>' + html + '</div>';
    var closed = false;
    function close() { if (closed) return; closed = true; back.remove(); if (onClose) onClose(); }
    back.addEventListener('click', function (e) { if (e.target === back || e.target.closest('[data-close]')) close(); });
    document.body.appendChild(back);
    C.Photos.hydrate(back);
    return { el: back, close: close };
  }

  function assetCardHtml(a, extra) {
    return '<div class="asset-card">' + C.photoThumb(a.photo_url) + '<div class="grow"><div class="id">' + esc(a.asset_id) + '</div>' +
      '<div class="nm">' + esc(a.asset_name) + '</div><div class="small muted">' + esc([a.manufacturer, a.model].filter(Boolean).join(' · ')) + ' · ' + esc(catName(a.category)) + '</div>' +
      '<div style="margin-top:6px">' + C.statusBadge(a.current_status, a.overdue) + '</div>' + (extra || '') + '</div></div>';
  }

  function assetSheet(res, mode) {
    var a = res.asset;
    var cart = getCart();
    var inCart = cart.items.some(function (i) { return i.asset_id === a.asset_id; });
    var inRet = getRet().items.some(function (i) { return i.asset_id === a.asset_id; });
    var info = '';
    if (a.current_status === 'CHECKED_OUT') {
      info = '<dl class="kv" style="margin-top:12px"><dt>프로젝트</dt><dd>' + esc(res.project ? res.project.project_name : a.current_project_id) + '</dd>' +
        '<dt>담당자</dt><dd>' + esc(res.current_user ? res.current_user.name : '-') + '</dd><dt>반납 예정</dt><dd>' + esc(a.return_due_date) + '</dd></dl>';
    } else {
      info = '<dl class="kv" style="margin-top:12px"><dt>위치</dt><dd>' + esc(a.current_location || a.home_location || '-') + '</dd>' + (a.serial_number ? '<dt>시리얼</dt><dd class="mono">' + esc(a.serial_number) + '</dd>' : '') + '</dl>';
    }
    var actions = '';
    if (mode === 'out' && can('operate')) {
      if (inCart) actions = '<div class="notice info">' + icon('check') + '이미 바구니에 담긴 장비입니다.</div><button class="btn lg block" style="margin-top:10px" data-close>계속 스캔</button>';
      else if (res.can_checkout) actions = '<div class="notice good">' + icon('check') + '반출 가능</div>' +
        '<button class="btn primary lg block" style="margin-top:12px" id="add-cart">바구니에 담고 계속 스캔</button><button class="btn lg block" style="margin-top:8px" id="add-cart-go">담고 바구니 보기</button>';
      else actions = '<div class="notice bad">' + icon('x') + esc(res.block_reason || '반출할 수 없습니다.') + '</div>' +
        (res.can_return && !inRet ? '<button class="btn lg block" style="margin-top:10px" id="add-ret">반납 목록에 담기</button>' : '') +
        '<button class="btn lg block" style="margin-top:8px" data-close>다시 스캔</button>';
    } else if (mode === 'in' && can('operate')) {
      actions = inRet ? '<div class="notice info">' + icon('check') + '이미 반납 목록에 있습니다.</div>'
        : '<div class="notice bad">' + icon('x') + '반출 상태가 아니어서 반납할 수 없습니다.</div>';
      actions += '<button class="btn lg block" style="margin-top:10px" data-close>다시 스캔</button>';
    } else {
      actions = '<button class="btn lg block" style="margin-top:12px" data-close>닫기</button>';
    }
    var sh = sheet(assetCardHtml(a) + info + '<div style="margin-top:14px">' + actions + '</div>', resumeScanner);
    var b1 = C.$('#add-cart', sh.el), b2 = C.$('#add-cart-go', sh.el), b3 = C.$('#add-ret', sh.el);
    if (b1) b1.onclick = function () { addToCart([a]); sh.close(); C.toast('바구니에 담김 (' + getCart().items.length + '개)'); refreshScanHint(mode); };
    if (b2) b2.onclick = function () { addToCart([a]); sh.close(); go('#/cart'); };
    if (b3) b3.onclick = function () { addToReturn([a]); sh.close(); C.toast('반납 목록에 담김'); };
  }

  function setSheet(res, mode) {
    var rows = res.items.map(function (it, i) {
      var a = it.asset;
      var ok = mode === 'in' ? (a && a.current_status === 'CHECKED_OUT') : it.can_checkout;
      return '<label class="m-item"><input type="checkbox" data-i="' + i + '" ' + (ok && (it.required || mode === 'in') ? 'checked' : '') + ' ' + (ok ? '' : 'disabled') + ' style="width:22px;height:22px;accent-color:#111">' +
        '<div class="grow"><div class="t1">' + esc(a ? a.asset_name : it.asset_id) + (it.required ? ' <span class="badge b-yellow">필수</span>' : '') + '</div>' +
        '<div class="t2 mono">' + esc(it.asset_id) + '</div>' + (ok ? '' : '<div class="reason">' + esc(mode === 'in' ? '반출 중이 아님' : (it.block_reason || '불가')) + '</div>') + '</div>' +
        (a ? C.statusBadge(a.current_status, a.overdue) : '') + '</label>';
    }).join('');
    var sh = sheet('<div class="small muted">세트 · ' + esc(res.set_id) + '</div><div style="font-size:18px;font-weight:800;margin-bottom:6px">' + esc(res.set_name) + '</div>' +
      '<p class="small muted" style="margin:0 0 10px">출고 전 실제 구성품을 확인하고 체크하세요.</p><div class="m-list">' + rows + '</div>' +
      (can('operate') && mode !== 'view' ? '<button class="btn primary lg block" style="margin-top:12px" id="set-add">선택 구성품 담기</button>' : '') +
      '<button class="btn lg block" style="margin-top:8px" data-close>닫기</button>', resumeScanner);
    var b = C.$('#set-add', sh.el);
    if (b) b.onclick = function () {
      var picked = C.$$('input[data-i]:checked', sh.el).map(function (x) { return res.items[+x.getAttribute('data-i')].asset; });
      if (!picked.length) return C.toast('선택된 구성품이 없습니다.', 'err');
      var missingReq = res.items.filter(function (it, i) { return it.required && !C.$('input[data-i="' + i + '"]', sh.el).checked; });
      if (mode === 'in') addToReturn(picked); else addToCart(picked);
      sh.close();
      C.toast(picked.length + '개 담김' + (missingReq.length && mode !== 'in' ? ' · 필수 구성품 ' + missingReq.length + '개 제외됨' : ''), missingReq.length && mode !== 'in' ? 'err' : 'ok');
      refreshScanHint(mode);
    };
  }

  function slim(a) { return { asset_id: a.asset_id, asset_name: a.asset_name, model: a.model, category: a.category, photo_url: a.photo_url || '', project_id: a.current_project_id || '', due: a.return_due_date || '' }; }
  function addToCart(list) {
    var c = getCart();
    list.forEach(function (a) { if (!c.items.some(function (i) { return i.asset_id === a.asset_id; })) c.items.push(slim(a)); delete c.fails[a.asset_id]; });
    touchCart(c);
  }
  function addToReturn(list) {
    var r = getRet();
    list.forEach(function (a) {
      if (!r.items.some(function (i) { return i.asset_id === a.asset_id; })) {
        var s = slim(a); s.condition = 'OK'; s.notes = ''; s.photo_url_issue = '';
        r.items.push(s);
      }
    });
    touchRet(r);
  }

  // ---------------- 반출 바구니 ----------------
  function vCart(view) {
    if (!can('operate')) { view.innerHTML = '<div class="empty">반출 권한이 없는 계정입니다.</div>'; return; }
    var c = getCart();
    if (!c.due_date || c.due_date < C.todayStr()) c.due_date = C.addDays(C.todayStr(), parseInt(setting('DEFAULT_DUE_DAYS', '7'), 10) || 7);
    if (!c.receiver_user_id) c.receiver_user_id = S.user.user_id;
    C.Store.set(k('cart'), c);
    var p = projectById(c.project_id);
    var failCount = Object.keys(c.fails || {}).length;
    view.innerHTML = '<h2>반출 바구니</h2>' + projectChip(p) +
      (failCount ? '<div class="notice bad" style="margin-bottom:10px">' + icon('warn') + '<div class="grow">' + failCount + '개 장비는 반출할 수 없습니다.<div><button class="btn sm danger" id="drop-fails" style="margin-top:8px">불가 장비 빼기</button></div></div></div>' : '') +
      '<div class="m-group-title"><span>담긴 장비 ' + c.items.length + '개</span>' + (c.items.length ? '<button class="btn ghost sm" id="clear-cart">비우기</button>' : '') + '</div>' +
      (c.items.length ? '<div class="m-list">' + c.items.map(function (i) {
        var f = c.fails[i.asset_id];
        return '<div class="m-item' + (f ? ' fail' : '') + '">' + C.photoThumb(i.photo_url) + '<div class="grow"><div class="t1 ellipsis">' + esc(i.asset_name) + '</div><div class="t2 mono">' + esc(i.asset_id) + '</div>' +
          (f ? '<div class="reason">' + esc(f) + '</div>' : '') + '</div><button class="icon-btn" data-rm="' + esc(i.asset_id) + '" aria-label="빼기">' + icon('trash') + '</button></div>';
      }).join('') + '</div>' : '<div class="m-list"><div class="empty">QR을 스캔해서 장비를 담으세요.</div></div>') +
      '<a class="btn lg block" href="#/scan?mode=out" style="margin-top:10px">' + icon('scan') + ' 장비 스캔해서 추가</a>' +
      '<div class="card card-pad stack" style="margin-top:16px">' +
      '<div class="field"><label class="req" for="due">반납 예정일</label><input class="input" type="date" id="due" min="' + C.todayStr() + '" value="' + esc(c.due_date) + '"></div>' +
      '<div class="field"><label for="recv">담당자</label><select class="input" id="recv">' + S.boot.users.map(function (u) {
        return '<option value="' + esc(u.user_id) + '"' + (u.user_id === c.receiver_user_id ? ' selected' : '') + '>' + esc(u.name) + (u.department ? ' (' + esc(u.department) + ')' : '') + (u.user_id === S.user.user_id ? ' · 나' : '') + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label for="memo">메모</label><input class="input" id="memo" maxlength="300" placeholder="선택 입력" value="' + esc(c.notes || '') + '"></div></div>' +
      '<div class="m-actionbar"><button class="btn primary lg block" id="submit-out" ' + (c.items.length ? '' : 'disabled') + '>' + c.items.length + '개 반출 확정</button></div>';
    C.Photos.hydrate(view);
    C.$('#project-chip', view).onclick = function () { pickProject(function () { route(); }); };
    C.$$('[data-rm]', view).forEach(function (b) {
      b.onclick = function () { var x = getCart(); var id = b.getAttribute('data-rm'); x.items = x.items.filter(function (i) { return i.asset_id !== id; }); delete x.fails[id]; touchCart(x); route(); };
    });
    var cl = C.$('#clear-cart', view);
    if (cl) cl.onclick = function () { C.confirmDialog('바구니 비우기', '담긴 장비를 모두 뺄까요?', '비우기', 'danger').then(function (ok) { if (ok) { var x = getCart(); x.items = []; x.fails = {}; touchCart(x); route(); } }); };
    var df = C.$('#drop-fails', view);
    if (df) df.onclick = function () { var x = getCart(); x.items = x.items.filter(function (i) { return !x.fails[i.asset_id]; }); x.fails = {}; touchCart(x); route(); };
    ['due', 'recv', 'memo'].forEach(function (id) {
      C.$('#' + id, view).onchange = function () {
        var x = getCart();
        x.due_date = C.$('#due').value; x.receiver_user_id = C.$('#recv').value; x.notes = C.$('#memo').value;
        touchCart(x);
      };
    });
    C.$('#submit-out', view).onclick = function () { submitCheckout(this); };
  }

  function submitCheckout(btn) {
    var c = getCart();
    c.due_date = C.$('#due').value; c.receiver_user_id = C.$('#recv').value; c.notes = C.$('#memo').value;
    if (!c.project_id) return C.toast('프로젝트를 선택하세요.', 'err');
    if (!c.items.length) return C.toast('반출할 장비가 없습니다.', 'err');
    if (!c.due_date || c.due_date < C.todayStr()) return C.toast('반납 예정일을 확인하세요.', 'err');
    var p = projectById(c.project_id);
    C.confirmDialog('반출 확정', '<dl class="kv"><dt>프로젝트</dt><dd>' + esc(p ? p.project_name : c.project_id) + '</dd><dt>장비</dt><dd><b>' + c.items.length + '개</b></dd>' +
      '<dt>반납 예정</dt><dd>' + esc(c.due_date) + '</dd><dt>담당자</dt><dd>' + esc(userName(c.receiver_user_id)) + '</dd><dt>처리자</dt><dd>' + esc(S.user.name) + ' (자동 기록)</dd></dl>', '반출 확정').then(function (ok) {
      if (!ok) return;
      if (!c.request_id) c.request_id = C.uuid();
      C.Store.set(k('cart'), c); // 같은 request_id 로 재시도 가능하게 먼저 저장
      C.busy(btn, true);
      Api.call('tx.checkout', {
        request_id: c.request_id, project_id: c.project_id, receiver_user_id: c.receiver_user_id,
        due_date: c.due_date, notes: c.notes, asset_ids: c.items.map(function (i) { return i.asset_id; })
      }).then(function (d) {
        S.lastDone = { kind: 'out', data: d, items: c.items.slice(), project: p };
        var x = getCart(); x.items = []; x.fails = {}; x.notes = ''; touchCart(x);
        S.assets = null;
        vibrate([40, 60, 40]);
        go('#/done');
      }).catch(function (e) {
        C.busy(btn, false);
        if (e.code === 'PARTIAL_INVALID' && e.details && e.details.results) {
          var x = getCart(); x.fails = {};
          e.details.results.forEach(function (r) { if (!r.ok) x.fails[r.asset_id] = r.reason; });
          touchCart(x);
          C.toast(e.message, 'err');
          route();
        } else C.showError(e);
      });
    });
  }

  // ---------------- 반납 ----------------
  function vReturn(view, r) {
    if (!can('operate')) { view.innerHTML = '<div class="empty">반납 권한이 없는 계정입니다.</div>'; return; }
    var tab = r.q.tab || 'list';
    view.innerHTML = '<h2>반납</h2><div class="mode-toggle"><button data-tab="list" class="' + (tab === 'list' ? 'on' : '') + '">반납 목록 (' + getRet().items.length + ')</button><button data-tab="pick" class="' + (tab === 'pick' ? 'on' : '') + '">반출 중 장비에서 선택</button></div><div id="ret-body"></div>';
    C.$$('[data-tab]', view).forEach(function (b) { b.onclick = function () { go('#/return?tab=' + b.getAttribute('data-tab')); }; });
    if (tab === 'pick') retPick(C.$('#ret-body'), r.q.project || '');
    else retList(C.$('#ret-body'));
  }

  function retList(box) {
    var rt = getRet();
    var requirePhoto = String(setting('REQUIRE_PHOTO_ON_ISSUE', 'TRUE')).toUpperCase() === 'TRUE';
    if (!rt.items.length) {
      box.innerHTML = '<div class="m-list"><div class="empty">반납할 장비가 없습니다.<br>QR 스캔 또는 "반출 중 장비에서 선택"으로 담으세요.</div></div>' +
        '<a class="btn lg block primary" href="#/scan?mode=in" style="margin-top:12px">' + icon('scan') + ' 반납 스캔</a>';
      return;
    }
    var fails = rt.fails || {};
    box.innerHTML = rt.items.map(function (i, idx) {
      var issue = i.condition === 'ISSUE';
      return '<div class="ret-item' + (issue ? ' issue' : '') + '" data-idx="' + idx + '"><div class="row">' + C.photoThumb(i.photo_url) + '<div class="grow"><div class="t1" style="font-weight:700">' + esc(i.asset_name) + '</div>' +
        '<div class="small muted mono">' + esc(i.asset_id) + (i.project_id ? ' · ' + esc(i.project_id) : '') + '</div>' + (fails[i.asset_id] ? '<div class="small" style="color:var(--st-danger);font-weight:600">' + esc(fails[i.asset_id]) + '</div>' : '') + '</div>' +
        '<button class="icon-btn" data-rm aria-label="빼기">' + icon('trash') + '</button></div>' +
        '<div class="cond-toggle"><button data-c="OK" class="' + (!issue ? 'on-ok' : '') + '">' + '정상</button><button data-c="ISSUE" class="' + (issue ? 'on-issue' : '') + '">이상 있음</button></div>' +
        (issue ? '<div class="stack" style="margin-top:10px;gap:8px"><textarea class="input" data-notes placeholder="이상 내용을 적어 주세요 (필수)" maxlength="500">' + esc(i.notes) + '</textarea>' +
          '<div class="photo-pick">' + (i.photo_url_issue ? '<img data-photo="' + esc(i.photo_url_issue) + '" alt="첨부 사진">' : '') +
          '<label class="btn">' + icon('camera') + (i.photo_url_issue ? ' 다시 찍기' : ' 사진 첨부' + (requirePhoto ? ' (필수)' : '')) + '<input type="file" accept="image/*" capture="environment" class="sr-only" data-photo-in></label></div>' +
          '<div class="small" style="color:var(--st-inspect)">이상 장비는 반납 후 "점검" 상태로 전환됩니다.</div></div>' : '') + '</div>';
    }).join('') +
      '<a class="btn block" href="#/scan?mode=in" style="min-height:44px">' + icon('scan') + ' 더 스캔하기</a>' +
      '<div class="m-actionbar"><button class="btn primary lg block" id="submit-ret">' + rt.items.length + '개 반납 처리</button></div>';
    C.Photos.hydrate(box);
    C.$$('.ret-item', box).forEach(function (el) {
      var idx = +el.getAttribute('data-idx');
      C.$('[data-rm]', el).onclick = function () { var x = getRet(); x.items.splice(idx, 1); touchRet(x); route(); };
      C.$$('[data-c]', el).forEach(function (b) { b.onclick = function () { var x = getRet(); x.items[idx].condition = b.getAttribute('data-c'); touchRet(x); route(); }; });
      var ta = C.$('[data-notes]', el);
      if (ta) ta.oninput = C.debounce(function () { var x = getRet(); x.items[idx].notes = ta.value; touchRet(x); }, 250);
      var pin = C.$('[data-photo-in]', el);
      if (pin) pin.onchange = function (e) {
        var f = e.target.files[0]; if (!f) return;
        var lbl = pin.parentNode; C.busy(lbl, true);
        C.Photos.upload(f, 'return', getRet().items[idx].asset_id).then(function (url) {
          var x = getRet(); x.items[idx].photo_url_issue = url; touchRet(x); route();
        }).catch(function (err) { C.busy(lbl, false); C.showError(err); });
      };
    });
    C.$('#submit-ret', box).onclick = function () { submitReturn(this, requirePhoto); };
  }

  function submitReturn(btn, requirePhoto) {
    var rt = getRet();
    var bad = rt.items.filter(function (i) { return i.condition === 'ISSUE' && (!String(i.notes || '').trim() || (requirePhoto && !i.photo_url_issue)); });
    if (bad.length) return C.toast('이상 장비는 메모' + (requirePhoto ? '와 사진' : '') + '이 필요합니다: ' + bad.map(function (b) { return b.asset_id; }).join(', '), 'err');
    var issues = rt.items.filter(function (i) { return i.condition === 'ISSUE'; }).length;
    C.confirmDialog('반납 처리', '<dl class="kv"><dt>반납 장비</dt><dd><b>' + rt.items.length + '개</b></dd><dt>정상</dt><dd>' + (rt.items.length - issues) + '개</dd><dt>이상(점검 전환)</dt><dd>' + issues + '개</dd><dt>처리자</dt><dd>' + esc(S.user.name) + ' (자동 기록)</dd></dl>', '반납 처리').then(function (ok) {
      if (!ok) return;
      if (!rt.request_id) rt.request_id = C.uuid();
      C.Store.set(k('ret'), rt);
      C.busy(btn, true);
      Api.call('tx.return', {
        request_id: rt.request_id,
        items: rt.items.map(function (i) { return { asset_id: i.asset_id, condition: i.condition, notes: i.notes, photo_url: i.condition === 'ISSUE' ? i.photo_url_issue : '' }; })
      }).then(function (d) {
        S.lastDone = { kind: 'in', data: d, items: rt.items.slice() };
        saveRet({ items: [], request_id: null, fails: {} });
        S.assets = null;
        vibrate([40, 60, 40]);
        go('#/done');
      }).catch(function (e) {
        C.busy(btn, false);
        if (e.code === 'PARTIAL_INVALID' && e.details && e.details.results) {
          var x = getRet(); x.fails = {};
          e.details.results.forEach(function (r) { if (!r.ok) x.fails[r.asset_id] = r.reason; });
          touchRet(x);
          C.toast(e.message + ' 표시된 장비를 빼고 다시 시도하세요.', 'err');
          route();
        } else C.showError(e);
      });
    });
  }

  function retPick(box, projectFilter) {
    box.innerHTML = '<div class="loading-block"><span class="spin"></span>반출 중 장비 불러오는 중</div>';
    loadAssets(true).then(function (assets) {
      var out = assets.filter(function (a) { return a.current_status === 'CHECKED_OUT'; });
      var inRet = {};
      getRet().items.forEach(function (i) { inRet[i.asset_id] = true; });
      var projects = {};
      out.forEach(function (a) { projects[a.current_project_id] = (projects[a.current_project_id] || 0) + 1; });
      var filter = projectFilter || 'mine';
      function render() {
        var list = out.filter(function (a) { return filter === 'all' ? true : filter === 'mine' ? a.current_user_id === S.user.user_id : a.current_project_id === filter; });
        var byP = {};
        list.forEach(function (a) { (byP[a.current_project_id] = byP[a.current_project_id] || []).push(a); });
        box.innerHTML = '<div class="seg"><button data-f="mine" class="' + (filter === 'mine' ? 'on' : '') + '">내 담당</button><button data-f="all" class="' + (filter === 'all' ? 'on' : '') + '">전체</button>' +
          Object.keys(projects).map(function (pid) { var p = projectById(pid); return '<button data-f="' + esc(pid) + '" class="' + (filter === pid ? 'on' : '') + '">' + esc(p ? p.project_name : pid) + ' ' + projects[pid] + '</button>'; }).join('') + '</div>' +
          (list.length ? Object.keys(byP).map(function (pid) {
            var p = projectById(pid);
            return '<div class="m-group-title"><span>' + esc(p ? p.project_name : pid) + ' · ' + byP[pid].length + '개</span><button class="btn ghost sm" data-all="' + esc(pid) + '">전체 선택</button></div><div class="m-list">' +
              byP[pid].map(function (a) {
                var dl = C.daysLeft(a.return_due_date);
                return '<label class="m-item"><input type="checkbox" data-id="' + esc(a.asset_id) + '" data-p="' + esc(pid) + '" ' + (inRet[a.asset_id] ? 'checked disabled' : '') + ' style="width:22px;height:22px;accent-color:#111">' +
                  '<div class="grow"><div class="t1 ellipsis">' + esc(a.asset_name) + '</div><div class="t2"><span class="mono">' + esc(a.asset_id) + '</span> · ' + esc(userName(a.current_user_id)) + '</div></div>' +
                  '<span class="due-pill ' + (a.overdue ? 'late' : dl !== null && dl <= 2 ? 'soon' : '') + '">' + (a.overdue ? '지연 ' + (-dl) + '일' : 'D-' + dl) + '</span></label>';
              }).join('') + '</div>';
          }).join('') : '<div class="m-list"><div class="empty">해당하는 반출 장비가 없습니다.</div></div>') +
          '<div class="m-actionbar"><button class="btn dark lg block" id="pick-add">선택 장비 반납 목록에 담기</button></div>';
        C.$$('[data-f]', box).forEach(function (b) { b.onclick = function () { filter = b.getAttribute('data-f'); render(); }; });
        C.$$('[data-all]', box).forEach(function (b) {
          b.onclick = function (e) { e.preventDefault(); var pid = b.getAttribute('data-all'); C.$$('input[data-p="' + pid + '"]:not(:disabled)', box).forEach(function (x) { x.checked = true; }); updateCount(); };
        });
        function updateCount() {
          var n = C.$$('input[data-id]:checked:not(:disabled)', box).length;
          C.$('#pick-add', box).textContent = n ? '선택 ' + n + '개 반납 목록에 담기' : '선택 장비 반납 목록에 담기';
        }
        C.$$('input[data-id]', box).forEach(function (x) { x.onchange = updateCount; });
        C.$('#pick-add', box).onclick = function () {
          var ids = C.$$('input[data-id]:checked:not(:disabled)', box).map(function (x) { return x.getAttribute('data-id'); });
          if (!ids.length) return C.toast('선택된 장비가 없습니다.', 'err');
          addToReturn(out.filter(function (a) { return ids.indexOf(a.asset_id) >= 0; }));
          C.toast(ids.length + '개 담김');
          go('#/return?tab=list');
        };
      }
      render();
    }).catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  // ---------------- 내 반출 목록 ----------------
  function vMine(view) {
    view.innerHTML = '<h2>내 반출 목록</h2><div id="mine-body"><div class="loading-block"><span class="spin"></span>불러오는 중</div></div>';
    Api.call('me.holdings', {}).then(function (d) {
      var box = C.$('#mine-body');
      if (!box) return;
      if (!d.assets.length) { box.innerHTML = '<div class="m-list"><div class="empty">현재 내 담당으로 반출된 장비가 없습니다.</div></div>'; return; }
      var byP = {};
      d.assets.forEach(function (a) { (byP[a.current_project_id] = byP[a.current_project_id] || []).push(a); });
      box.innerHTML = Object.keys(byP).map(function (pid) {
        var l = byP[pid];
        return '<div class="m-group-title"><span>' + esc(l[0].project_name || pid) + ' · ' + l.length + '개</span>' + (can('operate') ? '<button class="btn ghost sm" data-retall="' + esc(pid) + '">모두 반납 목록에</button>' : '') + '</div><div class="m-list">' +
          l.map(function (a) {
            var dl = C.daysLeft(a.return_due_date);
            return '<div class="m-item clickable" data-id="' + esc(a.asset_id) + '">' + C.photoThumb(a.photo_url) + '<div class="grow"><div class="t1 ellipsis">' + esc(a.asset_name) + '</div><div class="t2"><span class="mono">' + esc(a.asset_id) + '</span> · 반납 ' + esc(a.return_due_date) + '</div></div>' +
              '<span class="due-pill ' + (a.overdue ? 'late' : dl <= 2 ? 'soon' : '') + '">' + (a.overdue ? '지연 ' + (-dl) + '일' : 'D-' + dl) + '</span></div>';
          }).join('') + '</div>';
      }).join('');
      C.Photos.hydrate(box);
      C.$$('[data-retall]', box).forEach(function (b) {
        b.onclick = function () { addToReturn(byP[b.getAttribute('data-retall')]); C.toast(byP[b.getAttribute('data-retall')].length + '개 반납 목록에 담김'); };
      });
      C.$$('.m-item[data-id]', box).forEach(function (el) { el.onclick = function () { lookupSheet(el.getAttribute('data-id')); }; });
    }).catch(function (e) { var box = C.$('#mine-body'); if (box) box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function lookupSheet(id) {
    Api.call('assets.lookup', { code: id }).then(function (res) {
      var a = res.asset;
      var mode = a.current_status === 'CHECKED_OUT' ? 'in' : 'out';
      if (mode === 'in' && res.can_return) {
        var inRet = getRet().items.some(function (i) { return i.asset_id === a.asset_id; });
        var sh = sheet(assetCardHtml(a) + '<dl class="kv" style="margin-top:12px"><dt>프로젝트</dt><dd>' + esc(res.project ? res.project.project_name : '') + '</dd><dt>담당자</dt><dd>' + esc(res.current_user ? res.current_user.name : '') + '</dd><dt>반납 예정</dt><dd>' + esc(a.return_due_date) + '</dd></dl>' +
          (inRet ? '<div class="notice info" style="margin-top:12px">' + icon('check') + '반납 목록에 있습니다.</div>' : '<button class="btn primary lg block" style="margin-top:14px" id="lk-ret">반납 목록에 담기</button>') +
          '<button class="btn lg block" style="margin-top:8px" data-close>닫기</button>');
        var b = C.$('#lk-ret', sh.el);
        if (b) b.onclick = function () { addToReturn([a]); sh.close(); C.toast('반납 목록에 담김'); };
      } else assetSheet(res, can('operate') ? 'out' : 'view');
    }).catch(C.showError);
  }

  // ---------------- 검색 ----------------
  function vSearch(view) {
    view.innerHTML = '<h2>장비 검색</h2><input class="input" id="sq" placeholder="관리번호 · 장비명 · 모델 · 시리얼" style="min-height:48px" autocomplete="off">' +
      '<div class="seg" style="margin-top:10px" id="sf"><button data-s="" class="on">전체</button><button data-s="AVAILABLE">보유</button><button data-s="CHECKED_OUT">반출</button><button data-s="INSPECTION">점검</button></div>' +
      '<div id="sres"><div class="loading-block"><span class="spin"></span>장비 목록 불러오는 중</div></div>';
    var st = '';
    loadAssets(false).then(function (assets) {
      function render() {
        var q = C.$('#sq').value.trim().toLowerCase();
        var list = assets.filter(function (a) {
          if (st && a.current_status !== st) return false;
          return !q || (a.asset_id + ' ' + a.asset_name + ' ' + a.model + ' ' + a.manufacturer + ' ' + a.serial_number).toLowerCase().indexOf(q) >= 0;
        });
        var box = C.$('#sres');
        box.innerHTML = '<div class="m-group-title"><span>' + list.length + '개</span></div>' + (list.length ? '<div class="m-list">' + list.slice(0, 60).map(function (a) {
          return '<div class="m-item clickable" data-id="' + esc(a.asset_id) + '">' + C.photoThumb(a.photo_url) + '<div class="grow"><div class="t1 ellipsis">' + esc(a.asset_name) + '</div><div class="t2"><span class="mono">' + esc(a.asset_id) + '</span> · ' + esc(a.model || '') + '</div></div>' + C.statusBadge(a.current_status, a.overdue) + '</div>';
        }).join('') + '</div>' + (list.length > 60 ? '<p class="small muted" style="text-align:center">상위 60개만 표시 — 검색어를 더 입력하세요</p>' : '') : '<div class="m-list"><div class="empty">검색 결과가 없습니다.</div></div>');
        C.Photos.hydrate(box);
        C.$$('[data-id]', box).forEach(function (el) { el.onclick = function () { lookupSheet(el.getAttribute('data-id')); }; });
      }
      C.$('#sq').oninput = C.debounce(render, 120);
      C.$$('[data-s]').forEach(function (b) { b.onclick = function () { st = b.getAttribute('data-s'); C.$$('[data-s]').forEach(function (x) { x.classList.toggle('on', x === b); }); render(); }; });
      render();
      C.$('#sq').focus();
    }).catch(function (e) { C.$('#sres').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  // ---------------- 완료 ----------------
  function vDone(view) {
    var d = S.lastDone;
    if (!d) return go('#/home');
    var out = d.kind === 'out';
    var res = d.data.results || [];
    var ok = res.filter(function (r) { return r.ok; });
    var names = {};
    d.items.forEach(function (i) { names[i.asset_id] = i.asset_name; });
    view.innerHTML = '<div class="done-hero"><div class="circle">' + icon('check') + '</div><h2>' + (out ? '반출 완료' : '반납 완료') + '</h2>' +
      '<p class="muted">' + ok.length + '개 장비가 ' + (out ? '반출' : '반납') + ' 처리되어 기록되었습니다.' + (d.data.duplicate ? ' (이미 처리된 요청 — 중복 반영 없음)' : '') + '</p></div>' +
      (out ? '<div class="card card-pad"><dl class="kv"><dt>프로젝트</dt><dd>' + esc(d.data.project_name || '') + '</dd><dt>반납 예정</dt><dd>' + esc(d.data.due_date || '') + '</dd><dt>담당자</dt><dd>' + esc(d.data.receiver ? d.data.receiver.name : '') + '</dd><dt>처리 번호</dt><dd class="mono">' + esc(d.data.checkout_group_id || '') + '</dd></dl></div>' : '') +
      '<div class="m-group-title"><span>처리된 장비</span></div><div class="m-list">' + ok.map(function (r) {
        return '<div class="m-item"><div class="grow"><div class="t1">' + esc(names[r.asset_id] || r.asset_id) + '</div><div class="t2 mono">' + esc(r.asset_id) + ' · ' + esc(r.transaction_id || '') + '</div></div>' +
          (r.condition === 'ISSUE' ? '<span class="badge b-inspect">' + icon('warn') + '점검 전환</span>' : '<span class="badge b-available">' + icon('check') + '완료</span>') + '</div>';
      }).join('') + '</div>' +
      '<div class="stack" style="margin-top:16px"><a class="btn primary lg block" href="#/scan?mode=' + (out ? 'out' : 'in') + '">계속 스캔</a><a class="btn lg block" href="#/home">홈으로</a></div>';
  }

  // ---------------- 내 계정 ----------------
  function meSheet() {
    var sh = sheet('<div class="row"><div class="icon-circle" style="width:44px;height:44px;border-radius:50%;background:var(--yellow-soft);display:flex;align-items:center;justify-content:center">' + icon('user') + '</div>' +
      '<div class="grow"><div style="font-weight:800;font-size:16px">' + esc(S.user.name) + '</div><div class="small muted">' + esc(S.user.email) + '</div></div><span class="badge b-yellow">' + esc(C.ROLE_LABEL[S.user.role]) + '</span></div>' +
      '<div class="stack" style="margin-top:16px">' + (can('manage') ? '<a class="btn lg block" href="admin.html">' + icon('grid') + ' PC 관리자 화면</a>' : '') +
      '<button class="btn lg block" id="refresh-boot">' + icon('history') + ' 프로젝트/설정 새로고침</button>' +
      '<button class="btn lg block danger" id="logout">' + icon('logout') + ' 로그아웃</button><button class="btn lg block ghost" data-close>닫기</button></div>');
    C.$('#logout', sh.el).onclick = function () { C.Auth.signOut(); };
    C.$('#refresh-boot', sh.el).onclick = function () { sh.close(); start(); };
  }

  boot();
})();
