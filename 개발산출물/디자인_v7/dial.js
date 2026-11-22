// 시안 v7 첫 화면 계기판.
// data-series: [주당시간, 급여, 보험·원천징수, 수당 감소, 월 실질 소득] (v4~v6과 같은 숫자)
// 가는 곡선 위 점을 좌우로 움직이면 큰 숫자가 부드럽게 바뀐다. 실질 소득이 정점보다 낮은 구간에선 숫자가 코발트 파랑으로 바뀐다.
(function () {
  var root = document.querySelector('.dial[data-series]');
  if (!root) return;
  var series = JSON.parse(root.dataset.series);
  var target = Number(root.dataset.start);
  var n = series.length;
  var maxNet = Math.max.apply(null, series.map(function (r) { return r[4]; }));
  var fmt = function (v) { return Math.round(v).toLocaleString('ko-KR'); };
  var q = function (s) { return root.querySelector(s); };
  var curve = q('.curve'), svg = q('svg'), knob = q('.knob'), vline = q('.vline');
  var range = q('.scrub'), out = q('.out'), big = q('.big-n');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var dipAt = series.findIndex(function (r, i) { return i > 0 && r[4] < series[i - 1][4]; });
  var peak = dipAt > 0 ? series[dipAt - 1] : null;
  var isDip = series.map(function (r) { return !!peak && r[0] > peak[0] && r[4] < peak[4]; });
  var f = isDip.indexOf(true), l = isDip.lastIndexOf(true);

  var xp = function (h) { return (h - 1) / (n - 1); };
  var yp = function (v) { return 1 - v / maxNet * .92; };

  function draw() {
    var W = curve.clientWidth, H = curve.clientHeight;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var d = series.map(function (r, i) { return (i ? 'L' : 'M') + (xp(r[0]) * W).toFixed(1) + ' ' + (yp(r[4]) * H).toFixed(1); }).join(' ');
    var zx = xp(f + 1) * W, zw = (xp(l + 1) - xp(f + 1)) * W;
    svg.innerHTML = '<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17211c" stop-opacity=".07"/><stop offset="1" stop-color="#17211c" stop-opacity="0"/></linearGradient></defs>' +
      '<rect class="zone" x="' + zx + '" y="0" width="' + zw + '" height="' + H + '"/>' +
      '<line class="zline" x1="' + zx + '" x2="' + zx + '" y1="0" y2="' + H + '"/><line class="zline" x1="' + (zx + zw) + '" x2="' + (zx + zw) + '" y1="0" y2="' + H + '"/>' +
      '<path class="area" d="' + d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z"/><path class="stroke" d="' + d + '"/>';
    var zl = q('.zlbl'); if (zl) zl.style.left = ((xp(f + 1) + xp(l + 1)) / 2 * 100) + '%';
    place(Number(range.value));
  }
  function place(h) {
    var r = series[h - 1];
    knob.style.left = vline.style.left = (xp(h) * 100) + '%';
    knob.style.bottom = ((1 - yp(r[4])) * 100) + '%';
  }

  // 큰 숫자는 목표값으로 부드럽게 따라간다
  var shown = 0, goal = 0, raf = null;
  function tween() {
    shown += (goal - shown) * .18;
    if (Math.abs(goal - shown) < 1) shown = goal;
    big.textContent = fmt(shown);
    raf = shown === goal ? null : requestAnimationFrame(tween);
  }
  function show(h) {
    var r = series[h - 1];
    range.value = h;
    place(h);
    out.textContent = '주 ' + h + '시간';
    goal = r[4];
    if (reduce) { shown = goal; big.textContent = fmt(goal); } else if (!raf) raf = requestAnimationFrame(tween);
    q('.r-gross').textContent = fmt(r[1]) + '원';
    q('.r-cut').textContent = r[2] ? '−' + fmt(r[2]) + '원' : '없음';
    q('.r-loss').textContent = r[3] ? '−' + fmt(r[3]) + '원' : '없음';
    q('.r-loss').classList.toggle('neg', r[3] > 0);
    root.classList.toggle('hot', isDip[h - 1]);
    if (isDip[h - 1]) q('.r-note').textContent = '주 ' + peak[0] + '시간보다 ' + fmt(peak[4] - r[4]) + '원 적어요';
  }

  var playing = null;
  function stop() { if (playing) cancelAnimationFrame(playing); playing = null; }
  range.addEventListener('input', function () { stop(); show(Number(range.value)); });
  curve.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    var rc = curve.getBoundingClientRect();
    stop(); show(Math.min(n, Math.max(1, Math.round((e.clientX - rc.left) / rc.width * (n - 1)) + 1)));
  });


  // 첫 화면 배경: 같은 곡선을 화면 폭 가득 연하게 그리고, 주석에서 곡선 위 점까지 점선을 잇는다.
  var bd = document.querySelector('.backdrop');
  function drawBackdrop() {
    if (!bd) return;
    var bs = bd.querySelector('svg'), W = bd.clientWidth, H = bd.clientHeight;
    bs.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var X = function (h) { return W * (.03 + .94 * (h - 1) / (n - 1)); };
    var Y = function (v) { return H * .74 - v / maxNet * H * .62; };
    var d = series.map(function (r, i) { return (i ? 'L' : 'M') + X(r[0]).toFixed(1) + ' ' + Y(r[4]).toFixed(1); }).join(' ');
    var zx = X(f + 1), zw = X(l + 1) - zx;
    var html = '<defs><linearGradient id="bdfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17211c" stop-opacity=".06"/><stop offset="1" stop-color="#17211c" stop-opacity="0"/></linearGradient></defs>' +
      '<rect class="b-zone" x="' + zx + '" y="0" width="' + zw + '" height="' + H + '"/>' +
      '<line class="b-zline" x1="' + zx + '" x2="' + zx + '" y1="0" y2="' + H + '"/><line class="b-zline" x1="' + (zx + zw) + '" x2="' + (zx + zw) + '" y1="0" y2="' + H + '"/>';
    [15, 30].forEach(function (h) { html += '<line class="b-guide" x1="' + X(h) + '" x2="' + X(h) + '" y1="0" y2="' + H + '"/>'; });
    html += '<path class="b-area" d="' + d + ' L' + X(n) + ' ' + H + ' L' + X(1) + ' ' + H + ' Z"/><path class="b-line" d="' + d + '"/>';
    var dd = ''; for (var h = f; h <= l + 1; h++) dd += (h === f ? 'M' : 'L') + X(h).toFixed(1) + ' ' + Y(series[h - 1][4]).toFixed(1);
    html += '<path class="b-dip" d="' + dd + '"/>';
    bd.querySelectorAll('.bd-note').forEach(function (el) {
      var h = Number(el.dataset.at), px = X(h), py = Y(series[h - 1][4]);
      var nx = W * Number(el.dataset.x) / 100, ny = H * Number(el.dataset.y) / 100;
      el.style.left = nx + 'px'; el.style.top = ny + 'px';
      var ax = nx, ay = ny + el.offsetHeight / 2;
      html += '<polyline class="b-lead" points="' + (nx < px ? (nx + el.offsetWidth + 8) : (ax - 8)) + ',' + ay + ' ' + px + ',' + ay + ' ' + px + ',' + py + '"/>';
      html += '<circle class="b-dot' + (el.classList.contains('acc') ? ' acc' : '') + '" cx="' + px + '" cy="' + py + '" r="4.5"/>';
    });
    bs.innerHTML = html;
    var line = bs.querySelector('.b-line'); line.style.setProperty('--len', line.getTotalLength());
  }
  drawBackdrop();
  addEventListener('resize', drawBackdrop);

  draw();
  addEventListener('resize', draw);
  if (reduce) { show(target); return; }
  show(1);
  function play() {
    var t0 = performance.now() + 400, dur = 2600;
    (function step(now) {
      var k = Math.min(1, Math.max(0, (now - t0) / dur));
      show(Math.max(1, Math.round(1 + (1 - Math.pow(1 - k, 3)) * (target - 1))));
      if (k < 1) playing = requestAnimationFrame(step); else playing = null;
    })(performance.now());
  }
  if (!('IntersectionObserver' in window)) { play(); return; }
  var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); play(); } }, { threshold: 0.4 });
  io.observe(root);
})();
