// PC 첫 화면 배경 영상 (docs/intent/hankkeut-bg-video.md)
// - PC(1024px 이상) 첫 화면에서만 화면 뒤에 깐다. 다른 화면으로 가거나 창이 좁아지면 지운다.
// - 휴대폰(1023px 이하)에서는 영상·그림 요소를 만들지 않아 아무것도 받지 않는다.
// - 동작 줄이기를 켰거나 '움직임 멈춤'을 고른 사람, 데이터 절약을 켠 사람에게는 영상 없이 그림 한 장만 둔다.
//   영상이 돌던 중에 '움직임 멈춤'을 누르면 보던 장면에서 멈춘다.
// - AI 공고 읽기를 끈 체험 주소에서는 영상 이야기(AI가 공고를 읽음)가 맞지 않아 넣지 않는다.
// - 소리 없음, 반복, 화면 읽기 프로그램은 읽지 않음(aria-hidden). 자리·막은 css/bgvideo.css.
// 영상은 개발산출물/배경영상/의 scene.html을 render.mjs로 찍어 만든다.
import { AI_OFF } from './config.js';

const DIR = 'media/';
const POSTER = `${DIR}start-bg.jpg`; // 영상의 첫 장면과 같은 그림
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

function sync() {
  const want = !AI_OFF && wide.matches && document.body.dataset.step === 'start';
  if (!want) {
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

new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-step', 'data-motion'] });
wide.addEventListener('change', sync);
reduce.addEventListener('change', sync);
if (!pageLoaded) window.addEventListener('load', () => { pageLoaded = true; sync(); }, { once: true });
sync();
