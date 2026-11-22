// 시안 v6 첫 화면 노선도 (2차).
// data-series: [주당시간, 급여, 보험·원천징수, 수당 감소, 월 실질 소득] (v4·v5와 같은 숫자)
// 아래쪽: 전철 노선 안내도처럼 곧은 노선 띠(주 1~40시간)와, 그 위에 월 실질 소득 높낮이 그래프.
// 오른쪽: 역 이름판. 노선 띠를 끌거나 이전·다음 역 버튼을 누르면 이름판과 열차 위치가 바뀐다.
(function () {
  var root = document.querySelector('.hero2[data-series]');
  if (!root) return;
  var series = JSON.parse(root.dataset.series);
  var target = Number(root.dataset.start);
  var n = series.length;
  var maxNet = Math.max.apply(null, series.map(function (r) { return r[4]; }));
  var won = function (v) { return Math.round(v).toLocaleString('ko-KR') + '원'; };
  var q = function (s) { return root.querySelector(s); };
  var range = q('.scrub'), profile = q('.profile'), psvg = q('.profile svg');
  var tram = q('.tram'), guide = q('.pf-guide'), dot = q('.pf-dot');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 실질 소득이 처음 꺾이기 직전(정점)보다 낮은 시간들 = 줄어드는 구간
  var dipAt = series.findIndex(function (r, i) { return i > 0 && r[4] < series[i - 1][4]; });
  var peak = dipAt > 0 ? series[dipAt - 1] : null;
  var isDip = series.map(function (r) { return !!peak && r[0] > peak[0] && r[4] < peak[4]; });
  var f = isDip.indexOf(true), l = isDip.lastIndexOf(true);

  // 노선 구간: [시작, 끝, 색 변수, 이름]
  var legs = [[1, 15, '--ink', '급여만'], [15, 18, '--l15', '주휴수당·4대보험 구간'], [18, 29, '--lsup', '수당 조정 구간'], [29, 40, '--ink', '수당 종료 후']];
  function legOf(h) { for (var i = legs.length - 1; i >= 0; i--) if (h >= legs[i][0]) return legs[i]; return legs[0]; }
  var desc = function (h) {
    if (h < 15) return '주휴수당·4대보험 전. 급여만 늘어요.';
    if (h < 18) return '주휴수당이 붙고 4대보험이 시작됐어요.';
    if (h < 29) return '구직촉진수당이 줄어드는 구간이에요.';
    if (h < 40) return '수당이 0원이 된 뒤라 다시 늘어요.';
    return '종점이에요. 주 40시간.';
  };
  var pct = function (h) { return (h - 1) / (n - 1) * 100; };

  // 노선 띠: 구간별 색 막대와 시간 눈금
  var rail = q('.rail');
  legs.forEach(function (g) {
    var s = document.createElement('i');
    s.style.left = pct(g[0]) + '%'; s.style.width = (pct(g[1]) - pct(g[0])) + '%';
    s.style.background = 'var(' + g[2] + ')';
    rail.appendChild(s);
  });
  var ticks = q('.ticks');
  for (var h = 1; h <= n; h++) { var t = document.createElement('i'); t.style.left = pct(h) + '%'; if (h % 5 === 0) t.className = 'm'; ticks.appendChild(t); }
  root.querySelectorAll('.stn').forEach(function (el) { el.style.left = pct(Number(el.dataset.at)) + '%'; });

  // 높낮이 그래프
  // 세로축은 60만 원부터. 그보다 낮은 앞부분은 아래로 잘려 나간다 (눈금에 금액을 적어 둔다).
  var PT = 18, PB = 6, FLOOR = 600000, TOP = Math.ceil(maxNet / 100000) * 100000;
  function yOf(v, H) { return PT + (1 - (v - FLOOR) / (TOP - FLOOR)) * (H - PT - PB); }
  function drawProfile() {
    var W = profile.clientWidth, H = profile.clientHeight;
    psvg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var X = function (h) { return pct(h) / 100 * W; };
    var d = series.map(function (r, i) { return (i ? 'L' : 'M') + X(r[0]).toFixed(1) + ' ' + yOf(r[4], H).toFixed(1); }).join(' ');
    var zx = X(f + 1), zw = X(l + 1) - zx;
    var html = '<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="7" fill="var(--lsup)" fill-opacity=".28"/></pattern>' +
      '<linearGradient id="pfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121212" stop-opacity=".10"/><stop offset="1" stop-color="#121212" stop-opacity=".01"/></linearGradient></defs>';
    for (var g = FLOOR; g <= TOP; g += 200000) { var y = yOf(g, H); html += '<line class="pf-grid" x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '"/><text class="pf-tick" x="' + W + '" y="' + (y - 5) + '">' + (g / 10000) + '만</text>'; }
    html += '<rect x="' + zx + '" y="0" width="' + zw + '" height="' + H + '" fill="url(#hatch)"/>';
    html += '<path d="' + d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="url(#pfade)"/><path class="pf-line" d="' + d + '"/>';
    psvg.innerHTML = html;
    var z = q('.pf-zone'); z.style.left = (zx + zw / 2) + 'px';
    var line = psvg.querySelector('.pf-line'); line.style.setProperty('--len', line.getTotalLength());
    place(Number(range.value));
  }
  function place(h) {
    var H = profile.clientHeight, x = pct(h) + '%';
    tram.style.left = guide.style.left = dot.style.left = x;
    var y = yOf(series[h - 1][4], H);
    dot.style.top = y + 'px';
    guide.style.top = y + 'px';
  }

  function set(sel, txt) { var el = root.querySelector(sel); if (el) el.textContent = txt; return el; }
  function show(h) {
    var r = series[h - 1], g = legOf(h);
    range.value = h;
    place(h);
    root.style.setProperty('--now', 'var(' + g[2] + ')');
    root.classList.toggle('hot', isDip[h - 1]);
    set('.sign-name', '주 ' + h + '시간');
    set('.tr-h', '주 ' + h + '시간');
    set('.sign-desc', desc(h));
    set('.r-net', won(r[4]));
    set('.r-gross', won(r[1]));
    set('.r-cut', r[2] ? '−' + won(r[2]) : '없음').classList.toggle('neg', r[2] > 0);
    set('.r-loss', r[3] ? '−' + won(r[3]) : '없음').classList.toggle('neg', r[3] > 0);
    set('.r-note', isDip[h - 1] ? '주 ' + peak[0] + '시간보다 ' + won(peak[4] - r[4]) + ' 적어요' : '');
    set('.prev', h > 1 ? '주 ' + (h - 1) + '시간' : '출발역');
    set('.next', h < n ? '주 ' + (h + 1) + '시간' : '종점');
    q('.minus').disabled = h <= 1; q('.plus').disabled = h >= n;
  }

  var playing = null;
  function stop() { if (playing) cancelAnimationFrame(playing); playing = null; root.classList.add('go'); }
  range.addEventListener('input', function () { stop(); show(Number(range.value)); });
  q('.minus').addEventListener('click', function () { stop(); show(Math.max(1, Number(range.value) - 1)); });
  q('.plus').addEventListener('click', function () { stop(); show(Math.min(n, Number(range.value) + 1)); });
  profile.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    var rc = profile.getBoundingClientRect();
    stop(); show(Math.min(n, Math.max(1, Math.round((e.clientX - rc.left) / rc.width * (n - 1)) + 1)));
  });

  drawProfile();
  show(1);
  addEventListener('resize', drawProfile);

  if (reduce) { stop(); show(target); return; }
  // 높낮이 선이 그려진 뒤 열차가 1시간부터 목표 시간까지 달린다.
  function play() {
    root.classList.add('go');
    var t0 = performance.now() + 1200, dur = 2600;
    (function step(now) {
      var k = Math.min(1, Math.max(0, (now - t0) / dur));
      show(Math.max(1, Math.round(1 + (1 - Math.pow(1 - k, 3)) * (target - 1))));
      if (k < 1) playing = requestAnimationFrame(step); else playing = null;
    })(performance.now());
  }
  if (!('IntersectionObserver' in window)) { play(); return; }
  var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); play(); } }, { threshold: 0.3 });
  io.observe(q('.linemap'));
})();
