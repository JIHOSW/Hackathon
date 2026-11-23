// PC 첫 화면 배경 영상 (docs/intent/hankkeut-bg-video.md)
// - PC(1024px 이상) 첫 화면에서만 화면 뒤에 깐다. 다른 화면으로 가거나 창이 좁아지면 지운다.
// - 휴대폰(1023px 이하)에서는 영상·그림 요소를 만들지 않아 아무것도 받지 않는다.
// - 영상에는 띠가 둘 있다(위 띠: 공고 입력 칸·로고, 아래 띠: 영수증·한 줄 문구). 첫 화면의 위 빈칸(위쪽 막대 아래 ~ 제목 위)과
//   아래 빈칸(내용 아래 ~ 창 아래)을 재서, 두 띠가 각 빈칸 가운데에 오도록 영상 크기와 위치를 정한다.
//   그래서 띠가 창 끝에서 잘리거나 글·예시 영수증 뒤로 들어가지 않는다. 빈칸이 띠보다 좁은 창(높이 약 715px 미만)에는 넣지 않는다.
// - 동작 줄이기를 켰거나 '움직임 멈춤'을 고른 사람, 데이터 절약을 켠 사람에게는 영상 없이 그림 한 장만 둔다.
//   영상이 돌던 중에 '움직임 멈춤'을 누르면 보던 장면에서 멈춘다.
// - AI 공고 읽기를 끈 체험 주소에서는 영상 이야기(AI가 공고를 읽음)가 맞지 않아 넣지 않는다.
// - 소리 없음, 반복, 화면 읽기 프로그램은 읽지 않음(aria-hidden). 막·자리는 css/bgvideo.css.
// 영상은 개발산출물/배경영상/의 scene.html을 render.mjs로 찍어 만든다. 장면에서 띠 자리를 바꾸면 아래 FRAME·BAND도 같이 바꾼다.
import { AI_OFF } from './config.js';

const DIR = 'media/';
const POSTER = `${DIR}start-bg.jpg`; // 영상의 첫 장면과 같은 그림
// 장면 좌표(scene.html, 1200×1080). 띠마다 세로 끝(나타나고 사라질 때 움직이는 만큼과 영수증 톱니까지)과 가운데
const FRAME = { w: 1200, h: 1080 };
const BAND = { top: { y0: 16, y1: 136, c: 80 }, bottom: { y0: 869, y1: 1023, c: 946 }, w: 1100 };
// 빈칸 안쪽 여유(px): 위쪽 막대 아래, 제목 위(글 뒤 막보다 바깥), 내용 아래(영수증 톱니·그림자와 글 뒤 막보다 바깥), 창 아래
const GAP = { nav: 8, above: 12, below: 24, edge: 10 };
const MIN_SCALE = 0.55; // 이보다 작게 줄여야 하면 글자가 너무 작아 넣지 않는다
const MAX_SCALE = 1;
const wide = window.matchMedia('(min-width: 1024px)');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
let layer = null;
let pageLoaded = document.readyState === 'complete';

// '움직임 멈춤' 버튼(app.js)이 body[data-motion]에 auto·on·off를 남긴다. auto면 기기 설정을 따른다.
function still() {
  const m = document.body.dataset.motion;
  if (m === 'on') return false;
  if (m === 'off') return true;
  const c = navigator.connection;
  return reduce.matches || Boolean(c && (c.saveData || /2g/.test(c.effectiveType || '')));
}

function makeVideo() {
  const v = document.createElement('video');
  for (const a of ['muted', 'loop', 'playsinline', 'autoplay', 'disablepictureinpicture', 'disableremoteplayback']) v.setAttribute(a, '');
  v.muted = true;
  v.preload = 'auto';
  v.poster = POSTER;
  v.tabIndex = -1;
  // 평평한 화면이라 H.264(mp4)가 VP9(webm)보다 작고 선명하다. webm은 H.264를 못 트는 브라우저용.
  v.innerHTML = `<source src="${DIR}start-bg.mp4" type="video/mp4"><source src="${DIR}start-bg.webm" type="video/webm">`;
  return v;
}

// 첫 화면의 위·아래 빈칸을 재서 영상 배율(s)과 위 끝(y)을 정한다. 두 띠가 빈칸에 다 들어가지 않으면 null
function fit() {
  const nav = document.querySelector('.nav');
  const app = document.getElementById('app');
  if (!nav || !app) return null;
  const H = window.innerHeight;
  const W = window.innerWidth;
  // 내용 위·아래 끝. 들어올 때의 움직임(transform)에 흔들리지 않게 offset으로 잰다.
  // 창이 낮아 첫 화면이 스크롤될 정도면 아래 빈칸이 띠보다 좁아 영상을 넣지 않게 된다.
  const docTop = (el) => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y; };
  let top = Infinity;
  let bottom = -Infinity;
  for (const k of app.children) {
    if (!k.offsetParent) continue; // 숨긴 요소
    const y = docTop(k) - window.scrollY;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y + k.offsetHeight);
  }
  if (!Number.isFinite(top)) return null;
  const t0 = nav.getBoundingClientRect().bottom + GAP.nav;
  const t1 = top - GAP.above;
  const b0 = bottom + GAP.below;
  const b1 = H - GAP.edge;
  const A = BAND.top;
  const B = BAND.bottom;
  // 두 띠 가운데 사이 거리가 두 빈칸 가운데 사이 거리와 같아지는 배율. 너무 크거나 창 폭을 넘으면 줄인다
  const s = Math.min(((b0 + b1) / 2 - (t0 + t1) / 2) / (B.c - A.c), (W - 32) / BAND.w, MAX_SCALE);
  if (!(s >= MIN_SCALE) || s * (A.y1 - A.y0) > t1 - t0 || s * (B.y1 - B.y0) > b1 - b0) return null;
  // 두 띠가 각 빈칸 가운데에 오는 위치. 배율을 줄였으면 두 띠가 모두 빈칸 안에 드는 범위에서 가장 가까운 곳
  const lo = Math.max(t0 - s * A.y0, b0 - s * B.y0);
  const hi = Math.min(t1 - s * A.y1, b1 - s * B.y1);
  if (lo > hi) return null;
  const want = ((t0 + t1) / 2 - s * A.c + (b0 + b1) / 2 - s * B.c) / 2;
  return { s, y: Math.min(hi, Math.max(lo, want)) };
}

function sync() {
  const f = !AI_OFF && wide.matches && document.body.dataset.step === 'start' ? fit() : null;
  if (!f) {
    if (layer) { layer.remove(); layer = null; }
    document.body.classList.remove('bgv-on');
    return;
  }
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'bgv';
    layer.setAttribute('aria-hidden', 'true');
    // 그림 한 장을 먼저 깔고, 다 받으면 0.3초에 걸쳐 나타낸다(동작 줄이기면 바로).
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('load', () => { if (layer && layer.contains(img)) layer.classList.add('on'); }, { once: true });
    img.src = POSTER;
    layer.append(img);
    document.body.prepend(layer);
  }
  layer.style.setProperty('--bgv-w', `${(FRAME.w * f.s).toFixed(1)}px`);
  layer.style.setProperty('--bgv-h', `${(FRAME.h * f.s).toFixed(1)}px`);
  layer.style.setProperty('--bgv-y', `${f.y.toFixed(1)}px`);
  document.body.classList.add('bgv-on');
  let v = layer.querySelector('video');
  if (still()) { if (v && !v.paused) v.pause(); return; }
  // 영상은 앱 파일을 다 받은 뒤에 받기 시작한다(첫 화면이 늦게 뜨지 않게).
  if (!pageLoaded) return;
  if (!v) {
    v = makeVideo();
    const host = layer;
    v.addEventListener('playing', () => host.classList.add('on'), { once: true }); // 그림을 못 받았어도 영상이 돌면 보인다
    layer.append(v);
  }
  if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } // 자동 재생이 막히면 그림 그대로
}

// 화면이 바뀌거나(단계·움직임 설정·첫 화면 다시 그림), 창 크기·글꼴이 바뀌면 다음 그림 때 한 번 다시 맞춘다
let queued = 0;
const later = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; sync(); }); };
new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ['data-step', 'data-motion'] });
const appEl = document.getElementById('app');
if (appEl) new MutationObserver(later).observe(appEl, { childList: true });
window.addEventListener('resize', later);
wide.addEventListener('change', later);
reduce.addEventListener('change', later);
if (document.fonts) {
  document.fonts.ready.then(later);
  if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', later);
}
if (!pageLoaded) window.addEventListener('load', () => { pageLoaded = true; sync(); }, { once: true });
sync();
