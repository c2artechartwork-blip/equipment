/** 점검 / 수리 관리 */

registerApi_('inspections.list', 'read', function (ctx, p) {
  var assets = indexBy_(DB.all('ASSETS'), 'asset_id');
  var users = indexBy_(DB.all('USERS'), 'user_id');
  var rows = DB.all('INSPECTIONS').filter(function (i) {
    if (p.status === 'OPEN') return i.status !== 'RESOLVED';
    if (p.status === 'RESOLVED') return i.status === 'RESOLVED';
    return true;
  });
  return {
    inspections: rows.map(function (i) {
      var o = stripMeta_(i);
      o.asset_name = assets[i.asset_id] ? assets[i.asset_id].asset_name : '';
      o.asset_status = assets[i.asset_id] ? assets[i.asset_id].current_status : '';
      o.reported_by_name = users[i.reported_by] ? users[i.reported_by].name : '';
      o.inspected_by_name = users[i.inspected_by] ? users[i.inspected_by].name : '';
      return o;
    }).reverse()
  };
});

/** 점검/수리 접수 (보유·점검 상태 장비) */
registerApi_('inspections.report', 'operate', function (ctx, p) {
  var id = str_(p.asset_id).toUpperCase();
  var type = p.type === 'REPAIR' ? 'REPAIR' : 'INSPECT';
  if (!str_(p.description)) throw AppError('VALIDATION', '내용을 입력해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var a = DB.find('ASSETS', 'asset_id', id);
    if (!a) throw AppError('NOT_FOUND', '장비를 찾을 수 없습니다.');
    if (a.current_status === STATUS.CHECKED_OUT) throw AppError('VALIDATION', '반출 중인 장비는 반납 시 "이상 있음"으로 접수해 주세요.');
    if ([STATUS.LOST, STATUS.RETIRED].indexOf(a.current_status) >= 0) throw AppError('VALIDATION', '분실/폐기 장비는 점검 접수할 수 없습니다.');
    var insId = 'INS-' + stampCompact_() + '-' + shortId_().slice(0, 6);
    var newStatus = type === 'REPAIR' ? STATUS.REPAIR : STATUS.INSPECTION;
    commitChanges_(ctx, p.request_id, [{
      asset: a, action: type === 'REPAIR' ? ACTION.REPAIR : ACTION.INSPECT,
      state: { current_status: newStatus, current_location: a.current_location || a.home_location },
      condition: clip_(p.condition, 40), photo_url: str_(p.photo_url), notes: '[' + insId + '] ' + clip_(p.description, 900)
    }], '');
    DB.insert('INSPECTIONS', [{
      inspection_id: insId, asset_id: id, type: type, condition: clip_(p.condition, 40),
      description: clip_(p.description, 1000), photo_url: str_(p.photo_url), reported_by: ctx.user.user_id,
      inspected_by: '', reported_at: nowIso_(), resolved_at: '', resolution: '', status: 'OPEN'
    }]);
    return { inspection_id: insId };
  });
});

/**
 * 진행/처리: outcome = AVAILABLE(정상 복귀) | REPAIR(수리 진행) | DAMAGED | RETIRED | LOST | IN_PROGRESS(메모만)
 */
registerApi_('inspections.resolve', 'manage', function (ctx, p) {
  var outcome = str_(p.outcome);
  var allowed = ['AVAILABLE', 'REPAIR', 'DAMAGED', 'RETIRED', 'LOST', 'IN_PROGRESS'];
  if (allowed.indexOf(outcome) < 0) throw AppError('VALIDATION', '처리 결과를 선택해 주세요.');
  if (!str_(p.resolution)) throw AppError('VALIDATION', '처리 내용을 입력해 주세요.');
  return idempotent_(ctx, p.request_id, function () {
    var ins = DB.find('INSPECTIONS', 'inspection_id', str_(p.inspection_id));
    if (!ins) throw AppError('NOT_FOUND', '점검 기록을 찾을 수 없습니다.');
    if (ins.status === 'RESOLVED') throw AppError('VALIDATION', '이미 처리 완료된 점검입니다.');
    var a = DB.find('ASSETS', 'asset_id', ins.asset_id);
    var finalOutcome = ['AVAILABLE', 'DAMAGED', 'RETIRED', 'LOST'].indexOf(outcome) >= 0;
    if (a && outcome !== 'IN_PROGRESS' && a.current_status !== outcome && a.current_status !== STATUS.CHECKED_OUT) {
      var act = { AVAILABLE: ACTION.INSPECT, REPAIR: ACTION.REPAIR, DAMAGED: ACTION.INSPECT, RETIRED: ACTION.RETIRE, LOST: ACTION.LOST }[outcome];
      commitChanges_(ctx, p.request_id, [{
        asset: a, action: act,
        state: { current_status: outcome, current_location: a.home_location || a.current_location },
        notes: '[' + ins.inspection_id + '] ' + clip_(p.resolution, 900)
      }], '');
    }
    DB.update('INSPECTIONS', [Object.assign({}, ins, {
      inspected_by: ctx.user.user_id,
      resolution: clip_((ins.resolution ? ins.resolution + '\n' : '') + nowIso_().slice(0, 16) + ' ' + p.resolution, 2000),
      status: finalOutcome ? 'RESOLVED' : 'IN_PROGRESS',
      resolved_at: finalOutcome ? nowIso_() : ''
    })]);
    return { inspection_id: ins.inspection_id, status: finalOutcome ? 'RESOLVED' : 'IN_PROGRESS' };
  });
});
