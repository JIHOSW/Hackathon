// 시안 v5 첫 화면 영수증. 프린터에서 영수증이 나온 뒤, 근무시간을 1시간부터 받은 제안(주 24시간)까지 훑으며 금액을 바꾼다.
// data-series: [주당시간, 급여, 4대보험·원천징수, 수당 감소, 실제로 남는 돈] (계산 엔진으로 첫 번째 샘플을 계산한 값)
(function () {
  var root = document.querySelector('.paper[data-series]');
  if (!root) return;
  var series = JSON.parse(root.dataset.series), n = series.length, target = Number(root.dataset.start);
  var maxNet = Math.max.apply(null, series.map(function (r) { return r[4]; }));
  var won = function (v) { return Math.round(v).toLocaleString('ko-KR') + '원'; };
  var q = function (s) { return root.querySelector(s); };

  // 정점: 처음으로 실질 소득이 줄기 직전. 그 뒤로 정점보다 낮은 시간이 "지원 조정 구간".
  var dipAt = series.findIndex(function (r, i) { return i > 0 && r[4] < series[i - 1][4]; });
  var peak = dipAt > 0 ? series[dipAt - 1] : null;
  var isDip = series.map(function (r) { return !!peak && r[0] > peak[0] && r[4] < peak[4]; });

  var box = q('.bars'), bars = [];
  series.forEach(function (r, i) {
    var b = document.createElement('i');
    b.style.setProperty('--h', (8 + r[4] / maxNet * 92).toFixed(1) + '%');
    if (isDip[i]) b.classList.add('dip');
    box.appendChild(b); bars.push(b);
  });

  var scrub = q('.scrub'), out = q('.out'), cur = target;
  function set(sel, txt) { var el = q(sel); el.textContent = txt; return el; }
  function show(h) {
    cur = h;
    var r = series[h - 1];
    bars.forEach(function (b, i) { b.classList.toggle('sel', i === h - 1); });
    scrub.value = h;
    out.textContent = '주 ' + h + '시간';
    set('.r-gross', '+' + won(r[1]));
    set('.r-cut', r[2] ? '−' + won(r[2]) : '0원').parentNode.classList.toggle('neg', r[2] > 0);
    set('.r-loss', r[3] ? '−' + won(r[3]) : '0원').parentNode.classList.toggle('neg', r[3] > 0);
    set('.r-net', won(r[4]));
    root.classList.toggle('hot', isDip[h - 1]);
    set('.r-note', isDip[h - 1] ? '주 ' + peak[0] + '시간 대비 ' + won(peak[4] - r[4]) + ' 낮아요 · 지원 조정 구간' : '');
    q('.minus').disabled = h <= 1; q('.plus').disabled = h >= n;
  }

  var playing = null;
  function stop() { if (playing) cancelAnimationFrame(playing); playing = null; root.classList.add('done'); }
  scrub.addEventListener('input', function () { stop(); show(Number(scrub.value)); });
  q('.minus').addEventListener('click', function () { stop(); show(Math.max(1, cur - 1)); });
  q('.plus').addEventListener('click', function () { stop(); show(Math.min(n, cur + 1)); });

  var till = root.closest('.till');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { till.classList.add('go'); stop(); show(target); return; }
  show(1);
  // 영수증 자리가 화면에 들어오면 인쇄를 시작하고, 다 나온 뒤(약 1.6초) 1시간부터 받은 제안까지 훑는다.
  function play() {
    till.classList.add('go');
    var t0 = performance.now() + 1700, dur = 2200;
    (function step(now) {
      var k = Math.min(1, Math.max(0, (now - t0) / dur));
      show(Math.max(1, Math.round(1 + (1 - Math.pow(1 - k, 3)) * (target - 1))));
      if (k < 1) playing = requestAnimationFrame(step); else stop();
    })(performance.now());
  }
  if (!('IntersectionObserver' in window)) { play(); return; }
  var io = new IntersectionObserver(function (es) {
    if (es[0].isIntersecting) { io.disconnect(); if (!root.classList.contains('done')) play(); else till.classList.add('go'); }
  }, { threshold: 0.15 });
  io.observe(till);
})();
