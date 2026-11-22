// 시안 v5 모션 (v4 motion.js를 종이 시안에 맞게 고침): 스크롤 등장, 단어별 제목, 숫자 세기, 타자 효과, 마우스 하이라이트, 자석 버튼, 스크롤 기울기, 메뉴 줄어들기.
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(pointer: fine)').matches;
  document.documentElement.classList.add('js');

  // 1) 제목을 단어 단위로 감싸 아래에서 올라오게 한다. 강조(em) 같은 요소는 통째로 한 단어로 본다.
  var wi = 0;
  function wrap(node) {
    var s = document.createElement('span'); s.className = 'w';
    s.style.setProperty('--i', wi++);
    s.appendChild(node); return s;
  }
  document.querySelectorAll('[data-split]').forEach(function (h) {
    wi = 0;
    Array.prototype.slice.call(h.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        var frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
          var inner = document.createElement('span'); inner.textContent = part;
          frag.appendChild(wrap(inner));
        });
        h.replaceChild(frag, n);
      } else if (n.nodeName !== 'BR') {
        var holder = document.createElement('span');
        h.insertBefore(holder, n); holder.appendChild(n);
        var w = document.createElement('span'); w.className = 'w'; w.style.setProperty('--i', wi++);
        h.insertBefore(w, holder); w.appendChild(holder);
      }
    });
  });

  // 2) 스크롤 등장. 자주 쓰는 블록에는 자동으로 붙이고, 같은 부모 안에서는 차례로 늦게 나오게 한다.
  var auto = '.sec-head, .cols3 > *, .ledger tbody tr, .cards > *, .rules > *, .basis > *, .alt tbody tr, .cmp tbody tr, .detail > *, .vs > *, .letter, .end, .close, .dipnote, .page-head > *, .up > *, .rows > li, .res-r, .hero > div:first-child > *, .fig, .receipt .ln, .receipt .total, .stamp';
  document.querySelectorAll(auto).forEach(function (el) { el.setAttribute('data-reveal', ''); });
  var seen = new Map();
  document.querySelectorAll('[data-reveal]').forEach(function (el) {
    if (el.style.getPropertyValue('--i')) return;
    var p = el.parentElement, k = seen.get(p) || 0;
    el.style.setProperty('--i', k); seen.set(p, k + 1);
  });

  // 3) 숫자 세기
  function count(el) {
    var to = Number(el.dataset.count), t0 = performance.now() + 150, dur = Number(el.dataset.dur || 1400);
    if (reduce) { el.textContent = to.toLocaleString('ko-KR'); return; }
    (function tick(now) {
      var k = Math.min(1, Math.max(0, (now - t0) / dur));
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4))).toLocaleString('ko-KR');
      if (k < 1) requestAnimationFrame(tick);
    })(performance.now());
  }

  // 4) 타자 효과 (결과 화면의 문구에서도 쓴다)
  var typing = new WeakMap();
  window.typeText = function (el, text) {
    if (typing.get(el)) cancelAnimationFrame(typing.get(el));
    if (reduce) { el.textContent = text; return; }
    el.classList.add('caret');
    var i = 0, last = 0;
    (function step(now) {
      if (now - last > 18) { i += 2; last = now; el.textContent = text.slice(0, i); }
      if (i < text.length) typing.set(el, requestAnimationFrame(step));
      else { el.textContent = text; typing.delete(el); setTimeout(function () { el.classList.remove('caret'); }, 900); }
    })(0);
  };

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target;
      io.unobserve(el);
      if (el.hasAttribute('data-reveal')) el.classList.add('in');
      if (el.dataset.count) count(el);
      if (el.dataset.type != null) window.typeText(el, el.dataset.type || el.textContent);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('[data-reveal], [data-count], [data-type]').forEach(function (el) {
    if (el.dataset.type === '') el.dataset.type = el.textContent;
    if (el.dataset.type != null) el.textContent = '';
    io.observe(el);
  });

  // 5) 카드 위 마우스 하이라이트, 버튼 안 빛
  if (fine) {
    document.addEventListener('pointermove', function (e) {
      var c = e.target.closest && e.target.closest('.spot');
      if (!c) return;
      var r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });

    // 6) 큰 버튼은 마우스 쪽으로 살짝 끌려온다
    if (!reduce) document.querySelectorAll('.mag').forEach(function (b) {
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        b.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * .18) + 'px,' + ((e.clientY - r.top - r.height / 2) * .3) + 'px)';
      });
      b.addEventListener('pointerleave', function () { b.style.transform = ''; });
    });
  }

  // 7) 스크롤하면 기울어진 창이 펴진다. 메뉴는 내려가면 줄어든다.
  var tilts = Array.prototype.slice.call(document.querySelectorAll('[data-scroll-tilt]'));
  function onScroll() {
    document.body.classList.toggle('scrolled', scrollY > 24);
    if (reduce) return;
    tilts.forEach(function (el) {
      var r = el.getBoundingClientRect(), vh = innerHeight;
      var p = Math.min(1, Math.max(0, (vh - r.top) / (vh * .75)));
      el.style.setProperty('--rx', (16 * (1 - p)).toFixed(2) + 'deg');
      el.style.setProperty('--sc', (0.92 + 0.08 * p).toFixed(3));
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
