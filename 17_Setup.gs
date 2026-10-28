/**
 * 최초 설치 / 마이그레이션 — Apps Script 편집기에서 관리자가 직접 실행한다.
 *
 * 1) 스크립트 속성(프로젝트 설정 → 스크립트 속성)에 GOOGLE_CLIENT_ID 입력
 *    (선택) SPREADSHEET_ID: 기존 시트를 쓸 때. 비우면 새 스프레드시트를 만든다.
 *    (선택) ADMIN_EMAIL: 첫 관리자 Gmail. 비우면 스크립트 소유자 계정.
 * 2) 편집기에서 setup 함수 실행 → 권한 승인
 * 3) 실행 로그의 안내에 따라 웹앱 배포
 * setup() 은 여러 번 실행해도 안전하다(없는 탭/열만 추가).
 */
function setup() {
  var log = [];
  // 1. 스프레드시트
  var ssId = getProp_('SPREADSHEET_ID');
  var ss;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
    log.push('기존 스프레드시트 사용: ' + ss.getName());
  } else {
    ss = SpreadsheetApp.create('C2 EQUIPMENT MANAGER — DATA');
    setProp_('SPREADSHEET_ID', ss.getId());
    log.push('새 스프레드시트 생성: ' + ss.getUrl());
  }
  DB.invalidate();

  // 2. 탭 / 헤더 / 서식
  log = log.concat(ensureSchema_(ss));

  // 3. 사진 / 백업 폴더
  ['PHOTO_FOLDER_ID', 'BACKUP_FOLDER_ID'].forEach(function (k) {
    var fid = getProp_(k);
    var ok = false;
    if (fid) { try { DriveApp.getFolderById(fid); ok = true; } catch (e) { ok = false; } }
    if (!ok) {
      var f = DriveApp.createFolder(k === 'PHOTO_FOLDER_ID' ? 'C2 EQUIPMENT MANAGER — 사진' : 'C2 EQUIPMENT MANAGER — 백업');
      setProp_(k, f.getId());
      log.push('드라이브 폴더 생성: ' + f.getName());
    }
  });

  // 4. 기본 설정값 + 첫 관리자
  withLock_(function () {
    if (!settingRows_('CATEGORY').length) {
      DB.insert('SETTINGS', DEFAULT_CATEGORIES.map(function (c) {
        return { setting_key: c[0], setting_value: c[1], category: 'CATEGORY', updated_at: nowIso_() };
      }));
      log.push('기본 카테고리 생성');
    }
    if (!settingRows_('LOCATION').length) {
      DB.insert('SETTINGS', DEFAULT_LOCATIONS.map(function (n) {
        return { setting_key: 'LOC-' + shortId_().slice(0, 6), setting_value: n, category: 'LOCATION', updated_at: nowIso_() };
      }));
      log.push('기본 보관위치 생성');
    }
    var hasAdmin = DB.filter('USERS', function (u) { return u.role === 'ADMIN' && u.active === true; }).length > 0;
    if (!hasAdmin) {
      var email = normEmail_(getProp_('ADMIN_EMAIL') || Session.getEffectiveUser().getEmail());
      if (!email) throw new Error('ADMIN_EMAIL 스크립트 속성을 입력하세요.');
      DB.insert('USERS', [{
        user_id: 'INVITE:' + email, email: email, name: '관리자', department: '', role: 'ADMIN', active: true,
        created_at: nowIso_(), status: 'INVITED', google_name: '', last_login_at: '', approved_by: 'setup', updated_at: nowIso_()
      }]);
      log.push('첫 관리자 등록(초대): ' + email + ' — 이 Gmail로 웹앱에 로그인하면 연결됩니다.');
    }
  });
  setProp_('SCHEMA_VERSION', APP.SCHEMA_VERSION);
  if (!getProp_('GOOGLE_CLIENT_ID')) log.push('⚠ GOOGLE_CLIENT_ID 스크립트 속성이 비어 있습니다. 로그인 전에 반드시 입력하세요.');
  log.push('완료. 다음: 배포 → 새 배포 → 웹 앱 (실행: 나 / 액세스: 모든 사용자)');
  log.forEach(function (l) { Logger.log(l); });
  return log;
}

/** 탭 생성 + 누락 열 추가(마이그레이션). 기존 데이터는 건드리지 않는다. */
function ensureSchema_(ss) {
  var log = [];
  Object.keys(TABLES).forEach(function (t) {
    var d = TABLES[t];
    var sh = ss.getSheetByName(d.sheet);
    if (!sh) { sh = ss.insertSheet(d.sheet); log.push('탭 생성: ' + d.sheet); }
    var lastCol = sh.getLastColumn();
    var hdr = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_) : [];
    var nonEmpty = hdr.filter(Boolean);
    if (!nonEmpty.length) {
      sh.getRange(1, 1, 1, d.cols.length).setValues([d.cols]);
      hdr = d.cols.slice();
    } else {
      var missing = d.cols.filter(function (c) { return hdr.indexOf(c) < 0; });
      if (missing.length) {
        sh.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
        hdr = hdr.concat(missing);
        log.push(d.sheet + ' 열 추가: ' + missing.join(', '));
      }
    }
    try {
      // 날짜/ID 자동 변환 방지: 전체 텍스트 서식
      sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), hdr.length).setNumberFormat('@');
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, hdr.length).setFontWeight('bold').setBackground('#F5B618');
    } catch (e) { /* 서식 실패는 무시 */ }
  });
  // 새 스프레드시트의 빈 기본 탭 제거
  ss.getSheets().forEach(function (sh) {
    var isOurs = Object.keys(TABLES).some(function (t) { return TABLES[t].sheet === sh.getName(); });
    if (!isOurs && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(sh); } catch (e) { /* noop */ }
    }
  });
  DB.invalidate();
  return log;
}

/** 매일 새벽 3시 자동 백업 트리거 설치 (편집기에서 1회 실행) */
function installDailyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scheduledBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scheduledBackup').timeBased().everyDays(1).atHour(3).create();
  Logger.log('일일 백업 트리거 설치 완료');
}

function scheduledBackup() {
  var r = backupSpreadsheet_('자동');
  // 최근 30개만 보관
  var folder = DriveApp.getFolderById(getProp_('BACKUP_FOLDER_ID'));
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (f.getName().indexOf('[자동]') >= 0) files.push(f); }
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(30).forEach(function (f) { f.setTrashed(true); });
  return r;
}

function backupSpreadsheet_(label) {
  var src = DriveApp.getFileById(getProp_('SPREADSHEET_ID'));
  var folder = DriveApp.getFolderById(getProp_('BACKUP_FOLDER_ID'));
  var name = 'C2EM 백업 [' + label + '] ' + Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH:mm');
  var copy = src.makeCopy(name, folder);
  return { name: name, file_id: copy.getId(), url: copy.getUrl() };
}
