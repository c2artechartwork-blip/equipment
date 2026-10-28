/* C2 EQUIPMENT MANAGER — 관리자 화면: 반출/반납 · 프로젝트 · 세트 · 점검 · 이력 · 직원 · 설정 */
(function () {
  'use strict';
  var C = window.C2, esc = C.esc, icon = C.icon, Api = C.Api, A = window.A;

  function projOptions(selected, all) {
    var list = (all ? (A.allProjects || A.boot.projects) : A.boot.projects);
    return list.map(function (p) { return '<option value="' + esc(p.project_id) + '"' + (p.project_id === selected ? ' selected' : '') + '>' + esc(p.project_name) + ' (' + esc(p.project_id) + ')</option>'; }).join('');
  }
  function userOptions(selected) {
    return A.boot.users.map(function (u) { return '<option value="' + esc(u.user_id) + '"' + (u.user_id === selected ? ' selected' : '') + '>' + esc(u.name) + (u.department ? ' (' + esc(u.department) + ')' : '') + '</option>'; }).join('');
  }
  function resultsHtml(results) {
    var fail = results.filter(function (r) { return !r.ok; });
    if (!fail.length) return '';
    return '<div class="issue-row error"><b>' + fail.length + '개 처리 불가</b><ul style="margin:6px 0 0;padding-left:18px">' + fail.map(function (f) { return '<li><span class="mono">' + esc(f.asset_id || f.transaction_id) + '</span> — ' + esc(f.reason) + '</li>'; }).join('') + '</ul></div>';
  }

  // ---------------- 반출 / 반납 (PC) ----------------
  A.views.ops = function (view, r) {
    A.setTitle('반출 / 반납');
    var tab = r.q.tab || 'out';
    view.innerHTML = '<div class="card"><div class="tabs"><button data-t="out" class="' + (tab === 'out' ? 'on' : '') + '">반출</button><button data-t="in" class="' + (tab === 'in' ? 'on' : '') + '">반납</button><button data-t="tr" class="' + (tab === 'tr' ? 'on' : '') + '">현장 이관</button></div><div class="card-pad" id="ops-body"></div></div>';
    C.$$('.tabs button', view).forEach(function (b) { b.onclick = function () { A.go('#/ops?tab=' + b.getAttribute('data-t')); }; });
    var body = C.$('#ops-body');
    A.loading(body);
    A.loadAssets(true).then(function (assets) {
      var byId = {}; assets.forEach(function (a) { byId[a.asset_id] = a; });
      if (tab === 'in') return opsReturn(body, assets, byId, r.q.project || '');
      opsCheckout(body, byId, tab === 'tr');
    }).catch(function (e) { A.err(body, e); });
  };

  function opsCheckout(body, byId, transfer) {
    var key = transfer ? 'c2em.pc.transfer' : 'c2em.pc.cart';
    var st = C.Store.get(key, { project_id: '', items: [], due: '', receiver: A.user.user_id, notes: '', request_id: null });
    if (!st.due || st.due < C.todayStr()) st.due = C.addDays(C.todayStr(), parseInt(A.boot.settings.system.DEFAULT_DUE_DAYS, 10) || 7);
    function save(changed) { if (changed) st.request_id = null; C.Store.set(key, st); }
    function render(fails) {
      fails = fails || {};
      body.innerHTML = (transfer ? '<p class="small muted" style="margin-top:0">반출 중인 장비를 반납 없이 다른 프로젝트(현장)로 옮깁니다.</p>' : '') +
        '<div class="grid-3"><div class="field"><label class="req">' + (transfer ? '이관할 프로젝트' : '프로젝트') + '</label><select class="input" id="o-p"><option value="">선택</option>' + projOptions(st.project_id) + '</select></div>' +
        '<div class="field"><label class="req">반납 예정일</label><input class="input" type="date" id="o-due" min="' + C.todayStr() + '" value="' + esc(st.due) + '"></div>' +
        '<div class="field"><label>담당자</label><select class="input" id="o-recv">' + userOptions(st.receiver) + '</select></div></div>' +
        '<div class="field" style="margin-top:14px"><label>관리번호 입력 / USB 스캐너 / 세트(SET:...)</label><input class="input scan-input" id="o-scan" placeholder="C2-PJ-001 입력 후 Enter" autocomplete="off"></div>' +
        '<div class="table-wrap" style="margin-top:12px;border:1px solid var(--border);border-radius:8px"><table class="tbl"><thead><tr><th>관리번호</th><th>장비명</th><th>현재 상태</th><th>확인</th><th></th></tr></thead><tbody>' +
        (st.items.length ? st.items.map(function (id) {
          var a = byId[id];
          var okLocal = a && (transfer ? a.current_status === 'CHECKED_OUT' : a.current_status === 'AVAILABLE');
          var reason = fails[id] || (!a ? '등록되지 않은 장비' : okLocal ? '' : (transfer ? '반출 중이 아님' : '반출 불가 상태'));
          return '<tr' + (reason ? ' style="background:var(--st-danger-bg)"' : '') + '><td class="mono">' + esc(id) + '</td><td>' + esc(a ? a.asset_name : '') + '</td><td>' + (a ? C.statusBadge(a.current_status, a.overdue) : '') + '</td>' +
            '<td class="small">' + (reason ? '<span style="color:var(--st-danger);font-weight:600">' + esc(reason) + '</span>' : '<span style="color:var(--st-available)">가능</span>') + '</td><td><button class="btn sm ghost" data-rm="' + esc(id) + '">' + icon('trash') + '</button></td></tr>';
        }).join('') : '<tr><td colspan="5"><div class="empty">장비를 추가하세요.</div></td></tr>') + '</tbody></table></div>' +
        '<div class="field" style="margin-top:12px"><label>메모</label><input class="input" id="o-notes" value="' + esc(st.notes) + '"></div>' +
        '<div class="row" style="margin-top:16px"><button class="btn" id="o-clear">비우기</button><span class="spacer"></span><button class="btn primary lg" id="o-submit"' + (st.items.length ? '' : ' disabled') + '>' + st.items.length + '개 ' + (transfer ? '이관' : '반출') + ' 확정</button></div><div id="o-res" style="margin-top:12px"></div>';
      var scan = C.$('#o-scan', body);
      scan.focus();
      scan.onkeydown = function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var v = scan.value.trim(); scan.value = '';
        if (!v) return;
        Api.call('assets.lookup', { code: v }).then(function (res) {
          var ids = res.type === 'set' ? res.items.filter(function (it) { return transfer ? it.asset && it.asset.current_status === 'CHECKED_OUT' : it.can_checkout; }).map(function (it) { return it.asset_id; }) : [res.asset.asset_id];
          if (res.type === 'asset') byId[res.asset.asset_id] = res.asset;
          else res.items.forEach(function (it) { if (it.asset) byId[it.asset_id] = it.asset; });
          var added = 0;
          ids.forEach(function (id) { if (st.items.indexOf(id) < 0) { st.items.push(id); added++; } });
          if (res.type === 'set') C.toast(res.set_name + ': ' + added + '개 추가 (불가 ' + (res.items.length - ids.length) + '개 제외)');
          save(true); render();
        }).catch(C.showError);
      };
      C.$$('[data-rm]', body).forEach(function (b) { b.onclick = function () { st.items = st.items.filter(function (x) { return x !== b.getAttribute('data-rm'); }); save(true); render(); }; });
      C.$('#o-p', body).onchange = function (e) { st.project_id = e.target.value; save(true); };
      C.$('#o-due', body).onchange = function (e) { st.due = e.target.value; save(true); };
      C.$('#o-recv', body).onchange = function (e) { st.receiver = e.target.value; save(true); };
      C.$('#o-notes', body).onchange = function (e) { st.notes = e.target.value; save(true); };
      C.$('#o-clear', body).onclick = function () { st.items = []; save(true); render(); };
      C.$('#o-submit', body).onclick = function () {
        var btn = this;
        if (!st.project_id) return C.toast('프로젝트를 선택하세요.', 'err');
        if (!st.request_id) st.request_id = A.req();
        save(false);
        C.busy(btn, true);
        Api.call(transfer ? 'tx.transfer' : 'tx.checkout', {
          request_id: st.request_id, project_id: st.project_id, due_date: st.due, receiver_user_id: st.receiver, notes: st.notes, asset_ids: st.items
        }).then(function (d) {
          C.toast(d.success_count + '개 ' + (transfer ? '이관' : '반출') + ' 완료' + (d.duplicate ? ' (중복 요청 — 추가 반영 없음)' : ''));
          st.items = []; st.notes = ''; save(true);
          A.assets = null;
          render();
          C.$('#o-res', body).innerHTML = '<div class="notice good" style="display:flex">' + icon('check') + '처리 완료 · ' + esc(d.checkout_group_id || '') + '</div>';
        }).catch(function (e) {
          C.busy(btn, false);
          if (e.details && e.details.results) {
            var f = {}; e.details.results.forEach(function (x) { if (!x.ok) f[x.asset_id] = x.reason; });
            st.request_id = null; save(false);
            render(f);
            C.$('#o-res', body).innerHTML = resultsHtml(e.details.results) + '<p class="small muted">불가 장비를 빼고 다시 확정하세요. 아무것도 기록되지 않았습니다.</p>';
          } else C.showError(e);
        });
      };
    }
    render();
  }

  function opsReturn(body, assets, byId, project) {
    var out = assets.filter(function (a) { return a.current_status === 'CHECKED_OUT'; });
    var pids = {};
    out.forEach(function (a) { pids[a.current_project_id] = (pids[a.current_project_id] || 0) + 1; });
    var state = { project: project, cond: {}, notes: {}, photo: {}, request_id: null };
    function render(fails) {
      fails = fails || {};
      var list = out.filter(function (a) { return !state.project || a.current_project_id === state.project; });
      body.innerHTML = '<div class="row wrap"><select class="input" id="r-p" style="width:auto"><option value="">전체 프로젝트 (' + out.length + ')</option>' + Object.keys(pids).map(function (pid) {
        return '<option value="' + esc(pid) + '"' + (state.project === pid ? ' selected' : '') + '>' + esc(A.projectName(pid)) + ' (' + pids[pid] + ')</option>';
      }).join('') + '</select><input class="input scan-input" id="r-scan" placeholder="스캔/입력하면 해당 장비 체크" style="width:320px;min-height:40px;font-size:14px"><span class="spacer"></span>' +
        '<button class="btn sm" id="r-all">전체 선택</button><button class="btn sm" id="r-none">선택 해제</button></div>' +
        '<div class="table-wrap" style="margin-top:12px;border:1px solid var(--border);border-radius:8px;max-height:60vh;overflow:auto"><table class="tbl"><thead><tr><th class="chk"></th><th>관리번호</th><th>장비명</th><th>프로젝트</th><th>담당</th><th>반납 예정</th><th>상태</th><th style="width:280px">이상 내용 (이상 시 필수)</th></tr></thead><tbody>' +
        (list.length ? list.map(function (a) {
          var c = state.cond[a.asset_id];
          return '<tr' + (fails[a.asset_id] ? ' style="background:var(--st-danger-bg)"' : c ? ' class="selected"' : '') + '><td class="chk"><input type="checkbox" data-sel="' + esc(a.asset_id) + '"' + (c ? ' checked' : '') + '></td>' +
            '<td class="mono nowrap">' + esc(a.asset_id) + '</td><td>' + esc(a.asset_name) + (fails[a.asset_id] ? '<div class="small" style="color:var(--st-danger)">' + esc(fails[a.asset_id]) + '</div>' : '') + '</td><td class="small">' + esc(A.projectName(a.current_project_id)) + '</td>' +
            '<td class="small nowrap">' + esc(A.userName(a.current_user_id)) + '</td><td class="small nowrap"' + (a.overdue ? ' style="color:var(--st-danger);font-weight:700"' : '') + '>' + esc(a.return_due_date) + '</td>' +
            '<td><select class="input" data-cond="' + esc(a.asset_id) + '" style="min-height:30px;width:auto"' + (c ? '' : ' disabled') + '><option value="OK"' + (c === 'OK' ? ' selected' : '') + '>정상</option><option value="ISSUE"' + (c === 'ISSUE' ? ' selected' : '') + '>이상</option></select></td>' +
            '<td>' + (c === 'ISSUE' ? '<div class="row"><input class="input" data-note="' + esc(a.asset_id) + '" value="' + esc(state.notes[a.asset_id] || '') + '" style="min-height:30px"><label class="btn sm" title="사진">' + icon(state.photo[a.asset_id] ? 'check' : 'camera') + '<input type="file" accept="image/*" class="sr-only" data-ph="' + esc(a.asset_id) + '"></label></div>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="8"><div class="empty">반출 중인 장비가 없습니다.</div></td></tr>') + '</tbody></table></div>' +
        '<div class="row" style="margin-top:14px"><span class="muted small">체크한 장비만 반납됩니다. 나머지는 반출 상태를 유지합니다.</span><span class="spacer"></span><button class="btn primary lg" id="r-submit">선택 ' + Object.keys(state.cond).length + '개 반납 처리</button></div><div id="r-res" style="margin-top:12px"></div>';
      function touch() { state.request_id = null; }
      C.$('#r-p', body).onchange = function (e) { state.project = e.target.value; render(); };
      C.$$('[data-sel]', body).forEach(function (x) { x.onchange = function () { var id = x.getAttribute('data-sel'); if (x.checked) state.cond[id] = 'OK'; else delete state.cond[id]; touch(); render(); }; });
      C.$$('[data-cond]', body).forEach(function (x) { x.onchange = function () { state.cond[x.getAttribute('data-cond')] = x.value; touch(); render(); }; });
      C.$$('[data-note]', body).forEach(function (x) { x.oninput = function () { state.notes[x.getAttribute('data-note')] = x.value; touch(); }; });
      C.$$('[data-ph]', body).forEach(function (x) {
        x.onchange = function (e) {
          var f = e.target.files[0]; if (!f) return;
          var id = x.getAttribute('data-ph');
          C.Photos.upload(f, 'return', id).then(function (url) { state.photo[id] = url; touch(); C.toast('사진 첨부됨'); render(); }).catch(C.showError);
        };
      });
      C.$('#r-all', body).onclick = function () { list.forEach(function (a) { if (!state.cond[a.asset_id]) state.cond[a.asset_id] = 'OK'; }); touch(); render(); };
      C.$('#r-none', body).onclick = function () { state.cond = {}; touch(); render(); };
      var sc = C.$('#r-scan', body);
      sc.onkeydown = function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var v = sc.value.trim().toUpperCase(); sc.value = '';
        var m = /[?&]A=([^&#]+)/.exec(v); if (m) v = m[1];
        if (!byId[v] || byId[v].current_status !== 'CHECKED_OUT') return C.toast(v + ': 반출 중인 장비가 아닙니다.', 'err');
        state.cond[v] = state.cond[v] || 'OK'; touch(); render();
        C.$('#r-scan', body).focus();
      };
      C.$('#r-submit', body).onclick = function () {
        var btn = this;
        var ids = Object.keys(state.cond);
        if (!ids.length) return C.toast('반납할 장비를 선택하세요.', 'err');
        var needPhoto = String(A.boot.settings.system.REQUIRE_PHOTO_ON_ISSUE).toUpperCase() === 'TRUE';
        var bad = ids.filter(function (id) { return state.cond[id] === 'ISSUE' && (!(state.notes[id] || '').trim() || (needPhoto && !state.photo[id])); });
        if (bad.length) return C.toast('이상 장비는 내용' + (needPhoto ? '과 사진' : '') + '이 필요합니다: ' + bad.join(', '), 'err');
        if (!state.request_id) state.request_id = A.req();
        C.busy(btn, true);
        Api.call('tx.return', {
          request_id: state.request_id,
          items: ids.map(function (id) { return { asset_id: id, condition: state.cond[id], notes: state.notes[id] || '', photo_url: state.photo[id] || '' }; })
        }).then(function (d) {
          C.toast(d.success_count + '개 반납 완료');
          A.assets = null;
          A.views.ops(C.$('#view'), { q: { tab: 'in', project: state.project } });
        }).catch(function (e) {
          C.busy(btn, false);
          if (e.details && e.details.results) {
            var f = {}; e.details.results.forEach(function (x) { if (!x.ok) f[x.asset_id] = x.reason; });
            render(f);
            C.$('#r-res', body).innerHTML = resultsHtml(e.details.results);
          } else C.showError(e);
        });
      };
    }
    render();
  }

  // ---------------- 프로젝트 ----------------
  A.views.projects = function (view) {
    A.setTitle('프로젝트 관리');
    A.loading(view);
    A.loadProjects().then(function (list) {
      var f = { q: '', st: 'OPEN' };
      view.innerHTML = '<div class="toolbar"><input class="input search" id="p-q" placeholder="프로젝트명·클라이언트·장소"><select class="input" id="p-st"><option value="OPEN">준비·진행</option><option value="">전체</option><option value="DONE">완료</option><option value="CANCELLED">취소</option></select><span class="spacer"></span>' +
        (A.can('manage') ? '<button class="btn primary" id="p-new">' + icon('plus') + ' 새 프로젝트</button>' : '') + '</div><div class="card" id="p-tbl"></div>';
      function render() {
        var rows = list.filter(function (p) {
          if (f.st === 'OPEN' && ['PLANNED', 'ACTIVE'].indexOf(p.status) < 0) return false;
          if (f.st && f.st !== 'OPEN' && p.status !== f.st) return false;
          return !f.q || (p.project_name + ' ' + p.client + ' ' + p.location + ' ' + p.project_id).toLowerCase().indexOf(f.q) >= 0;
        });
        C.$('#p-tbl').innerHTML = rows.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>프로젝트명</th><th>클라이언트</th><th>장소</th><th>기간</th><th>담당자</th><th>상태</th><th class="right">반출 중</th><th class="right">지연</th></tr></thead><tbody>' + rows.map(function (p) {
          return '<tr class="clickable" data-id="' + esc(p.project_id) + '"><td class="mono small nowrap">' + esc(p.project_id) + '</td><td><b>' + esc(p.project_name) + '</b></td><td class="small">' + esc(p.client) + '</td><td class="small">' + esc(p.location) + '</td>' +
            '<td class="small nowrap">' + esc(p.start_date) + ' ~ ' + esc(p.end_date) + '</td><td class="small">' + esc(p.manager_name) + '</td><td><span class="badge ' + ({ ACTIVE: 'b-out', PLANNED: 'b-yellow', DONE: 'b-available', CANCELLED: 'b-gray' }[p.status] || 'b-gray') + '">' + esc(C.PROJECT_STATUS[p.status] || p.status) + '</span></td>' +
            '<td class="right">' + p.out_count + '</td><td class="right"' + (p.overdue_count ? ' style="color:var(--st-danger);font-weight:700"' : '') + '>' + p.overdue_count + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">프로젝트가 없습니다.</div>';
        C.$$('tr[data-id]', view).forEach(function (tr) { tr.onclick = function () { A.go('#/project/' + encodeURIComponent(tr.getAttribute('data-id'))); }; });
      }
      C.$('#p-q').oninput = C.debounce(function (e) { f.q = e.target.value.trim().toLowerCase(); render(); }, 120);
      C.$('#p-st').onchange = function (e) { f.st = e.target.value; render(); };
      var nb = C.$('#p-new'); if (nb) nb.onclick = function () { projectDialog(null, function () { A.views.projects(view); }); };
      render();
    }).catch(function (e) { A.err(view, e); });
  };

  function projectDialog(p, done) {
    p = p || { status: 'PLANNED' };
    Api.call('users.directory', {}).then(function (d) {
      C.modal({
        title: p.project_id ? '프로젝트 수정' : '새 프로젝트', wide: true,
        body: '<div class="grid-2"><div class="field" style="grid-column:1/-1"><label class="req">프로젝트명</label><input class="input" id="pf-name" value="' + esc(p.project_name || '') + '"></div>' +
          '<div class="field"><label>클라이언트</label><input class="input" id="pf-client" value="' + esc(p.client || '') + '"></div>' +
          '<div class="field"><label>장소</label><input class="input" id="pf-loc" value="' + esc(p.location || '') + '"><span class="hint">반출 장비의 현재 위치로 기록됩니다.</span></div>' +
          '<div class="field"><label>시작일</label><input class="input" type="date" id="pf-s" value="' + esc(p.start_date || '') + '"></div>' +
          '<div class="field"><label>종료일</label><input class="input" type="date" id="pf-e" value="' + esc(p.end_date || '') + '"></div>' +
          '<div class="field"><label>담당자</label><select class="input" id="pf-m"><option value="">-</option>' + d.users.map(function (u) { return '<option value="' + esc(u.user_id) + '"' + (u.user_id === p.manager_id ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label>상태</label><select class="input" id="pf-st">' + Object.keys(C.PROJECT_STATUS).map(function (k) { return '<option value="' + k + '"' + (p.status === k ? ' selected' : '') + '>' + C.PROJECT_STATUS[k] + '</option>'; }).join('') + '</select></div>' +
          '<div class="field" style="grid-column:1/-1"><label>메모</label><textarea class="input" id="pf-notes">' + esc(p.notes || '') + '</textarea></div></div>',
        actions: [{ label: '취소' }, {
          label: '저장', cls: 'primary', onClick: function () {
            var rec = { project_id: p.project_id || '', project_name: C.$('#pf-name').value.trim(), client: C.$('#pf-client').value.trim(), location: C.$('#pf-loc').value.trim(), start_date: C.$('#pf-s').value, end_date: C.$('#pf-e').value, manager_id: C.$('#pf-m').value, status: C.$('#pf-st').value, notes: C.$('#pf-notes').value.trim() };
            if (!rec.project_name) { C.toast('프로젝트명을 입력하세요.', 'err'); return false; }
            var send = function (force) {
              return Api.call('projects.save', { request_id: A.req(), project: rec, force: force }).then(function (r) {
                C.toast(r.project_id + ' 저장됨'); return A.refreshBoot().then(done);
              }, function (e) {
                if (e.code === 'NEEDS_CONFIRM') return C.confirmDialog('확인', esc(e.message), '변경').then(function (ok) { return ok ? send(true) : false; });
                throw e;
              });
            };
            return send(false);
          }
        }]
      });
    }).catch(C.showError);
  }

  A.views.project = function (view, r) {
    A.setTitle(r.arg, '프로젝트');
    A.loading(view);
    Api.call('projects.get', { project_id: r.arg }).then(function (d) {
      var p = d.project;
      A.setTitle(p.project_name, p.project_id);
      var late = d.out_assets.filter(function (a) { return a.overdue; }).length;
      view.innerHTML = '<div class="row" style="margin-bottom:12px"><a class="btn ghost sm" href="#/projects">' + icon('back') + ' 목록</a><span class="spacer"></span>' +
        (A.can('manage') ? '<button class="btn" id="pe">' + icon('edit') + ' 수정</button>' : '') + (A.can('operate') && d.out_assets.length ? '<a class="btn primary" href="#/ops?tab=in&project=' + encodeURIComponent(p.project_id) + '">' + icon('ret') + ' 이 프로젝트 반납 처리</a>' : '') + '</div>' +
        '<div class="stats" style="grid-template-columns:repeat(4,1fr)"><div class="stat"><div class="k">상태</div><div class="v" style="font-size:20px">' + esc(C.PROJECT_STATUS[p.status]) + '</div></div>' +
        '<div class="stat"><div class="k">반출 이력 장비</div><div class="v">' + d.total_ever_out + '</div></div><div class="stat"><div class="k">미반납</div><div class="v">' + d.out_assets.length + '</div></div>' +
        '<div class="stat' + (late ? ' alert' : '') + '"><div class="k">반납 지연</div><div class="v">' + late + '</div></div></div>' +
        '<div class="card card-pad" style="margin-bottom:16px"><dl class="kv"><dt>담당자</dt><dd>' + esc(p.manager_name || '-') + '</dd><dt>클라이언트</dt><dd>' + esc(p.client || '-') + '</dd><dt>장소</dt><dd>' + esc(p.location || '-') + '</dd>' +
        '<dt>진행 기간</dt><dd>' + esc(p.start_date || '?') + ' ~ ' + esc(p.end_date || '?') + '</dd><dt>메모</dt><dd>' + esc(p.notes || '-') + '</dd></dl></div>' +
        '<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>미반납 장비 (' + d.out_assets.length + ')</h3></div>' + (d.out_assets.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>관리번호</th><th>장비명</th><th>담당</th><th>반납 예정</th><th>상태</th></tr></thead><tbody>' + d.out_assets.map(function (a) {
          return '<tr class="clickable" data-href="#/asset/' + encodeURIComponent(a.asset_id) + '"><td class="mono">' + esc(a.asset_id) + '</td><td>' + esc(a.asset_name) + '</td><td>' + esc(a.user_name) + '</td><td' + (a.overdue ? ' style="color:var(--st-danger);font-weight:700"' : '') + '>' + esc(a.return_due_date) + '</td><td>' + C.statusBadge(a.current_status, a.overdue) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">미반납 장비가 없습니다.</div>') + '</div>' +
        '<div class="card"><div class="card-head"><h3>프로젝트 반출 이력</h3></div>' + A.txTable(d.history) + '</div>';
      C.$$('[data-href]', view).forEach(function (tr) { tr.onclick = function () { A.go(tr.getAttribute('data-href')); }; });
      A.bindPhotoOpen(view);
      var pe = C.$('#pe'); if (pe) pe.onclick = function () { projectDialog(p, function () { A.views.project(view, r); }); };
    }).catch(function (e) { A.err(view, e); });
  };

  // ---------------- 세트 ----------------
  A.views.sets = function (view) {
    A.setTitle('장비 세트 관리');
    A.loading(view);
    Api.call('sets.list', {}).then(function (d) {
      view.innerHTML = '<div class="toolbar"><span class="muted small">세트 QR을 스캔하면 구성품을 한 번에 불러오고, 출고 전 개별 구성품을 확인할 수 있습니다.</span><span class="spacer"></span>' +
        (A.can('manage') ? '<button class="btn primary" id="s-new">' + icon('plus') + ' 새 세트</button>' : '') + '</div>' +
        (d.sets.length ? '<div class="dash-grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">' + d.sets.map(function (s) {
          return '<div class="card"><div class="card-head"><div class="grow"><h3>' + esc(s.set_name) + '</h3><div class="mono small muted">' + esc(s.set_id) + ' · QR: SET:' + esc(s.set_id) + '</div></div>' +
            '<a class="btn sm" href="#/labels?set=' + encodeURIComponent(s.set_id) + '">' + icon('qr') + '</a>' + (A.can('manage') ? '<button class="btn sm" data-edit="' + esc(s.set_id) + '">' + icon('edit') + '</button>' : '') + '</div>' +
            '<table class="tbl"><tbody>' + s.items.map(function (it) {
              return '<tr><td class="mono small"><a href="#/asset/' + encodeURIComponent(it.asset_id) + '">' + esc(it.asset_id) + '</a></td><td>' + esc(it.asset_name) + '</td><td>' + (it.required ? '<span class="badge b-yellow">필수</span>' : '<span class="small muted">선택</span>') + '</td><td>' + C.statusBadge(it.status) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        }).join('') + '</div>' : '<div class="card"><div class="empty">등록된 세트가 없습니다.</div></div>');
      var nb = C.$('#s-new'); if (nb) nb.onclick = function () { setDialog(null, function () { A.views.sets(view); }); };
      C.$$('[data-edit]', view).forEach(function (b) { b.onclick = function () { setDialog(d.sets.filter(function (s) { return s.set_id === b.getAttribute('data-edit'); })[0], function () { A.views.sets(view); }); }; });
    }).catch(function (e) { A.err(view, e); });
  };

  function setDialog(s, done) {
    s = s ? JSON.parse(JSON.stringify(s)) : { set_id: '', set_name: '', items: [] };
    A.loadAssets(false).then(function (assets) {
      var byId = {}; assets.forEach(function (a) { byId[a.asset_id] = a; });
      var body = document.createElement('div');
      function render() {
        body.innerHTML = '<div class="field"><label class="req">세트명</label><input class="input" id="sf-name" value="' + esc(s.set_name) + '"></div>' +
          '<div class="field" style="margin-top:12px"><label>구성품 추가 (관리번호 입력/스캔 후 Enter)</label><input class="input scan-input" id="sf-add" list="sf-dl" autocomplete="off"><datalist id="sf-dl">' +
          assets.filter(function (a) { return !a.set_id || a.set_id === s.set_id; }).slice(0, 1500).map(function (a) { return '<option value="' + esc(a.asset_id) + '">' + esc(a.asset_name) + '</option>'; }).join('') + '</datalist></div>' +
          '<table class="tbl" style="margin-top:10px"><thead><tr><th>관리번호</th><th>장비명</th><th>필수</th><th></th></tr></thead><tbody>' + (s.items.length ? s.items.map(function (it, i) {
            return '<tr><td class="mono">' + esc(it.asset_id) + '</td><td>' + esc(byId[it.asset_id] ? byId[it.asset_id].asset_name : '?') + '</td><td><input type="checkbox" data-req="' + i + '"' + (it.required ? ' checked' : '') + '></td><td><button class="btn sm ghost" data-rm="' + i + '">' + icon('trash') + '</button></td></tr>';
          }).join('') : '<tr><td colspan="4"><div class="empty">구성품을 추가하세요.</div></td></tr>') + '</tbody></table>' +
          '<p class="small muted">한 장비는 하나의 세트에만 속할 수 있습니다. (케이블 등 소모품 수량 관리는 향후 확장)</p>';
        C.$('#sf-name', body).oninput = function (e) { s.set_name = e.target.value; };
        C.$('#sf-add', body).onkeydown = function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var v = e.target.value.trim().toUpperCase();
          if (!byId[v]) return C.toast('등록되지 않은 장비: ' + v, 'err');
          if (byId[v].set_id && byId[v].set_id !== s.set_id) return C.toast(v + '는 이미 ' + byId[v].set_id + ' 세트에 속해 있습니다.', 'err');
          if (!s.items.some(function (x) { return x.asset_id === v; })) s.items.push({ asset_id: v, required: true, quantity: 1 });
          render(); C.$('#sf-add', body).focus();
        };
        C.$$('[data-req]', body).forEach(function (x) { x.onchange = function () { s.items[+x.getAttribute('data-req')].required = x.checked; }; });
        C.$$('[data-rm]', body).forEach(function (b) { b.onclick = function () { s.items.splice(+b.getAttribute('data-rm'), 1); render(); }; });
      }
      render();
      var actions = [{ label: '취소' }];
      if (s.set_id) actions.push({
        label: '세트 해체', cls: 'danger', onClick: function () {
          return C.confirmDialog('세트 해체', esc(s.set_name) + ' 세트를 해체할까요? (장비는 그대로 유지)', '해체', 'danger').then(function (ok) {
            if (!ok) return false;
            return Api.call('sets.delete', { request_id: A.req(), set_id: s.set_id }).then(function () { C.toast('해체됨'); A.assets = null; done(); });
          });
        }
      });
      actions.push({
        label: '저장', cls: 'primary', onClick: function () {
          return Api.call('sets.save', { request_id: A.req(), set: s }).then(function (r) { C.toast(r.set_id + ' 저장됨'); A.assets = null; done(); });
        }
      });
      C.modal({ title: s.set_id ? s.set_id + ' 세트 수정' : '새 세트', body: body, wide: true, actions: actions });
    }).catch(C.showError);
  }

  // ---------------- 점검 / 수리 ----------------
  A.reportDialog = function (assetId, done) {
    C.modal({
      title: '점검 · 수리 접수',
      body: '<div class="stack"><div class="field"><label class="req">관리번호</label><input class="input mono" id="rp-id" value="' + esc(assetId || '') + '"></div>' +
        '<div class="field"><label>유형</label><select class="input" id="rp-type"><option value="INSPECT">점검 (상태: 점검)</option><option value="REPAIR">수리 (상태: 수리)</option></select></div>' +
        '<div class="field"><label class="req">내용</label><textarea class="input" id="rp-desc"></textarea></div>' +
        '<div class="field"><label>사진</label><input type="file" accept="image/*" class="input" id="rp-ph"></div></div>',
      actions: [{ label: '취소' }, {
        label: '접수', cls: 'primary', onClick: function () {
          var id = C.$('#rp-id').value.trim().toUpperCase(), desc = C.$('#rp-desc').value.trim();
          if (!id || !desc) { C.toast('관리번호와 내용을 입력하세요.', 'err'); return false; }
          var f = C.$('#rp-ph').files[0];
          var reqId = A.req();
          return (f ? C.Photos.upload(f, 'inspection', id) : Promise.resolve('')).then(function (url) {
            return Api.call('inspections.report', { request_id: reqId, asset_id: id, type: C.$('#rp-type').value, description: desc, photo_url: url });
          }).then(function (r) { C.toast(r.inspection_id + ' 접수됨'); A.assets = null; done(); });
        }
      }]
    });
  };

  A.views.inspections = function (view, r) {
    A.setTitle('점검 / 수리');
    var st = r.q.status || 'OPEN';
    A.loading(view);
    Api.call('inspections.list', { status: st }).then(function (d) {
      view.innerHTML = '<div class="toolbar"><div class="seg row">' + [['OPEN', '진행 중'], ['RESOLVED', '완료'], ['', '전체']].map(function (o) {
        return '<a class="btn sm' + (o[0] === st ? ' dark' : '') + '" href="#/inspections?status=' + o[0] + '">' + o[1] + '</a>';
      }).join('') + '</div><span class="spacer"></span>' + (A.can('operate') ? '<button class="btn primary" id="i-new">' + icon('plus') + ' 점검 접수</button>' : '') + '</div>' +
        '<div class="card">' + (d.inspections.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>접수 ID</th><th>접수일</th><th>장비</th><th>유형</th><th>내용</th><th>접수자</th><th>장비 상태</th><th>진행</th><th></th></tr></thead><tbody>' + d.inspections.map(function (i) {
          return '<tr><td class="mono small nowrap">' + esc(i.inspection_id) + '</td><td class="small nowrap">' + esc(C.fmtDateTime(i.reported_at)) + '</td><td><a class="mono" href="#/asset/' + encodeURIComponent(i.asset_id) + '">' + esc(i.asset_id) + '</a><div class="small">' + esc(i.asset_name) + '</div></td>' +
            '<td class="small">' + esc({ RETURN_ISSUE: '반납 이상', INSPECT: '점검', REPAIR: '수리' }[i.type] || i.type) + '</td><td class="small" style="max-width:320px">' + esc(i.description) + (i.photo_url ? ' <a href="#" data-photo-open="' + esc(i.photo_url) + '">[사진]</a>' : '') +
            (i.resolution ? '<div class="muted" style="white-space:pre-line;margin-top:4px">' + esc(i.resolution) + '</div>' : '') + '</td><td class="small nowrap">' + esc(i.reported_by_name) + '</td><td>' + C.statusBadge(i.asset_status) + '</td>' +
            '<td>' + (i.status === 'RESOLVED' ? '<span class="badge b-available">완료</span>' : '<span class="badge b-inspect">' + (i.status === 'IN_PROGRESS' ? '진행' : '접수') + '</span>') + '</td>' +
            '<td>' + (i.status !== 'RESOLVED' && A.can('manage') ? '<button class="btn sm" data-res="' + esc(i.inspection_id) + '">처리</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">해당하는 점검 기록이 없습니다.</div>') + '</div>';
      A.bindPhotoOpen(view);
      var nb = C.$('#i-new'); if (nb) nb.onclick = function () { A.reportDialog('', function () { A.views.inspections(view, r); }); };
      C.$$('[data-res]', view).forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-res');
          C.modal({
            title: id + ' 처리',
            body: '<div class="stack"><div class="field"><label class="req">처리 결과</label><select class="input" id="rs-o"><option value="AVAILABLE">정상 — 보유로 복귀</option><option value="IN_PROGRESS">진행 중 (메모만 추가)</option><option value="REPAIR">수리 진행 (상태: 수리)</option><option value="DAMAGED">파손 확정</option><option value="RETIRED">폐기</option><option value="LOST">분실</option></select></div>' +
              '<div class="field"><label class="req">처리 내용</label><textarea class="input" id="rs-t"></textarea></div></div>',
            actions: [{ label: '취소' }, {
              label: '저장', cls: 'primary', onClick: function () {
                var t = C.$('#rs-t').value.trim();
                if (!t) { C.toast('처리 내용을 입력하세요.', 'err'); return false; }
                return Api.call('inspections.resolve', { request_id: A.req(), inspection_id: id, outcome: C.$('#rs-o').value, resolution: t }).then(function () { C.toast('저장됨'); A.assets = null; A.views.inspections(view, r); });
              }
            }]
          });
        };
      });
    }).catch(function (e) { A.err(view, e); });
  };

  // ---------------- 입출고 이력 ----------------
  A.correctDialog = function (txs, done) {
    C.modal({
      title: '거래 정정 (' + txs.length + '건)',
      body: '<p class="small" style="margin-top:0">선택한 거래 직전 상태로 장비를 되돌리고 <b>CORRECTION</b> 기록을 남깁니다. 원래 기록은 삭제되지 않습니다. 각 장비의 <b>가장 최근 거래</b>만 정정할 수 있습니다.</p>' +
        '<ul class="small">' + txs.map(function (t) { return '<li><span class="mono">' + esc(t.transaction_id) + '</span> · ' + esc(C.ACTION_LABEL[t.action_type]) + ' · ' + esc(t.asset_id) + '</li>'; }).join('') + '</ul>' +
        '<div class="field"><label class="req">정정 사유</label><textarea class="input" id="co-r"></textarea></div>',
      actions: [{ label: '취소' }, {
        label: '정정', cls: 'danger', onClick: function () {
          var reason = C.$('#co-r').value.trim();
          if (!reason) { C.toast('사유를 입력하세요.', 'err'); return false; }
          return Api.call('tx.correct', { request_id: A.req(), transaction_ids: txs.map(function (t) { return t.transaction_id; }), reason: reason }).then(function (d) {
            var fail = d.results.filter(function (x) { return !x.ok; });
            C.toast(d.success_count + '건 정정' + (fail.length ? ' · 불가 ' + fail.map(function (f) { return f.transaction_id + ': ' + f.reason; }).join(' / ') : ''), fail.length ? 'err' : 'ok', 7000);
            A.assets = null; done();
          }, function (e) {
            if (e.details && e.details.results) { C.toast(e.details.results.map(function (f) { return f.reason; }).join(' / '), 'err', 7000); return false; }
            throw e;
          });
        }
      }]
    });
  };

  A.views.history = function (view, r) {
    A.setTitle('입출고 이력');
    var f = { from: r.q.from || C.addDays(C.todayStr(), -30), to: r.q.to || '', action_type: r.q.type || '', project_id: r.q.project || '', user_id: r.q.user || '', asset_id: r.q.asset || '', q: '' };
    Promise.all([A.loadProjects(), Api.call('users.directory', {})]).then(function (res) {
      var users = res[1].users;
      view.innerHTML = '<div class="card card-pad" style="margin-bottom:12px"><div class="row wrap">' +
        '<input class="input" type="date" id="h-from" value="' + esc(f.from) + '" style="width:auto"> ~ <input class="input" type="date" id="h-to" value="' + esc(f.to) + '" style="width:auto">' +
        '<select class="input" id="h-type" style="width:auto"><option value="">전체 유형</option>' + Object.keys(C.ACTION_LABEL).map(function (k) { return '<option value="' + k + '"' + (f.action_type === k ? ' selected' : '') + '>' + C.ACTION_LABEL[k] + '</option>'; }).join('') + '</select>' +
        '<select class="input" id="h-proj" style="width:auto;max-width:220px"><option value="">전체 프로젝트</option>' + projOptions(f.project_id, true) + '</select>' +
        '<select class="input" id="h-user" style="width:auto"><option value="">전체 직원</option>' + users.map(function (u) { return '<option value="' + esc(u.user_id) + '"' + (f.user_id === u.user_id ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select>' +
        '<input class="input mono" id="h-asset" placeholder="관리번호" value="' + esc(f.asset_id) + '" style="width:140px"><input class="input" id="h-q" placeholder="메모·거래ID 검색" style="width:180px">' +
        '<button class="btn dark" id="h-go">조회</button><span class="spacer"></span><button class="btn" id="h-csv">' + icon('download') + ' CSV</button>' +
        (A.can('admin') ? '<button class="btn danger" id="h-corr">선택 정정</button>' : '') + '</div></div><div class="card" id="h-res"></div>';
      var last = [];
      function load() {
        f.from = C.$('#h-from').value; f.to = C.$('#h-to').value; f.action_type = C.$('#h-type').value; f.project_id = C.$('#h-proj').value;
        f.user_id = C.$('#h-user').value; f.asset_id = C.$('#h-asset').value.trim().toUpperCase(); f.q = C.$('#h-q').value.trim();
        var box = C.$('#h-res');
        A.loading(box);
        Api.call('tx.list', Object.assign({ limit: 2000 }, f)).then(function (d) {
          last = d.transactions;
          box.innerHTML = '<div class="card-head"><h3>' + d.total.toLocaleString() + '건' + (d.total > d.transactions.length ? ' (최근 ' + d.transactions.length + '건 표시)' : '') + '</h3></div>' + A.txTable(d.transactions, { select: A.can('admin') });
          A.bindPhotoOpen(box);
        }).catch(function (e) { A.err(box, e); });
      }
      C.$('#h-go').onclick = load;
      C.$('#h-csv').onclick = function () {
        var cols = ['transaction_id', 'timestamp', 'action_type', 'asset_id', 'project_id', 'actor_user_id', 'actor_name', 'actor_email', 'receiver_user_id', 'receiver_name', 'due_date', 'condition', 'location', 'previous_status', 'new_status', 'correction_of', 'notes', 'checkout_group_id', 'request_id'];
        C.downloadText('C2_입출고이력_' + C.todayStr() + '.csv', C.toCsv([cols].concat(last.map(function (t) { return cols.map(function (c) { return t[c]; }); }))));
      };
      var cb = C.$('#h-corr');
      if (cb) cb.onclick = function () {
        var ids = C.$$('[data-tx]:checked', view).map(function (x) { return x.getAttribute('data-tx'); });
        if (!ids.length) return C.toast('정정할 거래를 체크하세요.', 'err');
        A.correctDialog(last.filter(function (t) { return ids.indexOf(t.transaction_id) >= 0; }), load);
      };
      load();
    }).catch(function (e) { A.err(view, e); });
  };

  // ---------------- 직원 관리 ----------------
  A.views.users = function (view) {
    A.setTitle('직원 관리');
    if (!A.can('admin')) { view.innerHTML = '<div class="card"><div class="empty">관리자만 접근할 수 있습니다.</div></div>'; return; }
    A.loading(view);
    Api.call('users.list', {}).then(function (d) {
      var pending = d.users.filter(function (u) { return u.status === 'PENDING'; });
      var others = d.users.filter(function (u) { return u.status !== 'PENDING' && u.status !== 'REJECTED'; });
      function roleSel(u) {
        return '<select class="input" data-role="' + esc(u.user_id) + '" style="min-height:30px;width:auto">' + ['ADMIN', 'MANAGER', 'STAFF', 'VIEWER'].map(function (r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + C.ROLE_LABEL[r] + '</option>'; }).join('') + '</select>';
      }
      view.innerHTML = '<div class="toolbar"><span class="muted small">직원은 본인의 개인 Gmail로 로그인합니다. 이메일을 등록해 두면 첫 로그인 때 자동으로 연결됩니다. 비활성화하면 즉시 접근이 차단됩니다.</span><span class="spacer"></span><button class="btn primary" id="u-inv">' + icon('plus') + ' 직원 등록</button></div>' +
        (pending.length ? '<div class="card" style="margin-bottom:16px;border-color:var(--yellow)"><div class="card-head"><h3>승인 대기 (' + pending.length + ')</h3><span class="small muted">등록되지 않은 Google 계정이 로그인을 시도했습니다. 본인 확인 후 승인하세요.</span></div><table class="tbl"><tbody>' + pending.map(function (u) {
          return '<tr><td><b>' + esc(u.google_name || u.name) + '</b><div class="small muted">' + esc(u.email || '(이메일 미확인 계정)') + '</div></td><td class="small muted nowrap">' + esc(C.fmtDateTime(u.created_at)) + '</td><td>' + roleSel(Object.assign({}, u, { role: 'STAFF' })) + '</td>' +
            '<td class="right nowrap"><button class="btn sm primary" data-approve="' + esc(u.user_id) + '">승인</button> <button class="btn sm danger" data-reject="' + esc(u.user_id) + '">거절</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '') +
        '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>이름</th><th>이메일 (Gmail)</th><th>부서</th><th>권한</th><th>연결</th><th>활성</th><th>최근 접속</th><th></th></tr></thead><tbody>' + others.map(function (u) {
          var self = u.user_id === A.user.user_id;
          return '<tr><td><b>' + esc(u.name) + '</b>' + (self ? ' <span class="badge b-yellow">나</span>' : '') + '</td><td class="small">' + esc(u.email) + '</td><td class="small">' + esc(u.department) + '</td><td>' + (self ? esc(C.ROLE_LABEL[u.role]) : roleSel(u)) + '</td>' +
            '<td>' + (u.status === 'INVITED' ? '<span class="badge b-gray">첫 로그인 대기</span>' : '<span class="badge b-available">' + icon('check') + '연결됨</span>') + '</td>' +
            '<td>' + (self ? '<span class="badge b-available">활성</span>' : '<label class="check"><input type="checkbox" data-active="' + esc(u.user_id) + '"' + (u.active ? ' checked' : '') + '>' + (u.active ? '활성' : '<span style="color:var(--st-danger)">비활성</span>') + '</label>') + '</td>' +
            '<td class="small muted nowrap">' + esc(C.fmtDateTime(u.last_login_at)) + '</td><td class="nowrap"><button class="btn sm" data-edit="' + esc(u.user_id) + '">' + icon('edit') + '</button>' + (u.status !== 'INVITED' ? ' <a class="btn sm" href="#/user/' + encodeURIComponent(u.user_id) + '">사용 내역</a>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
      function upd(payload, msg) {
        return Api.call('users.update', Object.assign({ request_id: A.req() }, payload)).then(function () { C.toast(msg); return A.refreshBoot(); }).then(function () { A.views.users(view); }).catch(function (e) { C.showError(e); A.views.users(view); });
      }
      C.$$('[data-role]', view).forEach(function (s) {
        if (s.closest('tr').querySelector('[data-approve]')) return;
        s.onchange = function () { upd({ user_id: s.getAttribute('data-role'), role: s.value }, '권한 변경됨'); };
      });
      C.$$('[data-active]', view).forEach(function (x) {
        x.onchange = function () {
          var id = x.getAttribute('data-active');
          if (!x.checked) {
            C.confirmDialog('계정 비활성화', '이 계정의 접근을 즉시 차단합니다. (기록은 보존)', '비활성화', 'danger').then(function (ok) { if (ok) upd({ user_id: id, active: false }, '비활성화됨 — 즉시 차단'); else x.checked = true; });
          } else upd({ user_id: id, active: true }, '활성화됨');
        };
      });
      C.$$('[data-approve]', view).forEach(function (b) {
        b.onclick = function () { var id = b.getAttribute('data-approve'); upd({ user_id: id, approve: true, role: C.$('[data-role="' + id + '"]', view).value }, '승인됨'); };
      });
      C.$$('[data-reject]', view).forEach(function (b) { b.onclick = function () { upd({ user_id: b.getAttribute('data-reject'), reject: true }, '거절됨'); }; });
      C.$$('[data-edit]', view).forEach(function (b) {
        b.onclick = function () {
          var u = d.users.filter(function (x) { return x.user_id === b.getAttribute('data-edit'); })[0];
          C.modal({
            title: '직원 정보', body: '<div class="stack"><div class="field"><label>이름</label><input class="input" id="ue-n" value="' + esc(u.name) + '"></div><div class="field"><label>부서</label><input class="input" id="ue-d" value="' + esc(u.department) + '"></div>' +
              '<div class="small muted">이메일: ' + esc(u.email) + '<br>Google 계정 ID(sub): <span class="mono">' + esc(u.user_id) + '</span></div></div>',
            actions: [{ label: '취소' }, { label: '저장', cls: 'primary', onClick: function () { return upd({ user_id: u.user_id, name: C.$('#ue-n').value, department: C.$('#ue-d').value }, '저장됨'); } }]
          });
        };
      });
      C.$('#u-inv').onclick = function () {
        C.modal({
          title: '직원 등록',
          body: '<div class="stack"><div class="field"><label class="req">Gmail 주소</label><input class="input" id="ui-e" type="email" placeholder="name@gmail.com"><span class="hint">직원이 이 Google 계정으로 처음 로그인하면 자동 연결됩니다.</span></div>' +
            '<div class="grid-2"><div class="field"><label class="req">이름</label><input class="input" id="ui-n"></div><div class="field"><label>부서</label><input class="input" id="ui-d"></div></div>' +
            '<div class="field"><label class="req">권한</label><select class="input" id="ui-r"><option value="STAFF">직원 — 조회 + 반출·반납</option><option value="MANAGER">매니저 — 장비·프로젝트·입출고 관리</option><option value="VIEWER">조회 전용</option><option value="ADMIN">관리자 — 전체 (직원·설정)</option></select></div></div>',
          actions: [{ label: '취소' }, {
            label: '등록', cls: 'primary', onClick: function () {
              var e = C.$('#ui-e').value.trim(), n = C.$('#ui-n').value.trim();
              if (!e || !n) { C.toast('이메일과 이름을 입력하세요.', 'err'); return false; }
              return Api.call('users.invite', { request_id: A.req(), email: e, name: n, department: C.$('#ui-d').value.trim(), role: C.$('#ui-r').value }).then(function (r) {
                C.toast(r.linked ? '승인 대기 계정과 연결되어 바로 사용할 수 있습니다.' : '등록됨 — 첫 로그인 시 연결됩니다.');
                return A.refreshBoot().then(function () { A.views.users(view); });
              });
            }
          }]
        });
      };
    }).catch(function (e) { A.err(view, e); });
  };

  A.views.user = function (view, r) {
    A.setTitle('직원별 사용 내역');
    A.loading(view);
    Api.call('users.activity', { user_id: r.arg }).then(function (d) {
      var u = d.user;
      A.setTitle(u.name, '직원별 사용 내역');
      var keys = ['CHECKOUT', 'RETURN', 'TRANSFER', 'INSPECT', 'REGISTER', 'EDIT'];
      view.innerHTML = '<div class="row" style="margin-bottom:12px"><a class="btn ghost sm" href="#/users">' + icon('back') + ' 직원 목록</a></div>' +
        '<div class="card card-pad" style="margin-bottom:16px"><dl class="kv"><dt>이름</dt><dd><b>' + esc(u.name) + '</b> · ' + esc(C.ROLE_LABEL[u.role] || '-') + (u.active ? '' : ' <span class="badge b-danger">비활성</span>') + '</dd><dt>이메일</dt><dd>' + esc(u.email) + '</dd>' +
        '<dt>Google ID (sub)</dt><dd class="mono small">' + esc(u.user_id) + '</dd><dt>최근 접속</dt><dd>' + esc(C.fmtDateTime(u.last_login_at)) + '</dd></dl></div>' +
        '<div class="stats" style="grid-template-columns:repeat(6,1fr)">' + keys.map(function (k) { return '<div class="stat"><div class="k">' + C.ACTION_LABEL[k] + ' 처리</div><div class="v">' + (d.summary[k] || 0) + '</div></div>'; }).join('') + '</div>' +
        '<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>현재 담당 중인 반출 장비 (' + d.holding.length + ')</h3></div>' + (d.holding.length ? '<table class="tbl"><tbody>' + d.holding.map(function (a) {
          return '<tr><td class="mono"><a href="#/asset/' + encodeURIComponent(a.asset_id) + '">' + esc(a.asset_id) + '</a></td><td>' + esc(a.asset_name) + '</td><td>' + esc(a.current_project_id) + '</td><td' + (a.overdue ? ' style="color:var(--st-danger);font-weight:700"' : '') + '>' + esc(a.return_due_date) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="empty">없음</div>') + '</div>' +
        '<div class="card"><div class="card-head"><h3>처리·담당 이력 (최근 500건)</h3><span class="spacer"></span><a class="btn sm" href="#/history?user=' + encodeURIComponent(u.user_id) + '&from=">이력에서 보기</a></div>' + A.txTable(d.transactions) + '</div>';
      A.bindPhotoOpen(view);
    }).catch(function (e) { A.err(view, e); });
  };

  // ---------------- 시스템 설정 ----------------
  A.views.settings = function (view) {
    A.setTitle('시스템 설정');
    if (!A.can('admin')) { view.innerHTML = '<div class="card"><div class="empty">관리자만 접근할 수 있습니다.</div></div>'; return; }
    A.loading(view);
    Promise.all([Api.call('settings.get', {}), Api.call('admin.info', {})]).then(function (res) {
      var s = res[0], info = res[1];
      function save(action, payload, msg) {
        return Api.call(action, Object.assign({ request_id: A.req() }, payload)).then(function () { C.toast(msg || '저장됨'); return A.refreshBoot(); }).then(function () { A.views.settings(view); });
      }
      view.innerHTML = '<div class="dash-grid" style="grid-template-columns:1fr 1fr">' +
        '<div class="card"><div class="card-head"><h3>카테고리</h3><span class="small muted">코드는 관리번호에 쓰입니다 (C2-<b>PJ</b>-001)</span></div><table class="tbl"><thead><tr><th>코드</th><th>이름</th><th class="right">장비</th><th></th></tr></thead><tbody>' +
        s.categories.map(function (c) {
          return '<tr><td class="mono"><b>' + esc(c.code) + '</b></td><td>' + esc(c.name) + '</td><td class="right">' + c.count + '</td><td class="right nowrap"><button class="btn sm" data-cren="' + esc(c.code) + '">이름 변경</button>' + (c.count ? '' : ' <button class="btn sm danger" data-cdel="' + esc(c.code) + '">' + icon('trash') + '</button>') + '</td></tr>';
        }).join('') + '<tr><td><input class="input mono" id="c-code" maxlength="2" placeholder="예: LT" style="min-height:32px;width:70px;text-transform:uppercase"></td><td><input class="input" id="c-name" placeholder="새 카테고리 이름" style="min-height:32px"></td><td></td><td class="right"><button class="btn sm primary" id="c-add">추가</button></td></tr></tbody></table></div>' +
        '<div class="card"><div class="card-head"><h3>보관 위치</h3></div><table class="tbl"><thead><tr><th>위치</th><th class="right">장비</th><th></th></tr></thead><tbody>' +
        s.locations.map(function (l) {
          return '<tr><td>' + esc(l.name) + '</td><td class="right">' + l.count + '</td><td class="right nowrap"><button class="btn sm" data-lren="' + esc(l.key) + '" data-name="' + esc(l.name) + '">이름 변경</button>' + (l.count ? '' : ' <button class="btn sm danger" data-ldel="' + esc(l.key) + '">' + icon('trash') + '</button>') + '</td></tr>';
        }).join('') + '<tr><td><input class="input" id="l-name" placeholder="새 보관 위치" style="min-height:32px"></td><td></td><td class="right"><button class="btn sm primary" id="l-add">추가</button></td></tr></tbody></table></div>' +
        '<div class="card"><div class="card-head"><h3>기본값</h3></div><div class="card-pad stack">' +
        '<div class="row"><label class="grow">기본 반납 기간 (일)</label><input class="input" id="sy-due" type="number" min="1" max="365" value="' + esc(s.system.DEFAULT_DUE_DAYS) + '" style="width:100px"><button class="btn sm" data-sys="DEFAULT_DUE_DAYS" data-src="sy-due">저장</button></div>' +
        '<div class="row"><label class="grow">반납 이상 시 사진 필수</label><select class="input" id="sy-ph" style="width:100px"><option value="TRUE"' + (s.system.REQUIRE_PHOTO_ON_ISSUE === 'TRUE' ? ' selected' : '') + '>필수</option><option value="FALSE"' + (s.system.REQUIRE_PHOTO_ON_ISSUE !== 'TRUE' ? ' selected' : '') + '>선택</option></select><button class="btn sm" data-sys="REQUIRE_PHOTO_ON_ISSUE" data-src="sy-ph">저장</button></div>' +
        '<div class="row"><label class="grow">라벨 인쇄 가로 보정 (mm)</label><input class="input" id="sy-ox" type="number" step="0.5" value="' + esc(s.system.LABEL_OFFSET_X_MM) + '" style="width:100px"><button class="btn sm" data-sys="LABEL_OFFSET_X_MM" data-src="sy-ox">저장</button></div>' +
        '<div class="row"><label class="grow">라벨 인쇄 세로 보정 (mm)</label><input class="input" id="sy-oy" type="number" step="0.5" value="' + esc(s.system.LABEL_OFFSET_Y_MM) + '" style="width:100px"><button class="btn sm" data-sys="LABEL_OFFSET_Y_MM" data-src="sy-oy">저장</button></div></div></div>' +
        '<div class="card"><div class="card-head"><h3>데이터 관리</h3></div><div class="card-pad stack">' +
        '<div class="row"><div class="grow"><b>정합성 검사</b><div class="small muted">마스터와 이력 불일치, 중복, 누락 참조 등을 검사합니다.</div></div><button class="btn" id="d-check">검사</button></div>' +
        '<div class="row"><div class="grow"><b>백업</b><div class="small muted">스프레드시트 전체 사본을 백업 폴더에 만듭니다.</div></div><button class="btn" id="d-backup">지금 백업</button></div>' +
        '<div class="row"><div class="grow"><b>원본 스프레드시트</b><div class="small muted">' + esc(info.spreadsheet_name) + ' · 스키마 v' + esc(info.schema_version) + ' · 앱 v' + esc(info.app_version) + ' · ' + esc(info.data_env) + '</div></div><a class="btn" target="_blank" rel="noopener" href="' + esc(info.spreadsheet_url) + '">열기</a></div><div id="d-res"></div></div></div>' +
        '<div class="card" style="grid-column:1/-1"><div class="card-head"><h3>' + icon('shield') + ' 인증 진단 (배포 검증용)</h3></div><div class="card-pad">' +
        '<div class="diag-row"><span class="badge b-available">' + icon('check') + '통과</span><div class="grow">서버가 이 요청의 Google ID Token 서명·발급자·대상·만료를 검증했습니다.</div></div>' +
        '<div class="diag-row"><span class="muted small" style="width:120px">발급자(iss)</span><span class="mono small">' + esc(info.token_check.iss) + '</span></div>' +
        '<div class="diag-row"><span class="muted small" style="width:120px">Google ID(sub)</span><span class="mono small">' + esc(info.token_check.sub) + '</span></div>' +
        '<div class="diag-row"><span class="muted small" style="width:120px">이메일</span><span class="small">' + esc(info.token_check.email) + ' (' + (info.token_check.email_verified ? '확인됨' : '미확인') + ')</span></div>' +
        '<div class="diag-row"><span class="muted small" style="width:120px">토큰 만료</span><span class="small">' + esc(new Date(info.token_check.exp * 1000).toLocaleString('ko-KR')) + '</span></div>' +
        '<div class="diag-row"><span class="muted small" style="width:120px">Client ID 설정</span><span class="small">' + (info.client_id_set ? '설정됨' : '<b style="color:var(--st-danger)">미설정</b>') + '</span></div>' +
        '<p class="small muted" style="margin-bottom:0">개인 Gmail 직원 계정으로 모바일에서 로그인 → 반출 1건 → 이 화면의 입출고 이력에서 처리자 이메일 확인까지 해야 배포 검증 완료입니다. (DEPLOY.md 체크리스트)</p></div></div></div>';
      C.$('#c-add').onclick = function () { save('settings.saveCategory', { code: C.$('#c-code').value.trim().toUpperCase(), name: C.$('#c-name').value.trim() }, '카테고리 추가됨').catch(C.showError); };
      C.$$('[data-cren]', view).forEach(function (b) {
        b.onclick = function () {
          var code = b.getAttribute('data-cren');
          var nm = prompt('새 이름 (' + code + ')');
          if (nm && nm.trim()) save('settings.saveCategory', { code: code, name: nm.trim() }, '변경됨').catch(C.showError);
        };
      });
      C.$$('[data-cdel]', view).forEach(function (b) { b.onclick = function () { save('settings.deleteCategory', { code: b.getAttribute('data-cdel') }, '삭제됨').catch(C.showError); }; });
      C.$('#l-add').onclick = function () { save('settings.saveLocation', { name: C.$('#l-name').value.trim() }, '위치 추가됨').catch(C.showError); };
      C.$$('[data-lren]', view).forEach(function (b) {
        b.onclick = function () {
          var nm = prompt('새 이름', b.getAttribute('data-name'));
          if (nm && nm.trim()) save('settings.saveLocation', { key: b.getAttribute('data-lren'), name: nm.trim() }, '변경됨 — 해당 위치 장비도 함께 갱신').catch(C.showError);
        };
      });
      C.$$('[data-ldel]', view).forEach(function (b) { b.onclick = function () { save('settings.deleteLocation', { key: b.getAttribute('data-ldel') }, '삭제됨').catch(C.showError); }; });
      C.$$('[data-sys]', view).forEach(function (b) { b.onclick = function () { save('settings.saveSystem', { key: b.getAttribute('data-sys'), value: C.$('#' + b.getAttribute('data-src')).value }).catch(C.showError); }; });
      function showReport(rep, extra) {
        C.$('#d-res').innerHTML = (extra || '') + '<div class="small muted" style="margin-bottom:8px">' + esc(C.fmtDateTime(rep.checked_at)) + ' · 장비 ' + rep.totals.assets + ' · 이력 ' + rep.totals.transactions + '</div>' +
          (rep.issues.length ? rep.issues.map(function (i) {
            return '<div class="issue-row ' + i.level + '"><b>' + esc(i.message) + '</b> (' + i.count + ')<div class="mono small">' + esc(i.ids.join(', ')) + (i.count > i.ids.length ? ' …' : '') + '</div></div>';
          }).join('') + '<button class="btn primary" id="d-repair">이력 기준 복구 실행</button>' : '<div class="notice good">' + icon('check') + '문제가 발견되지 않았습니다.</div>');
        var rb = C.$('#d-repair');
        if (rb) rb.onclick = function () {
          var hasNoHist = rep.issues.some(function (i) { return i.code === 'NO_HISTORY'; });
          C.confirmDialog('복구', '마지막 이력(after_json)을 기준으로 장비 상태를 맞춥니다.' + (hasNoHist ? '<br><label class="check" style="margin-top:10px"><input type="checkbox" id="bl"> 이력 없는 장비에 기준선 등록 이력 추가</label>' : ''), '복구 실행').then(function (ok) {
            if (!ok) return;
            var bl = C.$('#bl'); var baseline = bl ? bl.checked : false;
            C.busy(rb, true);
            Api.call('admin.repair', { request_id: A.req(), baseline: baseline }).then(function (d) {
              A.assets = null;
              showReport(d.report, '<div class="notice good" style="margin-bottom:8px">' + icon('check') + '복구 ' + d.repaired_count + '건 · 기준선 ' + d.baselined + '건</div>');
            }).catch(function (e) { C.busy(rb, false); C.showError(e); });
          });
        };
      }
      C.$('#d-check').onclick = function () {
        var b = this; C.busy(b, true);
        Api.call('admin.integrityCheck', {}).then(function (rep) { C.busy(b, false); showReport(rep); }).catch(function (e) { C.busy(b, false); C.showError(e); });
      };
      C.$('#d-backup').onclick = function () {
        var b = this; C.busy(b, true);
        Api.call('admin.backup', {}).then(function (r) { C.busy(b, false); C.$('#d-res').innerHTML = '<div class="notice good">' + icon('check') + '<div>백업 완료: ' + esc(r.name) + '</div></div>'; }).catch(function (e) { C.busy(b, false); C.showError(e); });
      };
    }).catch(function (e) { A.err(view, e); });
  };

  A.boot0();
})();
