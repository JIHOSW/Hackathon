// 첫 화면 "문턱" 그래프. 시안 v4·v5가 함께 쓴다.
// data-series: [주당시간, 급여, 보험·원천징수, 수당 감소, 실제로 남는 돈]
// 막대(.bars)나 선(svg.line) 중 화면에 있는 쪽을 그린다.
(function () {
  var root = document.querySelector('[data-series]');
  if (!root) return;
  var series = JSON.parse(root.dataset.series);
  var target = Number(root.dataset.start);
  var n = series.length;
  var maxNet = Math.max.apply(null, series.map(function (r) { return r[4]; }));
  var won = function (v) { return Math.round(v).toLocaleString('ko-KR') + '원'; };
  var q = function (s) { return root.querySelector(s); };

  // 정점: 처음으로 남는 돈이 줄어들기 직전. 그 뒤로 정점보다 실질 소득이 낮은 구간이 "지원 조정 구간".
  var dipAt = series.findIndex(function (r, i) { return i > 0 && r[4] < series[i - 1][4]; });
  var peak = dipAt > 0 ? series[dipAt - 1] : null;
  var isDip = series.map(function (r) { return !!peak && r[0] > peak[0] && r[4] < peak[4]; });
  var dipFirst = isDip.indexOf(true), dipLast = isDip.lastIndexOf(true);
  var zone = q('.zone');
  if (zone && dipFirst >= 0) { zone.style.left = (dipFirst / n * 100) + '%'; zone.style.width = ((dipLast - dipFirst + 1) / n * 100) + '%'; }
  root.querySelectorAll('[data-at]').forEach(function (m) { m.style.left = ((Number(m.dataset.at) - 1) / n * 100) + '%'; });

  // 막대
  var barsBox = q('.bars'), bars = [];
  if (barsBox) {
    series.forEach(function (r, i) {
      var b = document.createElement('i');
      b.style.setProperty('--h', (r[4] / maxNet * 100) + '%');
      if (isDip[i]) b.classList.add('dip');
      b.addEventListener('mouseenter', function () { stop(); show(i + 1); });
      barsBox.appendChild(b); bars.push(b);
    });
  }
  // 선
  var svg = q('svg.line'), dot = null, path = null;
  if (svg) {
    var W = 1000, H = 400;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    var pt = function (i) { return [(i + .5) / n * W, H - series[i][4] / maxNet * (H - 10)]; };
    var d = series.map(function (r, i) { var p = pt(i); return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    svg.innerHTML = '<path class="area" d="' + d + ' L' + pt(n - 1)[0] + ' ' + H + ' L' + pt(0)[0] + ' ' + H + ' Z"/><path class="stroke" d="' + d + '"/>';
    path = svg.querySelector('.stroke');
    dot = q('.dot');
    svg.addEventListener('mousemove', function (e) {
      var rc = svg.getBoundingClientRect();
      stop(); show(Math.min(n, Math.max(1, Math.ceil((e.clientX - rc.left) / rc.width * n))));
    });
  }

  var range = q('.range'), out = q('.out'), card = q('.read');
  function set(sel, txt) { var el = card.querySelector(sel); if (el) el.textContent = txt; return el; }
  function show(h) {
    var r = series[h - 1];
    bars.forEach(function (b, i) { b.classList.toggle('sel', i === h - 1); b.classList.toggle('past', i < h - 1); });
    if (dot) { dot.style.left = ((h - .5) / n * 100) + '%'; dot.style.bottom = (r[4] / maxNet * 97.5) + '%'; dot.classList.toggle('dip', isDip[h - 1]); }
    range.value = h;
    range.style.setProperty('--p', ((h - 1) / (n - 1)) * 100 + '%');
    out.textContent = '주 ' + r[0] + '시간';
    set('.r-h', '주 ' + r[0] + '시간 일할 때 월 실질 소득');
    set('.r-net', won(r[4]));
    set('.r-gross', '+' + won(r[1]));
    set('.r-cut', r[2] ? '−' + won(r[2]) : '없음').parentNode.classList.toggle('neg', r[2] > 0);
    set('.r-loss', r[3] ? '−' + won(r[3]) : '없음').parentNode.classList.toggle('neg', r[3] > 0);
    card.classList.toggle('hot', isDip[h - 1]);
    set('.r-note', isDip[h - 1] ? '주 ' + peak[0] + '시간 대비 ' + won(peak[4] - r[4]) + ' 낮아요 · 지원 조정 구간' : '');
  }

  var playing = null;
  function stop() { if (playing) cancelAnimationFrame(playing); playing = null; root.classList.add('done'); if (svg) svg.style.clipPath = 'none'; bars.forEach(function (b) { b.classList.add('on'); }); }
  range.addEventListener('input', function () { stop(); show(Number(range.value)); });

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { stop(); show(target); return; }
  show(1);
  // 그래프가 화면에 들어왔을 때 1시간부터 목표 시간까지 훑으며 막대를 세운다.
  function play() {
    var t0 = performance.now() + 500, dur = 2600;
    (function step(now) {
      var k = Math.min(1, Math.max(0, (now - t0) / dur));
      var h = Math.max(1, Math.round(1 + (1 - Math.pow(1 - k, 3)) * (target - 1)));
      bars.forEach(function (b, i) { if (i < h) b.classList.add('on'); });
      if (svg) svg.style.clipPath = 'inset(0 ' + (100 - Math.min(100, k * 125)) + '% 0 0)';
      show(h);
      if (k < 1) playing = requestAnimationFrame(step); else stop();
    })(performance.now());
  }
  if (!('IntersectionObserver' in window)) { play(); return; }
  var io = new IntersectionObserver(function (es) {
    if (es[0].isIntersecting) { io.disconnect(); if (!root.classList.contains('done')) play(); }
  }, { threshold: 0.35 });
  io.observe(root);
})();
