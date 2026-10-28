/* QR 라벨 — A4 자동 배치 (A형 60×40mm, B형 50×25mm) */
(function () {
  'use strict';
  var C = window.C2, esc = C.esc;

  var LAYOUTS = {
    A: { name: 'A형 60×40mm', w: 60, h: 40, cols: 3, rows: 7, mx: 15, my: 8.5, gx: 0, gy: 0 },
    B: { name: 'B형 50×25mm', w: 50, h: 25, cols: 4, rows: 11, mx: 5, my: 11, gx: 0, gy: 0 }
  };

  /** 라벨 1장 HTML (mm 절대배치) */
  function labelHtml(type, item, x, y) {
    var L = LAYOUTS[type];
    var qr = C.qrSvg(item.code, { quiet: 2, ec: 'M' });
    var s = 'left:' + x + 'mm;top:' + y + 'mm;width:' + L.w + 'mm;height:' + L.h + 'mm';
    if (type === 'A') {
      // QR 30mm (모듈+여백), 우측 정보, 하단 옐로우 바
      return '<div class="label" style="' + s + '">' +
        '<div class="lq" style="left:3mm;top:3.5mm;width:30mm;height:30mm">' + qr + '</div>' +
        '<img class="ll" src="logo-h-black-print.png" alt="" style="left:34.5mm;top:4.5mm;width:22.5mm">' +
        '<div class="lid" style="left:34.5mm;top:13mm;font-size:9.5pt">' + esc(item.id) + '</div>' +
        '<div class="lnm" style="left:34.5mm;top:18.5mm;width:23mm;height:14mm;font-size:7pt">' + esc(item.name) + (item.sub ? '<br><span style="font-weight:400;color:#444">' + esc(item.sub) + '</span>' : '') + '</div>' +
        '<div class="lbar" style="left:0;bottom:0;width:100%;height:2.2mm"></div></div>';
    }
    return '<div class="label" style="' + s + '">' +
      '<div class="lbar" style="left:0;top:0;width:1.8mm;height:100%"></div>' +
      '<div class="lq" style="left:3.2mm;top:2mm;width:21mm;height:21mm">' + qr + '</div>' +
      '<img class="ll" src="logo-h-black-print.png" alt="" style="left:25.5mm;top:3mm;width:21.5mm">' +
      '<div class="lid" style="left:25.5mm;top:10mm;font-size:7.6pt">' + esc(item.id) + '</div>' +
      '<div class="lnm" style="left:25.5mm;top:14.5mm;width:22.5mm;height:8mm;font-size:5.8pt">' + esc(item.name) + '</div></div>';
  }

  /**
   * items: [{code, id, name, sub}] / opts: {type, start(건너뛸 칸), offsetX, offsetY, guide}
   * @return HTML (여러 페이지)
   */
  function sheetsHtml(items, opts) {
    var L = LAYOUTS[opts.type || 'A'];
    var per = L.cols * L.rows;
    var start = Math.max(0, Math.min(per - 1, parseInt(opts.start, 10) || 0));
    var ox = Number(opts.offsetX) || 0, oy = Number(opts.offsetY) || 0;
    var slots = [];
    for (var i = 0; i < start; i++) slots.push(null);
    slots = slots.concat(items);
    var pages = [];
    for (var p = 0; p < slots.length; p += per) {
      var html = '';
      slots.slice(p, p + per).forEach(function (it, idx) {
        if (!it) return;
        var c = idx % L.cols, r = Math.floor(idx / L.cols);
        var x = +(L.mx + ox + c * (L.w + L.gx)).toFixed(2), y = +(L.my + oy + r * (L.h + L.gy)).toFixed(2);
        html += labelHtml(opts.type, it, x, y).replace('class="label"', 'class="label' + (opts.guide ? ' guide' : '') + '"');
      });
      pages.push('<div class="label-sheet">' + html + '</div>');
    }
    return pages.join('');
  }

  function print(items, opts) {
    var root = document.getElementById('print-root');
    root.innerHTML = sheetsHtml(items, Object.assign({}, opts, { guide: false }));
    // 로고 이미지 로드 후 인쇄
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
    Promise.all(imgs.map(function (im) { return im.complete ? 1 : new Promise(function (r) { im.onload = im.onerror = r; }); })).then(function () {
      setTimeout(function () { window.print(); }, 60);
    });
  }

  window.C2Labels = { LAYOUTS: LAYOUTS, sheetsHtml: sheetsHtml, print: print };
})();
