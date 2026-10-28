/**
 * 데모(테스트) 데이터 — 운영 데이터와 분리
 *
 * 스크립트 속성 DATA_ENV=DEMO 인 별도 Apps Script/스프레드시트에서만 동작한다.
 * 운영 시트(DATA_ENV 미설정 또는 PRODUCTION)에서는 실행이 거부된다.
 */
function seedDemoData() {
  if (getProp_('DATA_ENV') !== 'DEMO') throw new Error('DATA_ENV=DEMO 인 데모 환경에서만 실행할 수 있습니다. 운영 시트에는 데모 데이터를 넣지 않습니다.');
  return withLock_(function () {
    if (DB.all('ASSETS').length) throw new Error('이미 장비 데이터가 있습니다. 빈 데모 시트에서 실행하세요.');
    var count = Number(getProp_('DEMO_ASSET_COUNT', '120'));
    var ctx = { user: { user_id: 'demo-seed', name: '데모 시드', email: '' }, claims: {} };
    var locs = getLocations_();
    var catalog = {
      PJ: [['Panasonic', 'PT-RZ120', '레이저 프로젝터 12K'], ['Epson', 'EB-PU2010', '레이저 프로젝터 10K'], ['Christie', 'D20WU-HS', '레이저 프로젝터 20K']],
      LN: [['Panasonic', 'ET-D75LE6', '줌 렌즈'], ['Panasonic', 'ET-D75LE95', '초단초점 렌즈'], ['Epson', 'ELPLX02', '초단초점 렌즈']],
      SP: [['d&b', 'E8', '패시브 스피커'], ['Genelec', '8040B', '액티브 모니터'], ['Meyer Sound', 'UPJ-1P', '액티브 스피커']],
      SV: [['Disguise', 'vx 2', '미디어 서버'], ['Mac', 'Studio M2 Max', '미디어 PC'], ['BrightSign', 'XT1144', '미디어 플레이어']],
      MN: [['LG', '55UH5J', '55" 사이니지'], ['Samsung', 'QM75B', '75" 사이니지'], ['Dell', 'U2723QE', '27" 모니터']],
      CB: [['Belden', 'Cat6A 30m', 'LAN 케이블 30m'], ['Neutrik', 'SDI 50m', 'SDI 케이블 50m'], ['Ugreen', 'HDMI 10m', 'HDMI 케이블 10m']],
      CT: [['Crestron', 'CP4N', '컨트롤 프로세서'], ['Elgato', 'Stream Deck XL', '컨트롤 패드'], ['Brainboxes', 'ES-246', 'IO 컨트롤러']],
      ET: [['Pelican', '1650', '하드 케이스'], ['Manfrotto', '1004BAC', '라이트 스탠드'], ['APC', 'SMT1500', 'UPS']]
    };
    var codes = Object.keys(catalog);
    var rows = [];
    for (var i = 0; i < count; i++) {
      var code = codes[i % codes.length];
      var it = catalog[code][Math.floor(i / codes.length) % catalog[code].length];
      rows.push({
        category: code, asset_name: it[2], manufacturer: it[0], model: it[1],
        serial_number: 'DEMO-' + code + '-' + (10000 + i), purchase_date: '2024-0' + (1 + (i % 9)) + '-15',
        purchase_price: String((i % 10 + 1) * 350000), home_location: locs[i % locs.length], notes: '데모 데이터'
      });
    }
    var report = prepareNewAssets_(rows);
    var bad = report.filter(function (r) { return r.errors.length; });
    if (bad.length) throw new Error('데모 데이터 오류: ' + bad[0].errors.join(','));
    commitChanges_(ctx, 'demo-seed-' + shortId_(), report.map(function (r) {
      return { asset: newAssetRecord_(r.wantId, r.code, r.info), isNew: true, action: ACTION.REGISTER, notes: '데모 등록' };
    }), '');
    var y = todayStr_().slice(0, 4);
    DB.insert('PROJECTS', [
      { project_id: 'PRJ-' + y + '-001', project_name: '[데모] 미디어아트 전시', client: '데모 클라이언트', location: '서울 성수 전시장', start_date: todayStr_(), end_date: addDaysStr_(todayStr_(), 30), manager_id: '', status: 'ACTIVE', notes: '', created_at: nowIso_(), updated_at: nowIso_() },
      { project_id: 'PRJ-' + y + '-002', project_name: '[데모] 재즈 페스티벌 스테이지', client: '데모 페스티벌', location: '가평 야외무대', start_date: todayStr_(), end_date: addDaysStr_(todayStr_(), 10), manager_id: '', status: 'ACTIVE', notes: '', created_at: nowIso_(), updated_at: nowIso_() },
      { project_id: 'PRJ-' + y + '-003', project_name: '[데모] 브랜드 팝업', client: '데모 브랜드', location: '부산 팝업스토어', start_date: addDaysStr_(todayStr_(), 14), end_date: addDaysStr_(todayStr_(), 28), manager_id: '', status: 'PLANNED', notes: '', created_at: nowIso_(), updated_at: nowIso_() }
    ]);
    // 데모 세트: 프로젝터 + 렌즈 + 케이블 + 케이스
    var setItems = ['C2-PJ-001', 'C2-LN-001', 'C2-CB-001', 'C2-ET-001'];
    DB.insert('SETS', setItems.map(function (id, i) {
      return { set_id: 'SET-001', set_name: '[데모] 프로젝터 세트 A', asset_id: id, quantity: 1, required: i < 2, notes: '' };
    }));
    var changes = setItems.map(function (id) {
      return { asset: DB.find('ASSETS', 'asset_id', id), action: ACTION.EDIT, info: { set_id: 'SET-001' }, notes: '데모 세트 편입' };
    });
    commitChanges_(ctx, 'demo-set-' + shortId_(), changes, '');
    return { assets: count };
  });
}
