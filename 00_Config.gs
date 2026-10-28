/**
 * C2 EQUIPMENT MANAGER — 설정 및 스키마 정의
 * 모든 .gs 파일은 Apps Script에서 하나의 전역 스코프를 공유한다.
 */

var APP = {
  NAME: 'C2 EQUIPMENT MANAGER',
  VERSION: '1.0.0',
  SCHEMA_VERSION: 1,
  TZ: 'Asia/Seoul',
  LOCK_WAIT_MS: 25000,
  MAX_BATCH: 200,            // 한 번에 반출/반납 가능한 최대 장비 수
  MAX_IMPORT_ROWS: 1500,     // CSV 1회 가져오기 최대 행
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  MAX_PENDING_USERS: 200,    // 승인 대기 계정 최대 수 (스팸 방지)
  IDEMPOTENCY_TTL_SEC: 21600 // 6시간
};

// Google ID Token 검증 상수 (운영 코드 — 로컬에서도 동일 코드가 실행된다)
var GOOGLE_AUTH = {
  JWKS_URL: 'https://www.googleapis.com/oauth2/v3/certs',
  ISSUERS: ['accounts.google.com', 'https://accounts.google.com'],
  CLOCK_SKEW_SEC: 120,
  JWKS_CACHE_KEY: 'google_jwks_v3'
};

var STATUS = {
  AVAILABLE: 'AVAILABLE',     // 보유
  CHECKED_OUT: 'CHECKED_OUT', // 반출
  INSPECTION: 'INSPECTION',   // 점검
  REPAIR: 'REPAIR',           // 수리
  DAMAGED: 'DAMAGED',         // 파손
  LOST: 'LOST',               // 분실
  RETIRED: 'RETIRED'          // 폐기/비활성
};
var STATUS_LABEL = {
  AVAILABLE: '보유', CHECKED_OUT: '반출', INSPECTION: '점검', REPAIR: '수리',
  DAMAGED: '파손', LOST: '분실', RETIRED: '폐기'
};

var ACTION = {
  REGISTER: 'REGISTER', CHECKOUT: 'CHECKOUT', RETURN: 'RETURN', TRANSFER: 'TRANSFER',
  INSPECT: 'INSPECT', REPAIR: 'REPAIR', LOST: 'LOST', RETIRE: 'RETIRE',
  CORRECTION: 'CORRECTION',
  EDIT: 'EDIT' // 확장: 장비 정보 수정 기록(상태 변화 없음)
};

var PROJECT_STATUS = { PLANNED: '준비', ACTIVE: '진행', DONE: '완료', CANCELLED: '취소' };

var ROLES = ['ADMIN', 'MANAGER', 'STAFF', 'VIEWER'];
var ROLE_PERMS = {
  ADMIN:   { read: 1, operate: 1, manage: 1, admin: 1 },
  MANAGER: { read: 1, operate: 1, manage: 1 },
  STAFF:   { read: 1, operate: 1 },
  VIEWER:  { read: 1 }
};

// 장비 상태 필드 — 이력(after_json)으로부터 재구성 가능한 필드
var STATE_FIELDS = ['current_status', 'current_location', 'current_project_id',
  'current_user_id', 'return_due_date'];

/**
 * 테이블 스키마. cols 순서가 신규 시트의 열 순서가 된다.
 * 기존 시트는 헤더 이름으로 매핑하므로 열 순서를 바꾸거나 열을 추가해도 동작한다.
 */
var TABLES = {
  ASSETS: {
    sheet: '01_장비마스터', key: 'asset_id',
    cols: ['asset_id', 'asset_name', 'category', 'manufacturer', 'model', 'serial_number',
      'purchase_date', 'purchase_price', 'photo_url', 'home_location', 'current_location',
      'current_status', 'current_project_id', 'current_user_id', 'return_due_date', 'set_id',
      'qr_value', 'notes', 'created_at', 'updated_at', 'version'],
    numbers: ['purchase_price', 'version']
  },
  TX: {
    sheet: '02_입출고이력', key: 'transaction_id',
    cols: ['transaction_id', 'request_id', 'checkout_group_id', 'asset_id', 'action_type',
      'project_id', 'actor_user_id', 'receiver_user_id', 'timestamp', 'due_date', 'condition',
      'location', 'photo_url', 'notes', 'previous_status', 'new_status', 'correction_of',
      // 확장 열: 처리자 정보 스냅샷 + 수정 전후 상태 (복구/정정에 사용)
      'actor_name', 'actor_email', 'receiver_name', 'before_json', 'after_json'],
    numbers: []
  },
  PROJECTS: {
    sheet: '03_프로젝트', key: 'project_id',
    cols: ['project_id', 'project_name', 'client', 'location', 'start_date', 'end_date',
      'manager_id', 'status', 'notes', 'created_at', 'updated_at'],
    numbers: []
  },
  USERS: {
    sheet: '04_사용자', key: 'user_id',
    // user_id = 검증된 Google 계정 sub. 초대만 된 계정은 'INVITE:<email>'
    cols: ['user_id', 'email', 'name', 'department', 'role', 'active', 'created_at',
      'status', 'google_name', 'last_login_at', 'approved_by', 'updated_at'],
    bools: ['active'],
    numbers: []
  },
  SETS: {
    sheet: '05_장비세트', key: null,
    cols: ['set_id', 'set_name', 'asset_id', 'quantity', 'required', 'notes'],
    bools: ['required'],
    numbers: ['quantity']
  },
  INSPECTIONS: {
    sheet: '06_점검관리', key: 'inspection_id',
    cols: ['inspection_id', 'asset_id', 'type', 'condition', 'description', 'photo_url',
      'reported_by', 'inspected_by', 'reported_at', 'resolved_at', 'resolution', 'status'],
    numbers: []
  },
  SETTINGS: {
    sheet: '07_설정', key: null,
    cols: ['setting_key', 'setting_value', 'category', 'updated_at'],
    numbers: []
  }
};

var DEFAULT_CATEGORIES = [
  ['PJ', '프로젝터'], ['LN', '렌즈'], ['SP', '스피커'], ['SV', '서버'],
  ['MN', '모니터'], ['CB', '케이블'], ['CT', '컨트롤 장비'], ['ET', '기타 장비']
];
var DEFAULT_LOCATIONS = ['본사 창고 A', '본사 창고 B', '사무실'];
var DEFAULT_SYSTEM_SETTINGS = {
  DEFAULT_DUE_DAYS: '7',
  REQUIRE_PHOTO_ON_ISSUE: 'TRUE',
  LABEL_OFFSET_X_MM: '0',
  LABEL_OFFSET_Y_MM: '0'
};
