/* C2 EQUIPMENT MANAGER — 공통 클라이언트 코어 (인증 · API · UI 유틸)
 * 이 파일에는 비밀값이 없다. GOOGLE_CLIENT_ID 는 공개 식별자다.
 */
(function (global) {
  'use strict';
  var CFG = global.C2EM_CONFIG || {};
  var LS_TOKEN = 'c2em.idToken';

  // ---------------- 저장소 (실패해도 동작) ----------------
  var Store = {
    get: function (k, def) { try { var v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* noop */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }
  };

  // ---------------- 유틸 ----------------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function todayStr() {
    var d = new Date(Date.now() + 9 * 3600 * 1000); // KST
    return d.toISOString().slice(0, 10);
  }
  function addDays(dateStr, n) {
    var p = dateStr.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000).toISOString().slice(0, 10);
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    var s = String(iso);
    return s.slice(0, 10) + ' ' + s.slice(11, 16);
  }
  function fmtDate(s) { return s ? String(s).slice(0, 10) : ''; }
  function daysLeft(due) {
    if (!due) return null;
    var t = todayStr();
    return Math.round((Date.parse(due) - Date.parse(t)) / 86400000);
  }
  function fmtWon(n) { return n === '' || n === null || n === undefined ? '' : Number(n).toLocaleString('ko-KR') + '원'; }
  function debounce(fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ---------------- 아이콘 ----------------
  var ICON_PATHS = {
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    out: '<path d="M7 17L17 7M9 7h8v8"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>',
    tool: '<path d="M14.5 6.5a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.1-5.1a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17v.5"/>',
    minus: '<path d="M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    cart: '<path d="M3 4h2l2.2 10.5a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6"/><circle cx="9" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
    ret: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-8 8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
    folder: '<path d="M4 6h6l2 2h8v11H4z"/>',
    layers: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5"/><path d="M12 8v4l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    printer: '<path d="M7 9V4h10v5M7 17H5v-7h14v7h-2"/><rect x="7" y="14" width="10" height="6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
  }

  // ---------------- 상태 ----------------
  var STATUS_META = {
    AVAILABLE: { label: '보유', cls: 'b-available', icon: 'check' },
    CHECKED_OUT: { label: '반출', cls: 'b-out', icon: 'out' },
    INSPECTION: { label: '점검', cls: 'b-inspect', icon: 'warn' },
    REPAIR: { label: '수리', cls: 'b-inspect', icon: 'tool' },
    DAMAGED: { label: '파손', cls: 'b-danger', icon: 'x' },
    LOST: { label: '분실', cls: 'b-danger', icon: 'question' },
    RETIRED: { label: '폐기', cls: 'b-gray', icon: 'minus' }
  };
  function statusBadge(status, overdue) {
    var m = STATUS_META[status] || { label: status || '-', cls: 'b-gray', icon: 'minus' };
    var html = '<span class="badge ' + m.cls + '">' + icon(m.icon) + m.label + '</span>';
    if (overdue) html += ' <span class="badge b-danger">' + icon('clock') + '지연</span>';
    return html;
  }
  var ACTION_LABEL = {
    REGISTER: '등록', CHECKOUT: '반출', RETURN: '반납', TRANSFER: '이관', INSPECT: '점검', REPAIR: '수리',
    LOST: '분실', RETIRE: '폐기', CORRECTION: '정정', EDIT: '정보수정'
  };
  var PROJECT_STATUS = { PLANNED: '준비', ACTIVE: '진행', DONE: '완료', CANCELLED: '취소' };
  var ROLE_LABEL = { ADMIN: '관리자', MANAGER: '매니저', STAFF: '직원', VIEWER: '조회' };

  // ---------------- 토스트 / 모달 ----------------
  function toast(msg, type, ms) {
    var box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'toast ' + (type || 'ok');
    t.innerHTML = '<div>' + esc(msg) + '</div>';
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || (type === 'err' ? 5000 : 2600));
  }

  /** modal({title, body: html|Node, actions:[{label, cls, onClick(close) → false 면 유지}], wide, onClose}) */
  function modal(o) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><h2>' + esc(o.title || '') + '</h2><button class="btn ghost sm" data-x aria-label="닫기">' + icon('x') + '</button></div>' +
      '<div class="modal-body"></div><div class="modal-foot"></div></div>';
    var body = back.querySelector('.modal-body');
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    var foot = back.querySelector('.modal-foot');
    var closed = false;
    function close() { if (closed) return; closed = true; back.remove(); document.removeEventListener('keydown', onKey); if (o.onClose) o.onClose(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    (o.actions || [{ label: '닫기' }]).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn ' + (a.cls || '');
      b.textContent = a.label;
      b.addEventListener('click', function () {
        if (!a.onClick) return close();
        var r = a.onClick(close, b, body);
        if (r && typeof r.then === 'function') {
          busy(b, true);
          r.then(function (v) { busy(b, false); if (v !== false) close(); }, function (err) { busy(b, false); showError(err); });
        } else if (r !== false) close();
      });
      foot.appendChild(b);
    });
    if (!o.actions && o.noFoot) foot.remove();
    back.querySelector('[data-x]').addEventListener('click', close);
    back.addEventListener('mousedown', function (e) { if (e.target === back && !o.sticky) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    var first = body.querySelector('input,select,textarea');
    if (first && !o.noFocus) setTimeout(function () { first.focus(); }, 30);
    return { close: close, el: back, body: body };
  }
  function confirmDialog(title, html, okLabel, cls) {
    return new Promise(function (resolve) {
      modal({
        title: title, body: html, onClose: function () { resolve(false); },
        actions: [{ label: '취소' }, { label: okLabel || '확인', cls: cls || 'primary', onClick: function (close) { resolve(true); close(); } }]
      });
    });
  }
  function busy(btn, on) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + esc(btn.textContent); }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }
  function showError(err) {
    var msg = (err && err.message) || String(err);
    toast(msg, 'err');
  }

  // ---------------- 인증 (Google Identity Services) ----------------
  function decodeJwtPayload(t) {
    try {
      var p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      return JSON.parse(decodeURIComponent(Array.prototype.map.call(atob(p), function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')));
    } catch (e) { return null; }
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.onload = res; s.onerror = function () { rej(new Error('스크립트를 불러오지 못했습니다: ' + src)); };
      document.head.appendChild(s);
    });
  }

  var Auth = {
    token: null,
    payload: null,
    _waiters: [],
    /** 저장된 토큰 (서버가 매번 검증하므로 여기서는 만료 여부만 확인) */
    restore: function () {
      var t = Store.get(LS_TOKEN, null);
      var p = t ? decodeJwtPayload(t) : null;
      if (p && p.exp * 1000 > Date.now() + 60000) { this.token = t; this.payload = p; return true; }
      Store.del(LS_TOKEN);
      return false;
    },
    valid: function () { return !!(this.token && this.payload && this.payload.exp * 1000 > Date.now() + 30000); },
    setCredential: function (cred) {
      var p = decodeJwtPayload(cred);
      if (!p) return;
      this.token = cred; this.payload = p;
      Store.set(LS_TOKEN, cred);
      var w = this._waiters; this._waiters = [];
      w.forEach(function (fn) { fn(cred); });
    },
    clear: function () { this.token = null; this.payload = null; Store.del(LS_TOKEN); },
    signOut: function () {
      this.clear();
      try { if (global.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) { /* noop */ }
      location.reload();
    },
    /** 로그인 버튼 렌더링 */
    renderButton: function (container) {
      var self = this;
      container.innerHTML = '<div class="gbtn"><div class="loading-block" style="padding:8px"><span class="spin"></span>로그인 준비 중</div></div>';
      var gbtn = container.querySelector('.gbtn');
      if (CFG.DEV_LOGIN_SCRIPT) {
        return loadScript(CFG.DEV_LOGIN_SCRIPT).then(function () {
          gbtn.innerHTML = '';
          global.C2EM_DEV_LOGIN.render(container, function (cred) { self.setCredential(cred); });
        });
      }
      if (!CFG.GOOGLE_CLIENT_ID || /^REPLACE/.test(CFG.GOOGLE_CLIENT_ID)) {
        gbtn.innerHTML = '<p style="color:#F5B618">config.js 에 GOOGLE_CLIENT_ID 가 설정되지 않았습니다.</p>';
        return Promise.resolve();
      }
      return loadScript('https://accounts.google.com/gsi/client').then(function () {
        google.accounts.id.initialize({
          client_id: CFG.GOOGLE_CLIENT_ID,
          callback: function (r) { if (r && r.credential) self.setCredential(r.credential); },
          auto_select: true,
          cancel_on_tap_outside: false,
          use_fedcm_for_prompt: true,
          itp_support: true,
          context: 'signin'
        });
        gbtn.innerHTML = '';
        google.accounts.id.renderButton(gbtn, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ko', width: 280 });
        try { google.accounts.id.prompt(); } catch (e) { /* One Tap 불가 환경 — 버튼으로 로그인 */ }
      }).catch(function (e) {
        gbtn.innerHTML = '<p style="color:#F5B618">Google 로그인 스크립트를 불러오지 못했습니다. 네트워크를 확인해 주세요.</p>';
      });
    },
    /** 토큰이 필요할 때 — 만료됐으면 로그인 오버레이를 띄우고 새 토큰을 기다린다 */
    ensure: function () {
      if (this.valid()) return Promise.resolve(this.token);
      var self = this;
      return new Promise(function (resolve) {
        self._waiters.push(resolve);
        self.showOverlay();
      });
    },
    showOverlay: function () {
      if ($('#login-overlay')) return;
      var ov = document.createElement('div');
      ov.id = 'login-overlay';
      ov.style.cssText = 'position:fixed;inset:0;z-index:1500';
      ov.innerHTML = loginScreenHtml('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      document.body.appendChild(ov);
      this.renderButton(ov.querySelector('[data-login]'));
      this._waiters.push(function () { ov.remove(); });
    }
  };

  function loginScreenHtml(msg) {
    return '<div class="login-screen">' +
      '<img class="logo" src="logo-h-yellow.png" alt="C2 ARTECHNOLOZY">' +
      '<h1>EQUIPMENT MANAGER</h1>' +
      '<div class="login-card"><p>' + esc(msg || '회사에 등록된 Google 계정으로 로그인하세요.') + '</p><div data-login style="width:100%"></div>' +
      '<p class="small" style="color:#888">관리자 승인 후 사용할 수 있습니다.</p></div></div>';
  }

  // ---------------- API ----------------
  function ApiError(code, message, details) {
    var e = new Error(message); e.code = code; e.details = details; return e;
  }
  var NETWORK_RETRY = 2;

  function postOnce(body, timeoutMs) {
    var ctrl = global.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    return fetch(CFG.API_URL, {
      method: 'POST', body: body, redirect: 'follow', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw ApiError('NETWORK', '서버 응답 오류 (' + r.status + ')');
      return r.text();
    }).then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw ApiError('NETWORK', '서버 응답을 해석하지 못했습니다.'); }
    }, function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.code) throw e;
      throw ApiError('NETWORK', e && e.name === 'AbortError' ? '응답 시간이 초과되었습니다.' : '네트워크 연결을 확인해 주세요.');
    });
  }

  /**
   * Api.call(action, payload) — 네트워크 오류/시간초과는 같은 본문(같은 request_id)으로 재시도한다.
   * 서버가 request_id 로 중복을 막으므로 재시도해도 이력이 중복되지 않는다.
   */
  var Api = {
    onAuthState: null,
    call: function (action, payload, opts) {
      opts = opts || {};
      var attempt = 0;
      var reauthed = false;
      function run() {
        return Auth.ensure().then(function (tok) {
          var body = JSON.stringify({ action: action, payload: payload || {}, idToken: tok });
          return postOnce(body, opts.timeout || 60000);
        }).then(function (res) {
          if (res.ok) return res.data;
          var err = ApiError(res.error.code, res.error.message, res.error.details);
          if (err.code === 'UNAUTHENTICATED' && !reauthed) {
            reauthed = true;
            Auth.clear();
            return run();
          }
          if ((err.code === 'NOT_APPROVED' || err.code === 'FORBIDDEN') && Api.onAuthState) Api.onAuthState(err);
          throw err;
        }, function (err) {
          if (err.code === 'NETWORK' && attempt < NETWORK_RETRY && !opts.noRetry) {
            attempt++;
            return new Promise(function (r) { setTimeout(r, 800 * attempt); }).then(run);
          }
          throw err;
        });
      }
      return run();
    }
  };

  // ---------------- 사진 ----------------
  function readImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, maxSide / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다.')); };
      img.src = url;
    });
  }
  var Photos = {
    cache: {},
    queue: {},
    timer: null,
    /** 파일 → 압축 → 업로드 → photo_url */
    upload: function (file, kind, ref) {
      if (!file || !/^image\//.test(file.type)) return Promise.reject(new Error('이미지 파일을 선택해 주세요.'));
      return Promise.all([readImage(file, 1600, 0.82), readImage(file, 320, 0.7)]).then(function (r) {
        return Api.call('files.upload', { kind: kind, ref: ref || '', mime: 'image/jpeg', data: r[0].split(',')[1], thumb: r[1].split(',')[1] }, { timeout: 90000 })
          .then(function (d) { Photos.cache[d.photo_url + '|thumb'] = r[1]; return d.photo_url; });
      });
    },
    /** <img data-photo="drive://..."> 들을 일괄 로드 */
    hydrate: function (root) {
      var self = this;
      $$('img[data-photo]', root).forEach(function (img) {
        var ref = img.getAttribute('data-photo');
        var size = img.getAttribute('data-size') || 'thumb';
        var key = ref + '|' + size;
        if (!ref) return;
        if (self.cache[key]) { img.src = self.cache[key]; return; }
        (self.queue[key] = self.queue[key] || []).push(img);
      });
      clearTimeout(this.timer);
      this.timer = setTimeout(function () { self.flush(); }, 30);
    },
    flush: function () {
      var self = this;
      var keys = Object.keys(this.queue);
      if (!keys.length) return;
      var groups = { thumb: [], full: [] };
      keys.forEach(function (k) { var i = k.lastIndexOf('|'); groups[k.slice(i + 1)].push(k.slice(0, i)); });
      var pending = this.queue; this.queue = {};
      ['thumb', 'full'].forEach(function (size) {
        var refs = groups[size];
        for (var i = 0; i < refs.length; i += (size === 'full' ? 3 : 40)) {
          (function (chunk) {
            Api.call('files.get', { refs: chunk, size: size }).then(function (d) {
              chunk.forEach(function (ref) {
                var src = d.images[ref];
                if (!src) return;
                self.cache[ref + '|' + size] = src;
                (pending[ref + '|' + size] || []).forEach(function (img) { img.src = src; });
              });
            }).catch(function () { /* 사진 로드 실패는 조용히 */ });
          })(refs.slice(i, i + (size === 'full' ? 3 : 40)));
        }
      });
    }
  };
  function photoThumb(ref, cls) {
    if (!ref) return '<div class="thumb ph ' + (cls || '') + '">' + icon('image') + '</div>';
    return '<img class="thumb ' + (cls || '') + '" data-photo="' + esc(ref) + '" alt="">';
  }

  // ---------------- QR ----------------
  /** 고유 식별자 → SVG (모듈 단위 path, 인쇄용 선명도) */
  function qrSvg(text, opts) {
    opts = opts || {};
    var q = global.qrcode(0, opts.ec || 'M');
    q.addData(text);
    q.make();
    var n = q.getModuleCount();
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var size = n + quiet * 2;
    var d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR ' + esc(text) + '">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  // ---------------- CSV ----------------
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur);
    if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
    return rows;
  }
  function toCsv(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(function (v) {
        var s = v === null || v === undefined ? '' : String(v);
        if (/^[=+@-]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; // 스프레드시트 수식 주입 방지
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }
  function downloadText(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function envRibbon() {
    if (CFG.ENV && CFG.ENV !== 'PRODUCTION') {
      var r = document.createElement('div');
      r.className = 'env-ribbon';
      r.textContent = CFG.ENV === 'LOCAL' ? 'LOCAL · 데모 데이터' : CFG.ENV;
      document.body.appendChild(r);
    }
  }

  global.C2 = {
    CFG: CFG, Store: Store, esc: esc, uuid: uuid, todayStr: todayStr, addDays: addDays, fmtDateTime: fmtDateTime, fmtDate: fmtDate,
    daysLeft: daysLeft, fmtWon: fmtWon, debounce: debounce, $: $, $$: $$, icon: icon, statusBadge: statusBadge,
    STATUS_META: STATUS_META, ACTION_LABEL: ACTION_LABEL, PROJECT_STATUS: PROJECT_STATUS, ROLE_LABEL: ROLE_LABEL,
    toast: toast, modal: modal, confirmDialog: confirmDialog, busy: busy, showError: showError,
    Auth: Auth, Api: Api, ApiError: ApiError, loginScreenHtml: loginScreenHtml, loadScript: loadScript,
    Photos: Photos, photoThumb: photoThumb, qrSvg: qrSvg, parseCsv: parseCsv, toCsv: toCsv, downloadText: downloadText,
    envRibbon: envRibbon
  };
})(window);
