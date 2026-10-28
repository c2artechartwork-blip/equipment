/**
 * Google Sheets Adapter — 배포용 데이터 접근 계층.
 * 로컬 개발환경에서는 이 코드가 그대로 실행되고, SpreadsheetApp 만 Mock 으로 교체된다
 * (local/mock-gas.js). 즉 로컬 테스트가 곧 이 어댑터의 테스트다.
 *
 * - 헤더 이름으로 열을 매핑한다 (열 순서 변경/열 추가에 안전)
 * - 실행 단위 메모리 캐시(memo)를 두고, 쓰기 후 메모를 갱신한다
 * - 모든 쓰기는 호출측이 withLock_() 안에서 수행해야 한다
 */
var DB = (function () {
  var memo = {};
  var ssObj = null;

  function spreadsheet() {
    if (ssObj) return ssObj;
    var id = getProp_('SPREADSHEET_ID');
    if (!id) throw AppError('NOT_CONFIGURED', '데이터 시트가 연결되지 않았습니다. 관리자가 setup()을 실행해야 합니다.');
    ssObj = SpreadsheetApp.openById(id);
    return ssObj;
  }

  function def(tbl) {
    var d = TABLES[tbl];
    if (!d) throw new Error('Unknown table ' + tbl);
    return d;
  }

  function sheet(tbl) {
    var sh = spreadsheet().getSheetByName(def(tbl).sheet);
    if (!sh) throw AppError('NOT_CONFIGURED', '시트 "' + def(tbl).sheet + '" 이(가) 없습니다. setup()을 실행해 주세요.');
    return sh;
  }

  function normCell(tbl, field, v) {
    var d = def(tbl);
    if (v instanceof Date) {
      var t = Utilities.formatDate(v, APP.TZ, 'HH:mm:ss');
      v = t === '00:00:00' ? Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd')
        : Utilities.formatDate(v, APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
    if (d.bools && d.bools.indexOf(field) >= 0) return toBool_(v);
    if (d.numbers && d.numbers.indexOf(field) >= 0) {
      if (v === '' || v === null || v === undefined) return '';
      var n = Number(v);
      return isNaN(n) ? '' : n;
    }
    return v === null || v === undefined ? '' : String(v);
  }

  function serialize(v) {
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return v;
    if (typeof v === 'object') return cellSafe_(JSON.stringify(v));
    return cellSafe_(String(v));
  }

  function headerOf(tbl) {
    var m = load(tbl);
    return m.hdr;
  }

  function rowToObj(tbl, hdr, row, rowNum) {
    var o = {};
    for (var c = 0; c < hdr.length; c++) {
      if (!hdr[c]) continue;
      o[hdr[c]] = normCell(tbl, hdr[c], row[c]);
    }
    o.__row = rowNum;
    return o;
  }

  function isBlank(row) {
    for (var i = 0; i < row.length; i++) if (row[i] !== '' && row[i] !== null) return false;
    return true;
  }

  function load(tbl) {
    if (memo[tbl] && memo[tbl].full) return memo[tbl];
    var sh = sheet(tbl);
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 1) throw AppError('NOT_CONFIGURED', def(tbl).sheet + ' 헤더가 없습니다. setup()을 실행해 주세요.');
    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    var hdr = values[0].map(str_);
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      if (isBlank(values[r])) continue;
      rows.push(rowToObj(tbl, hdr, values[r], r + 1));
    }
    memo[tbl] = { full: true, sh: sh, hdr: hdr, rows: rows, lastRow: lastRow };
    return memo[tbl];
  }

  function header(tbl) {
    if (memo[tbl]) return memo[tbl].hdr;
    var sh = sheet(tbl);
    var lastCol = sh.getLastColumn();
    var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_);
    memo[tbl] = { full: false, sh: sh, hdr: hdr, lastRow: sh.getLastRow() };
    return hdr;
  }

  function objToRow(hdr, obj) {
    return hdr.map(function (h) { return h ? serialize(obj[h]) : ''; });
  }

  return {
    spreadsheet: spreadsheet,
    sheet: sheet,
    invalidate: function () { memo = {}; },

    /** 전체 행 (복사본이 아닌 메모 객체 — 수정 시 update() 사용) */
    all: function (tbl) { return load(tbl).rows; },

    find: function (tbl, field, value) {
      var rows = load(tbl).rows;
      for (var i = 0; i < rows.length; i++) if (rows[i][field] === value) return rows[i];
      return null;
    },

    filter: function (tbl, fn) { return load(tbl).rows.filter(fn); },

    /** 단일 열 값 (행 2..마지막). 대용량 이력 시트에서 전체 로드 없이 검색할 때 사용 */
    column: function (tbl, field) {
      if (memo[tbl] && memo[tbl].full) {
        return memo[tbl].rows.map(function (r) { return { row: r.__row, value: r[field] }; });
      }
      var hdr = header(tbl);
      var c = hdr.indexOf(field);
      if (c < 0) return [];
      var m = memo[tbl];
      var last = m.sh.getLastRow();
      if (last < 2) return [];
      var vals = m.sh.getRange(2, c + 1, last - 1, 1).getValues();
      var out = [];
      for (var i = 0; i < vals.length; i++) out.push({ row: i + 2, value: str_(vals[i][0]) });
      return out;
    },

    /** 지정한 행 번호들의 객체 */
    rowsAt: function (tbl, rowNums) {
      if (!rowNums.length) return [];
      if ((memo[tbl] && memo[tbl].full) || rowNums.length > 60) {
        var byRow = {};
        load(tbl).rows.forEach(function (r) { byRow[r.__row] = r; });
        return rowNums.map(function (n) { return byRow[n]; }).filter(Boolean);
      }
      var hdr = header(tbl);
      var sh = memo[tbl].sh;
      var sorted = rowNums.slice().sort(function (a, b) { return a - b; });
      var out = {};
      var i = 0;
      while (i < sorted.length) {
        var start = sorted[i], end = start;
        while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { i++; end++; }
        var vals = sh.getRange(start, 1, end - start + 1, hdr.length).getValues();
        for (var k = 0; k < vals.length; k++) out[start + k] = rowToObj(tbl, hdr, vals[k], start + k);
        i++;
      }
      return rowNums.map(function (n) { return out[n]; }).filter(Boolean);
    },

    /** 마지막 n개 행 */
    tail: function (tbl, n) {
      if (memo[tbl] && memo[tbl].full) return memo[tbl].rows.slice(-n);
      var hdr = header(tbl);
      var sh = memo[tbl].sh;
      var last = sh.getLastRow();
      if (last < 2) return [];
      var start = Math.max(2, last - n + 1);
      var vals = sh.getRange(start, 1, last - start + 1, hdr.length).getValues();
      var out = [];
      for (var k = 0; k < vals.length; k++) if (!isBlank(vals[k])) out.push(rowToObj(tbl, hdr, vals[k], start + k));
      return out;
    },

    count: function (tbl) {
      var sh = sheet(tbl);
      return Math.max(0, sh.getLastRow() - 1);
    },

    /** 행 추가 (한 번의 setValues) */
    insert: function (tbl, objs) {
      if (!objs.length) return [];
      var hdr = header(tbl);
      var m = memo[tbl];
      var sh = m.sh;
      var start = sh.getLastRow() + 1;
      var values = objs.map(function (o) { return objToRow(hdr, o); });
      sh.getRange(start, 1, values.length, hdr.length).setValues(values);
      var created = values.map(function (v, i) { return rowToObj(tbl, hdr, v, start + i); });
      if (m.full) m.rows = m.rows.concat(created);
      m.lastRow = start + values.length - 1;
      return created;
    },

    /** 행 갱신. obj.__row 필수. 연속된 행은 묶어서 쓴다 */
    update: function (tbl, objs) {
      if (!objs.length) return;
      var hdr = header(tbl);
      var sh = memo[tbl].sh;
      var sorted = objs.slice().sort(function (a, b) { return a.__row - b.__row; });
      sorted.forEach(function (o) { if (!o.__row || o.__row < 2) throw new Error('update without __row'); });
      var i = 0;
      while (i < sorted.length) {
        var start = sorted[i].__row, block = [objToRow(hdr, sorted[i])];
        while (i + 1 < sorted.length && sorted[i + 1].__row === start + block.length) {
          i++;
          block.push(objToRow(hdr, sorted[i]));
        }
        sh.getRange(start, 1, block.length, hdr.length).setValues(block);
        i++;
      }
      // 메모 갱신
      var m = memo[tbl];
      if (m.full) {
        var byRow = {};
        objs.forEach(function (o) { byRow[o.__row] = rowToObj(tbl, hdr, objToRow(hdr, o), o.__row); });
        m.rows = m.rows.map(function (r) { return byRow[r.__row] || r; });
      }
    },

    /** 행 삭제 (세트 구성/설정 편집에만 사용, 이력·장비에는 사용하지 않음) */
    remove: function (tbl, objs) {
      var sh = sheet(tbl);
      objs.map(function (o) { return o.__row; }).sort(function (a, b) { return b - a; })
        .forEach(function (r) { sh.deleteRow(r); });
      delete memo[tbl];
    },

    headerOf: headerOf
  };
})();
