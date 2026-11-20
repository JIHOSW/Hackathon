// 문턱 화면 흐름
// 시작 → 공고 올리기 → 조건 확인 → 내 상황 → 결과 → 근무조건 비교 → 시작 전 준비
// 계산은 전부 engine.js가 한다. 이 파일은 입력을 모으고 결과를 그리기만 한다.
import { evaluate, searchAlternatives, compareOffers, buildRequestMessage, REQUEST_ACTIONS, STATUS } from './engine.js';
import { SAMPLES, EMPTY_PROFILE } from './samples.js';
import { API_BASE, AI_AVAILABLE } from './config.js';

const app = document.getElementById('app');
const topEl = document.getElementById('top');
const barEl = document.getElementById('bar');
const sheetEl = document.getElementById('sheet');
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

const state = {
  step: 'start', rules: null, sample: null, mode: 'text', rawText: '',
  fields: null, profile: clone(EMPTY_PROFILE), result: null, alts: null, aiError: null, loading: false,
  offers: [], editing: null, active: 0, comparison: null, reviewed: [], reviewTotal: 0,
  profileQ: 0, ytdOpen: false, chosenHours: null, requestAction: null, sheet: null, returnStep: 'start', inputHint: null,
};
const MAX_OFFERS = 3;

// 단계 막대: 6칸. 시작 화면과 안내 화면에는 막대 대신 로고를 보인다.
const STEP_GROUP = { upload: 0, input: 0, samples: 0, confirm: 1, offers: 1, profile: 2, compare: 3, result: 3, alts: 4, message: 4, basis: 5 };
const STATUS_LABEL = { [STATUS.CONFIRMED]: '확실', [STATUS.ESTIMATED]: '어림값', [STATUS.CHECK]: '확인 필요' };
const PAY_LABEL = { wage: '월급 · 4대보험', business: '3.3% 떼고 받음', daily: '일당으로 받음', unknown: '모름' };
const SAMPLE_TEXT = {
  cafe: ['주말 카페 알바', '정부 수당을 받는 훈련생'],
  tutor: ['3.3% 떼는 학원 보조', '부모님 보험에 올라 있는 대학생'],
  store: ['조건이 빠진 편의점 공고', '급여를 어떻게 받는지 안 적힌 공고'],
};
const LINKS = {
  gov24Health: 'https://www.gov.kr/portal/service/serviceInfo/PTR000050333',
  nhisHealth: 'https://www.nhis.or.kr/static/html/guide/sub2_010101.html',
  repo: 'https://github.com/JIHOSW/Hackathon',
  anthropicPrivacy: 'https://www.anthropic.com/legal/privacy',
};

// ---------------- 아이콘 (선 아이콘, 화면 낭독기는 읽지 않음) ----------------
const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  ch: '<path d="M9 5l7 7-7 7"/>',
  cam: '<path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4z"/><circle cx="12" cy="13.2" r="3.1"/>',
  msg: '<path d="M5 5.5h14v9.5H10.5L6.5 18.5V15H5z"/><path d="M8.5 9h7M8.5 11.8h4"/>',
  pen: '<path d="M5 19l1-4L16 5l3 3L9 18z"/><path d="M14 7l3 3"/>',
  doc: '<path d="M7 4h7l4 4v12H7z"/><path d="M14 4v4h4"/><path d="M9.8 14l1.8 1.8 3.2-3.8"/>',
  file: '<path d="M7 4h7l4 4v12H7z"/><path d="M14 4v4h4"/><path d="M10 13h5M10 16h3"/>',
  plus: '<circle cx="12" cy="12" r="8"/><path d="M12 8.5v7M8.5 12h7"/>',
  down: '<path d="M12 5v13M6.5 12.5L12 18l5.5-5.5"/>',
  same: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>',
  hold: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.6a2.6 2.6 0 015 .9c0 1.7-2.5 2-2.5 3.5M12 16.8v.2"/>',
  noread: '<path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4z"/><path d="M9.5 11l5 5M14.5 11l-5 5"/>',
  link: '<path d="M10 14l4-4M9 7h-2a4 4 0 000 8h2M15 17h2a4 4 0 000-8h-2"/>',
  phone: '<path d="M6 4h3l1.5 4-2 1.5a10 10 0 005 5L15 12.5l4 1.5v3a2 2 0 01-2 2A14 14 0 014 6a2 2 0 012-2z"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
const LOGO = '<svg class="logo-mark" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="7" fill="#0A6352"/><path d="M8 17V9.5a4 4 0 018 0V17" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M6 17.2h12" stroke="#BDEBD6" stroke-width="2.2" stroke-linecap="round"/></svg>';

// ---------------- 말투 ----------------
// 엔진과 규칙표의 문장은 "~함", "~습니다"로 끝나는 것이 있어, 화면에 보일 때 해요체로 바꾼다.
const ENDINGS = [
  [/입니다$/, '이에요'], [/있습니다$/, '있어요'], [/했습니다$/, '했어요'], [/됩니다$/, '돼요'], [/합니다$/, '해요'], [/습니다$/, '어요'],
  [/않음$/, '않아요'], [/없음$/, '없어요'], [/있음$/, '있어요'], [/넘음$/, '넘어요'], [/낮음$/, '낮아요'], [/빠짐$/, '빠져요'], [/줄어듦$/, '줄어들어요'],
  [/끝남$/, '끝나요'], [/끊김$/, '끊겨요'], [/이루어짐$/, '이루어져요'], [/달라짐$/, '달라져요'], [/정해짐$/, '정해져요'], [/생김$/, '생겨요'], [/해짐$/, '해져요'],
  [/가정함$/, '가정했어요'], [/계산함$/, '계산했어요'], [/답함$/, '답했어요'], [/넣음$/, '넣었어요'], [/못함$/, '못했어요'], [/필요함$/, '필요해요'], [/필요$/, '필요해요'],
  [/시작함$/, '시작해요'], [/됨$/, '돼요'], [/함$/, '해요'], [/(계산|기준|값|금액|시간)임$/, '$1이에요'], [/임$/, '예요'], [/기준$/, '기준이에요'],
];
function polite(text) {
  return String(text ?? '').split(/(?<=\.)\s+/).map((sentence) => {
    let body = sentence.replace(/\.$/, '');
    let tail = '';
    const paren = body.match(/^(.*?)(\s*\([^)]*\))$/);
    if (paren) { body = paren[1]; tail = paren[2]; }
    for (const [re, to] of ENDINGS) { if (re.test(body)) { body = body.replace(re, to); break; } }
    return body + tail;
  }).join('. ');
}

// 받침에 맞는 조사를 붙인다. 이름이 숫자로 끝나도 읽는 소리로 판단한다.
function josa(word, withFinal, withoutFinal) {
  const ch = String(word).trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  let final;
  if (code >= 0 && code < 11172) final = code % 28 !== 0;
  else if (/[0-9]/.test(ch)) final = '013678'.includes(ch);
  else final = false;
  return word + (final ? withFinal : withoutFinal);
}

// ---------------- 공통 조각 ----------------

function tag(status) {
  const cls = status === STATUS.CONFIRMED ? 'ok' : status === STATUS.ESTIMATED ? 'est' : 'need';
  return `<span class="tagm ${cls}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

// 만 원 단위로 바꾼다. 조각을 반올림해도 합이 전체의 반올림과 같도록 큰 나머지부터 올린다.
function splitMan(values) {
  const total = Math.round(values.reduce((a, b) => a + b, 0) / 10000);
  const floors = values.map((v) => Math.floor(v / 10000));
  const order = values.map((v, i) => [v / 10000 - floors[i], i]).sort((a, b) => b[0] - a[0]);
  let left = total - floors.reduce((a, b) => a + b, 0);
  for (const [, i] of order) { if (left <= 0) break; floors[i] += 1; left -= 1; }
  return floors;
}
const man = (n) => `${Math.round(n / 10000).toLocaleString('ko-KR')}만 원`;
const manOrWon = (n) => (Math.abs(n) < 10000 ? won(n) : man(n));

// 문턱 막대: 버는 돈이 남는 돈, 보험료·세금, 줄어드는 정부 지원으로 나뉘는 한 줄 막대
function moneyParts(s) {
  const deduct = s.insurance + s.withholding;
  const loss = s.allowanceLoss;
  const kept = Math.max(0, s.addedIncome - deduct - loss);
  const deductName = s.withholding && !s.insurance ? '미리 떼는 세금 3.3%' : s.withholding ? '보험료·세금' : '보험료';
  return { kept, deduct, loss, deductName };
}
// 제목, 범례, 목록이 같은 만 원 값을 쓰도록 한 번만 나눈다.
function manParts(s) {
  const { kept, deduct, loss } = moneyParts(s);
  const [k, d, l] = splitMan([kept, deduct, loss]);
  return { kept: k, deduct: d, loss: l, gross: k + d + l };
}
function moneyBar(s, { scale = null, height = 16, legend = true, lossName = '줄어드는 정부 지원' } = {}) {
  const { kept, deduct, loss, deductName } = moneyParts(s);
  const segs = [['g', kept, '남는 돈'], ['o', deduct, deductName], ['r', loss, lossName]].filter(([, v]) => v > 0);
  const sum = segs.reduce((a, [, v]) => a + v, 0) || 1;
  const width = scale ? Math.min(100, (Math.max(s.addedIncome, sum) / scale) * 100) : 100;
  const mans = splitMan(segs.map(([, v]) => v));
  const label = segs.map(([, v, n], i) => `${n} ${v < 10000 ? won(v) : mans[i] + '만 원'}`).join(', ');
  const bar = `<div class="tbar" style="width:${width.toFixed(1)}%;height:${height}px" role="img" aria-label="${esc(label)}">${segs.map(([c, v]) => `<i class="${c}" style="width:${((v / sum) * 100).toFixed(1)}%"></i>`).join('')}</div>`;
  if (!legend) return bar;
  return bar + `<div class="lgv">${segs.map(([c, v, n], i) => `<div class="${c}"><span>${esc(n)}</span><b>${v < 10000 ? won(v) : mans[i].toLocaleString('ko-KR') + '만 원'}</b></div>`).join('')}</div>`;
}

function row({ ic = null, cls = '', title, sub = '', badge = '', action = '', attrs = '', arrow = Boolean(action) }) {
  const tagName = action ? 'button' : 'div';
  return `<${tagName} class="row" ${action ? `type="button" data-action="${action}" ${attrs}` : ''}>
    ${ic ? `<span class="ic ${cls}">${icon(ic)}</span>` : ''}
    <span class="tx"><b>${title}${badge}</b>${sub ? `<small>${sub}</small>` : ''}</span>
    ${arrow ? `<span class="ch">${icon('ch')}</span>` : ''}
  </${tagName}>`;
}

function cta(label, action, attrs = '') { return `<button type="button" class="cta" data-action="${action}" ${attrs}>${label}</button>`; }
function weak(label, action, attrs = '') { return `<button type="button" class="cta weak" data-action="${action}" ${attrs}>${label}</button>`; }
const two = (a, b) => `<div class="two">${a}${b}</div>`;
const linkBtn = (label, action, attrs = '') => `<button type="button" class="link" data-action="${action}" ${attrs}>${label}${icon('ch')}</button>`;
const why = (text) => `<div class="why"><b>왜 물어보나요?</b>${text}</div>`;
const DISCLAIMER = '<p class="disc">참고용 계산이며 세무·법률 자문과 행정기관의 최종 판단을 대체하지 않습니다<br>AI가 생성한 내용이 포함되어 있습니다</p>';
const AI_NOTICE = `<p class="gline">공고 사진과 글은 AI(Anthropic Claude)가 읽어요. 읽은 뒤 저장하지 않아요. <button type="button" class="inline" data-action="privacy">개인정보 처리 안내</button></p>`;

// ---------------- 시작 ----------------

function sampleSummary(id) {
  const s = SAMPLES.find((x) => x.id === id);
  const f = Object.fromEntries(Object.entries(s.extraction).map(([k, v]) => [k, v.value]));
  const job = { hourlyWage: f.hourlyWage, weeklyHours: f.weeklyHours, startMonth: f.startMonth || 1, months: f.months || 12, incomeType: f.incomeType, holidayIncluded: Boolean(f.holidayIncluded) };
  return evaluate(job, s.profile, state.rules).summary;
}

function viewStart() {
  const s = sampleSummary('cafe');
  return {
    top: 'logo',
    html: `<div class="hero">
      <h1 class="t1">일하기 전에<br><mark>내 돈</mark>부터 확인해요</h1>
      <p class="sub">알바 공고만 올리면 3분이면 돼요</p>
    </div>
    <div class="card pv">
      <span class="chip">예시</span>
      <p class="pvt">주말 카페 알바로 <span class="num">${man(s.addedIncome)}</span>을 벌면,<br>실제로 늘어나는 돈은 <mark class="num">${man(s.net)}</mark>이에요</p>
      ${moneyBar(s)}
    </div>
    <p class="gline center">로그인 없이 바로 써요 · 입력한 내용은 저장하지 않아요</p>
    <p class="gline center"><button type="button" class="inline" data-action="privacy">개인정보 처리 안내</button></p>`,
    bottom: `${cta('공고 올리기', 'go', 'data-step="upload"')}${linkBtn('예시로 먼저 해 보기', 'go', 'data-step="samples"')}`,
  };
}

// ---------------- 공고 올리기 ----------------

function viewUpload() {
  return {
    html: `<h1 class="t2">공고를 어떻게<br>올릴까요?</h1>
    <div class="rows">
      ${row({ ic: 'cam', title: '사진으로 올리기', sub: '공고 캡처나 사진', action: 'mode', attrs: 'data-mode="photo"' })}
      ${row({ ic: 'msg', title: '글 붙여넣기', sub: '문자나 카톡으로 받은 제안', action: 'mode', attrs: 'data-mode="text"' })}
      ${row({ ic: 'pen', title: '직접 입력하기', sub: '시급과 시간만 알아도 돼요', action: 'mode', attrs: 'data-mode="manual"' })}
    </div>
    <p class="sec">공고가 아직 없다면</p>
    <div class="rows">${row({ title: '예시 공고로 해 보기', sub: '카페 알바, 학원 보조, 두 제안 비교', action: 'go', attrs: 'data-step="samples"' })}</div>
    <p class="sec">이런 공고도 읽어요</p>
    <div class="chips"><span>시급</span><span>월급</span><span>일당</span><span>3.3% 떼는 제안</span><span>조건이 빠진 공고</span></div>
    ${AI_NOTICE}`,
  };
}

function viewSamples() {
  const r = (id) => row({ title: SAMPLE_TEXT[id][0], sub: SAMPLE_TEXT[id][1], action: 'sample', attrs: `data-id="${id}"` });
  return {
    html: `<h1 class="t2">어떤 <mark>예시</mark>로<br>해 볼까요?</h1>
    <div class="rows">${r('cafe')}${r('tutor')}${r('store')}
      ${row({ title: '두 제안 비교하기', sub: '카페와 학원을 나란히', action: 'samplePair' })}</div>
    <p class="gline">예시는 지어낸 공고와 인물이에요</p>`,
  };
}

function viewInput() {
  if (state.loading) {
    return { html: `<div class="center-box" role="status"><div class="spin" aria-hidden="true"></div><h1 class="t2">공고를 읽고 있어요</h1><p class="sub">3~5초쯤 걸려요</p></div>` };
  }
  if (state.aiError) {
    const e = state.aiError;
    const title = e.kind === 'notPosting' ? '일자리 공고가<br>아닌 것 같아요' : e.kind === 'photo' ? '사진에서 글자를<br>읽지 못했어요' : '지금은 공고를<br>읽지 못했어요';
    const sub = e.kind === 'notPosting' ? '시급이나 근무시간이 보이지 않아요. 다른 글을 올리거나 직접 입력해 주세요'
      : e.kind === 'photo' ? '다시 올리거나 직접 입력해 주세요' : '잠시 뒤 다시 읽거나 직접 입력해 주세요';
    const tips = e.kind === 'photo' ? '<div class="tips"><p class="tip">글자가 또렷하게 보이게 찍기</p><p class="tip">공고 전체가 한 장에 들어오게 찍기</p></div>' : '';
    return {
      html: `<div class="big">${icon(e.kind === 'notPosting' ? 'file' : 'noread')}</div>
        <h1 class="t2" role="alert">${title}</h1><p class="sub">${esc(sub)}</p>${tips}
        ${e.detail ? `<p class="gline">${esc(e.detail)}</p>` : ''}`,
      bottom: two(weak('다시 읽기', 'retry'), cta('직접 입력하기', 'mode', 'data-mode="manual"')),
    };
  }
  const hint = state.inputHint ? `<p class="gline warn" role="alert">${esc(state.inputHint)}</p>` : '';
  if (state.mode === 'photo') {
    return {
      html: `<h1 class="t2">공고 <mark>사진</mark>을<br>올려 주세요</h1>
      <label class="drop" for="photo">
        <span class="ic">${icon('cam')}</span><b id="photo-name">${state.photoName ? esc(state.photoName) : '사진 고르기'}</b><span>캡처한 화면도 괜찮아요</span>
        <input id="photo" type="file" accept="image/*" class="sr-only">
      </label>
      ${hint}
      <div class="tips"><p class="tip">글자가 또렷하게 보이게</p><p class="tip">공고 전체가 한 장에 들어오게</p><p class="tip">이름과 전화번호는 가리고</p></div>
      ${AI_NOTICE}`,
      bottom: cta('공고 읽기', 'extract'),
    };
  }
  if (state.mode === 'text') {
    return {
      html: `<h1 class="t2">받은 제안을<br><mark>그대로</mark> 붙여 주세요</h1>
      <label class="sr-only" for="raw">공고나 제안 메시지</label>
      <textarea id="raw" class="ta" placeholder="예: 주 3회 저녁 6시~10시, 시급 13,000원, 3.3% 떼고 지급">${esc(state.rawText)}</textarea>
      ${hint}
      <p class="gline">이름과 전화번호는 지우고 붙여 주세요</p>
      ${AI_NOTICE}`,
      bottom: cta('공고 읽기', 'extract'),
    };
  }
  const t = state.manualType || 'unknown';
  const opt = (v, label) => `<button type="button" class="seg-b ${t === v ? 'on' : ''}" data-action="manualType" data-value="${v}" aria-pressed="${t === v}">${label}</button>`;
  return {
    html: `<h1 class="t2">조건을 <mark>직접</mark><br>입력해 주세요</h1>
    <form id="manual" class="form">
      <label for="m-wage">시급</label><div class="unit"><input id="m-wage" type="number" inputmode="numeric" min="0" required placeholder="10,320"><span>원</span></div>
      <label for="m-hours">일주일에 일하는 시간</label><div class="unit"><input id="m-hours" type="number" inputmode="decimal" min="1" max="52" step="0.5" required placeholder="20"><span>시간</span></div>
      <label for="m-start">시작하는 달</label>
      <select id="m-start">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}월</option>`).join('')}</select>
      <label for="m-months">일하는 기간</label><div class="unit"><input id="m-months" type="number" inputmode="numeric" min="1" max="12" value="12" required><span>개월</span></div>
      <p class="lbl">급여를 어떻게 받나요?</p>
      <div class="seg2">${opt('wage', '4대보험 떼고')}${opt('business', '3.3% 떼고')}${opt('daily', '일당으로')}${opt('unknown', '모르겠어요')}</div>
    </form>
    <p class="gline">2026년 최저임금은 시급 ${won(state.rules.minimumWage.hourly)}이에요</p>`,
    bottom: `<button type="submit" form="manual" class="cta">조건 확인하기</button>`,
  };
}

// ---------------- 조건 확인 ----------------

const FIELD_NAME = { hourlyWage: '시급', weeklyHours: '일하는 시간', startMonth: '시작', months: '기간', incomeType: '급여', holidayIncluded: '주휴수당' };
const FIELD_ORDER = ['weeklyHours', 'months', 'hourlyWage', 'startMonth', 'incomeType', 'holidayIncluded'];
const WHY = {
  weeklyHours: '일주일에 15시간이 넘으면 주휴수당과 4대보험이 달라져요. 그래서 시간이 가장 중요해요.',
  months: '부모님 세금 공제 같은 기준은 1년 동안 번 돈으로 봐요. 그래서 몇 달 일하는지가 필요해요.',
  hourlyWage: '모든 금액이 시급에서 시작해요.',
  startMonth: '1년 기준은 1월부터 12월까지 번 돈을 더해서 봐요.',
  incomeType: '4대보험을 떼는지, 3.3%를 떼는지에 따라 적용되는 기준이 달라요.',
  holidayIncluded: '주휴수당을 따로 받으면 한 달 급여가 달라져요.',
};

function valueText(key, f) {
  const v = f.value;
  if (key === 'hourlyWage') return won(v);
  if (key === 'weeklyHours') return `일주일에 ${v}시간`;
  if (key === 'startMonth') return v ? `${v}월` : '모름';
  if (key === 'months') return v ? `${v}개월` : '모름';
  if (key === 'incomeType') return PAY_LABEL[v] || '모름';
  return v ? '시급에 포함' : '따로 받아요';
}
function askText(key, f) {
  const v = f.value;
  if (key === 'weeklyHours') return `일주일에 <mark class="num">${v}시간</mark><br>일하는 게 맞나요?`;
  if (key === 'months') return `<mark class="num">${v}개월</mark> 동안<br>일하는 게 맞나요?`;
  if (key === 'hourlyWage') return `시급이 <mark class="num">${won(v)}</mark>이<br>맞나요?`;
  if (key === 'startMonth') return `<mark class="num">${v}월</mark>부터<br>일하는 게 맞나요?`;
  if (key === 'incomeType') return `급여는 <mark>${esc(PAY_LABEL[v])}</mark>가<br>맞나요?`;
  return `주휴수당을 <mark>${v ? '시급에 포함해' : '따로'}</mark><br>받는 게 맞나요?`;
}

function relevantKeys(f) { return FIELD_ORDER.filter((k) => f[k] && (k !== 'holidayIncluded' || f.incomeType.value === 'wage')); }
function reviewQueue() {
  const f = state.fields;
  return relevantKeys(f).filter((k) => f[k].status === STATUS.ESTIMATED && !state.reviewed.includes(k));
}
function missingFields() {
  const f = state.fields;
  const list = [];
  if (f.incomeType.value === 'unknown' && f.incomeType.evidence !== '모른다고 답함') list.push('incomeType');
  if (!f.startMonth.value) list.push('startMonth');
  if (!f.months.value) list.push('months');
  return list;
}
function beginReview() {
  state.reviewed = [];
  state.reviewTotal = reviewQueue().length + missingFields().length;
}

// 근거 문장 "원문 일부: 설명"에서 원문 부분을 원문 안에 형광펜으로 표시하고, 계산 과정을 한 줄로 보인다.
function evidenceHtml(f) {
  const ev = f.evidence || '';
  const cut = ev.indexOf(': ');
  const quote = cut > 0 ? ev.slice(0, cut) : ev;
  const explain = cut > 0 ? ev.slice(cut + 2) : '';
  let shown = '';
  if (quote) {
    const line = (state.rawText || '').split('\n').find((l) => l.includes(quote));
    shown = line ? esc(line).replace(esc(quote), `<mark>${esc(quote)}</mark>`) : `<mark>${esc(quote)}</mark>`;
  }
  const m = explain.match(/하루\s*([\d.]+)시간\s*×\s*([\d.]+)일/);
  const calc = m ? `<div class="calc" aria-label="계산 과정"><span>하루 ${m[1]}시간</span>×<span>${m[2]}일</span>=<span class="res">${Number(m[1]) * Number(m[2])}시간</span></div>`
    : explain ? `<p class="gline center">${esc(explain)}</p>` : '';
  return (shown ? `<div class="quote"><p class="cap">공고에 이렇게 적혀 있어요</p><p class="q">${shown}</p></div>` : '') + calc;
}

const QUESTIONS = {
  incomeType: { ask: '급여를 어떻게<br>받나요?', why: WHY.incomeType, options: [['wage', '4대보험 떼고 받아요'], ['business', '3.3% 떼고 받아요'], ['daily', '일당으로 그때그때 받아요'], ['unknown', '모르겠어요']] },
  startMonth: { ask: '몇 월부터<br>일하나요?', why: WHY.startMonth, options: Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}월`]), grid: true },
  months: { ask: '몇 개월<br>일할 예정인가요?', why: WHY.months, options: [['1', '1개월'], ['2', '2개월'], ['3', '3개월'], ['6', '6개월'], ['12', '연말까지'], ['0', '모르겠어요']], grid: true },
};

function viewConfirm() {
  const f = state.fields;
  const queue = reviewQueue();
  const missing = missingFields();
  const remaining = queue.length + missing.length;
  const n = Math.max(1, state.reviewTotal - remaining + 1);
  const total = Math.max(state.reviewTotal, n);
  if (queue.length) {
    const key = queue[0];
    return {
      html: `<span class="step">확인 ${n} / ${total}</span>
        <h1 class="t2">${askText(key, f[key])}</h1>
        ${evidenceHtml(f[key])}
        ${why(WHY[key])}`,
      bottom: two(weak('고칠게요', 'editField', `data-key="${key}"`), cta('맞아요', 'reviewOk', `data-key="${key}"`)),
    };
  }
  if (missing.length) {
    const key = missing[0];
    const q = QUESTIONS[key];
    return {
      html: `<span class="step">질문 ${n} / ${total}</span>
        <h1 class="t2">${q.ask}</h1>
        <p class="sub">공고에 적혀 있지 않아서 물어봐요</p>
        <div class="${q.grid ? 'grid3' : 'opts'}">${q.options.map(([v, l]) => `<button type="button" class="opt" data-action="answer" data-key="${key}" data-value="${v}">${esc(l)}</button>`).join('')}</div>
        ${why(q.why)}`,
    };
  }
  const keys = relevantKeys(f);
  const ready = f.hourlyWage.value > 0 && f.weeklyHours.value > 0;
  return {
    html: `<h1 class="t2">이 조건으로<br>계산할게요</h1>
      ${state.extractedBy ? `<p class="gline">AI가 공고를 읽은 결과예요. 틀린 곳은 눌러서 고쳐 주세요</p>` : ''}
      <div class="rows kvs">${keys.map((k) => `<button type="button" class="kv" data-action="editField" data-key="${k}">
        <span class="k">${FIELD_NAME[k]}${f[k].status !== STATUS.CONFIRMED ? `<i class="dot ${f[k].status === STATUS.CHECK ? 'need' : ''}" aria-label="${f[k].status === STATUS.CHECK ? '확인 필요' : '공고를 읽고 계산한 값'}"></i>` : ''}</span>
        <span class="v num">${esc(valueText(k, f[k]))}${icon('ch')}</span></button>`).join('')}</div>
      <p class="legend"><i class="dot"></i>공고를 읽고 계산한 값이에요. 눌러서 고칠 수 있어요</p>
      ${keys.some((k) => f[k].status === STATUS.CHECK) ? '<p class="legend"><i class="dot need"></i>공고에 없어 모르는 값이에요. 사장님께 물어보면 좋아요</p>' : ''}
      ${state.rawText ? `<details class="raw-box"><summary>공고 원문 보기</summary><pre>${esc(state.rawText)}</pre></details>` : ''}
      ${ready ? '' : '<p class="gline warn" role="alert">시급과 일하는 시간을 넣어야 다음으로 갈 수 있어요</p>'}`,
    bottom: state.editing !== null
      ? cta('이 조건으로 저장하기', 'saveDraft', ready ? '' : 'disabled')
      : two(weak('제안 더하기', 'saveAndAdd', ready && state.offers.length < MAX_OFFERS - 0 ? '' : 'disabled'), cta('내 상황 입력하기', 'saveDraft', ready ? '' : 'disabled')),
  };
}

function offerLine(f) {
  return `시급 ${won(f.hourlyWage.value)} · 일주일에 ${f.weeklyHours.value}시간 · ${f.startMonth.value}월부터 ${f.months.value}개월`;
}
function jobOf(f) {
  return { hourlyWage: Number(f.hourlyWage.value), weeklyHours: Number(f.weeklyHours.value), startMonth: Number(f.startMonth.value), months: Number(f.months.value), incomeType: f.incomeType.value, holidayIncluded: Boolean(f.holidayIncluded && f.holidayIncluded.value) };
}
// 주휴수당 항목은 근로소득일 때만 의미가 있어, 그 밖에는 확인 안 된 조건으로 세지 않는다.
function metaOf(f) {
  return Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'holidayIncluded' || f.incomeType.value === 'wage').map(([k, v]) => [k, v.status]));
}

// 확인을 마친 제안을 목록에 넣는다. 수정 중이던 제안이면 그 자리에 덮어쓴다.
function saveDraft() {
  const draft = { fields: state.fields, rawText: state.rawText, extractedBy: state.extractedBy || null };
  if (state.editing !== null && state.offers[state.editing]) {
    state.offers[state.editing] = { ...state.offers[state.editing], ...draft };
  } else {
    const name = state.sample ? SAMPLE_TEXT[state.sample][0] : `제안 ${state.offers.length + 1}`;
    state.offers.push({ name, ...draft });
  }
  Object.assign(state, { editing: null, fields: null, rawText: '', sample: null, extractedBy: null });
}

function viewOffers() {
  const cards = state.offers.map((o, i) => `<div class="card offer">
      <label class="sr-only" for="name-${i}">제안 이름</label>
      <input id="name-${i}" class="name-in" type="text" maxlength="20" data-offer-name="${i}" value="${esc(o.name)}">
      <p class="gline num">${esc(offerLine(o.fields))}</p>
      <div class="acts"><button type="button" data-action="editOffer" data-i="${i}">고치기</button><button type="button" data-action="removeOffer" data-i="${i}">지우기</button></div>
    </div>`).join('');
  const canAdd = state.offers.length < MAX_OFFERS;
  return {
    html: `<h1 class="t2"><mark>제안 ${state.offers.length}개</mark>를<br>저장했어요</h1>
      ${cards || '<p class="gline">저장한 제안이 없어요. 공고를 올려 주세요</p>'}
      ${canAdd ? '<button type="button" class="add" data-action="addOffer">＋ 비교할 제안 더하기</button>' : ''}
      <p class="gline">제안은 ${MAX_OFFERS}개까지 나란히 비교할 수 있어요</p>`,
    bottom: cta('내 상황 입력하기', 'go', `data-step="profile" ${state.offers.length ? '' : 'disabled'}`),
  };
}

// ---------------- 내 상황 (한 화면에 질문 하나) ----------------

function profileQuestions() {
  const age = state.profile.age;
  const maxAge = state.rules.dependentDeduction.impact.basicDeductionMaxAge;
  return ['maxHours', 'allowance', 'age', 'parents', 'ytd', 'others'].map((q) => ({ q, askTax: age == null || age <= maxAge }));
}

function stepper(id, value, unit, min, max) {
  return `<div class="stepper">
    <button type="button" class="sb" data-action="step" data-target="${id}" data-delta="-1" aria-label="1 줄이기">−</button>
    <label class="sv"><span class="sr-only">${unit} 입력</span><input id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${value ?? ''}" placeholder="0"><span>${unit}</span></label>
    <button type="button" class="sb" data-action="step" data-target="${id}" data-delta="1" aria-label="1 늘리기">+</button>
  </div>`;
}
function optBtn(name, value, label, current) {
  const on = String(current) === String(value);
  return `<button type="button" class="opt ${on ? 'on' : ''}" data-action="choose" data-name="${name}" data-value="${value}" aria-pressed="${on}">${esc(label)}<i aria-hidden="true"></i></button>`;
}
function segBtn(name, value, label, current) {
  const on = String(current) === String(value);
  return `<button type="button" class="seg-b ${on ? 'on' : ''}" data-action="choose" data-name="${name}" data-value="${value}" aria-pressed="${on}">${esc(label)}</button>`;
}

function monthGrid(name, current) {
  const cell = (v, label) => { const on = String(current) === String(v); return `<button type="button" class="opt c ${on ? 'on' : ''}" data-action="choose" data-name="${name}" data-value="${v}" aria-pressed="${on}">${label}</button>`; };
  return `<div class="grid4">${Array.from({ length: 12 }, (_, i) => cell(i + 1, `${i + 1}월`)).join('')}</div><div class="grid1">${cell('unknown', '모르겠어요')}</div>`;
}

function viewProfile() {
  const p = state.profile;
  const qs = profileQuestions();
  const i = Math.min(state.profileQ, qs.length - 1);
  const { q, askTax } = qs[i];
  const head = `<span class="step">질문 ${i + 1} / ${qs.length}</span>`;
  const next = i === qs.length - 1 ? cta('결과 보기', 'calculate') : cta('다음', 'nextQ');
  if (q === 'maxHours') {
    const longest = Math.max(0, ...state.offers.map((o) => Number(o.fields.weeklyHours.value) || 0));
    const over = p.maxHours && longest > p.maxHours;
    return {
      html: `${head}<h1 class="t2">일주일에 <mark>최대 몇 시간</mark><br>일할 수 있나요?</h1>
        ${stepper('p-max', p.maxHours, '시간', 1, 52)}
        <div class="chips center">${[15, 20, 30, 40].map((h) => `<button type="button" data-action="setNum" data-target="p-max" data-value="${h}">${h}시간</button>`).join('')}</div>
        ${state.profileError ? `<p class="gline warn" role="alert">${esc(state.profileError)}</p>` : ''}
        ${over ? `<p class="gline">받은 제안(주 ${longest}시간)이 이 시간을 넘어요. 그 제안은 "할 수 있는 시간 초과"로 표시돼요</p>` : ''}
        ${why('이 시간 안에서만 근무조건을 비교해요. 수업이나 훈련 시간은 빼고 알려 주세요.')}`,
      bottom: next,
    };
  }
  if (q === 'allowance') {
    return {
      html: `${head}<h1 class="t2"><mark>구직촉진수당</mark>을<br>받고 있나요?</h1>
        <div class="opts">${optBtn('allowance', 'yes', '받고 있어요', p.allowance)}${optBtn('allowance', 'applying', '신청했어요', p.allowance)}${optBtn('allowance', 'no', '안 받아요', p.allowance)}</div>
        ${p.allowance !== 'no' ? `<p class="lbl">몇 월까지 받나요?</p>${monthGrid('allowanceEndMonth', p.allowanceEndMonth)}
          <p class="gline">구직촉진수당은 최대 6개월 받아요. 끝나는 달은 고용24나 고용센터(1350)에서 확인할 수 있어요</p>` : ''}
        ${why('수당을 받는 동안 돈을 벌면 수당이 줄 수 있어요. 끝나는 달을 알면 그 뒤로는 줄어드는 돈 없이 계산해요.')}`,
      bottom: next,
    };
  }
  if (q === 'age') {
    return {
      html: `${head}<h1 class="t2"><mark>만 나이</mark>가<br>어떻게 되나요?</h1>
        ${stepper('p-age', p.age, '살', 15, 45)}
        ${why('부모님 세금 공제는 자녀가 만 20세 이하일 때만 받을 수 있어요. 21세 이상이면 그 질문은 건너뛰어요.')}`,
      bottom: next,
    };
  }
  if (q === 'parents') {
    const maxAge = state.rules.dependentDeduction.impact.basicDeductionMaxAge;
    return {
      html: `${head}<h1 class="t2">부모님 <mark>${askTax ? '보험과 세금' : '건강보험'}</mark>에<br>올라 있나요?</h1>
        <p class="lbl">부모님 건강보험에 피부양자로 올라 있어요</p>
        <div class="seg3">${segBtn('healthDependent', 'yes', '네', p.healthDependent)}${segBtn('healthDependent', 'no', '아니요', p.healthDependent)}${segBtn('healthDependent', 'unknown', '모르겠어요', p.healthDependent)}</div>
        ${p.healthDependent === 'unknown' ? `<div class="help">
          <p><b>바로 확인할 수 있어요</b>건강보험 자격득실확인서에서 "피부양자"로 나오면 올라 있는 거예요. 간편인증으로 1~2분 걸려요.</p>
          <a href="${LINKS.gov24Health}" target="_blank" rel="noopener">${icon('link')}정부24에서 확인하기</a>
          <a href="${LINKS.nhisHealth}" target="_blank" rel="noopener">${icon('link')}건강보험공단에서 확인하기</a>
          <p class="gline">새 탭으로 열려요. 돌아와도 입력한 내용은 그대로예요</p>
        </div>` : ''}
        ${askTax ? `<p class="lbl">부모님 연말정산에 부양가족으로 올라 있어요</p>
        <div class="seg3">${segBtn('taxDependent', 'yes', '네', p.taxDependent)}${segBtn('taxDependent', 'no', '아니요', p.taxDependent)}${segBtn('taxDependent', 'unknown', '모르겠어요', p.taxDependent)}</div>
        ${p.taxDependent === 'unknown' ? '<p class="gline">부모님 연말정산 서류에 나와요. 부모님께 여쭤보세요</p>' : ''}`
        : `<p class="gline">만 ${maxAge}세를 넘으면 부모님 세금 공제 대상이 아니라서 묻지 않아요</p>`}
        ${why('돈을 벌면 부모님 보험이나 세금이 달라질 수 있어요. 모르면 올라 있다고 보고 계산하고 "확인 필요"로 표시해요.')}`,
      bottom: next,
    };
  }
  if (q === 'ytd') {
    const has = state.ytdOpen || (p.ytdIncome.wage + p.ytdIncome.business + p.ytdIncome.daily) > 0;
    return {
      html: `${head}<h1 class="t2">올해 <mark>이미 번 돈</mark>이<br>있나요?</h1>
        <div class="opts"><button type="button" class="opt ${has ? '' : 'on'}" data-action="ytd" data-value="no" aria-pressed="${!has}">없어요<i aria-hidden="true"></i></button><button type="button" class="opt ${has ? 'on' : ''}" data-action="ytd" data-value="yes" aria-pressed="${has}">있어요<i aria-hidden="true"></i></button></div>
        ${has ? `<div class="form">
          <label for="y-wage">월급으로 받은 돈 (4대보험 떼기 전)</label><div class="unit"><input id="y-wage" type="number" inputmode="numeric" min="0" value="${p.ytdIncome.wage || ''}" placeholder="0"><span>원</span></div>
          <label for="y-business">3.3% 떼고 받은 돈 (떼기 전)</label><div class="unit"><input id="y-business" type="number" inputmode="numeric" min="0" value="${p.ytdIncome.business || ''}" placeholder="0"><span>원</span></div>
          <label for="y-daily">일당으로 받은 돈</label><div class="unit"><input id="y-daily" type="number" inputmode="numeric" min="0" value="${p.ytdIncome.daily || ''}" placeholder="0"><span>원</span></div>
        </div>` : ''}
        ${why('1년 기준은 올해 번 돈을 모두 더해서 봐요.')}`,
      bottom: next,
    };
  }
  const others = Object.entries(state.rules.outOfScope);
  const none = !(p.otherSupports || []).length;
  return {
    html: `${head}<h1 class="t2"><mark>다른 지원</mark>도<br>받고 있나요?</h1>
      <div class="grid2">${others.map(([k, v]) => { const on = (p.otherSupports || []).includes(k); return `<button type="button" class="opt c ${on ? 'on' : ''}" data-action="choose" data-name="otherSupports" data-multi="1" data-value="${k}" aria-pressed="${on}">${esc(v.title)}</button>`; }).join('')}
        <button type="button" class="opt c ${none ? 'on' : ''}" data-action="noSupports" aria-pressed="${none}">없어요</button></div>
      ${(p.otherSupports || []).includes('unemploymentBenefit') ? `<p class="lbl">실업급여는 몇 월까지 받나요?</p>${monthGrid('unemploymentEndMonth', p.unemploymentEndMonth ?? 'unknown')}
        <p class="gline">끝나는 달을 알면, 그 뒤로는 줄어들 실업급여가 없다는 것까지 알려 드려요</p>` : ''}
      <p class="gline">여러 개 고를 수 있어요. 이 지원들은 계산하지 않고 물어볼 곳만 알려 드려요</p>`,
    bottom: next,
  };
}

// ---------------- 결과 ----------------

function shortHealth(c) {
  if (c.crossed) return c.headline.startsWith('한 달') ? ['부모님 건강보험 피부양자에서 빠져요', '한 달 60시간 이상 일하면 직장가입자가 돼요'] : ['부모님 건강보험 피부양자에서 빠져요', `${c.crossMonth}월에 연 소득 기준을 넘어요`];
  return null;
}
// 카드를 쉬운 말 한 줄로 바꾼다. [아이콘, 색, 제목, 설명, 상태 표시]
function cardLine(c) {
  const name = { dependentDeduction: '부모님 세금 공제', healthDependent: '부모님 건강보험', jobSeekerAllowance: '구직촉진수당', weekly15h: '주휴수당 · 4대보험' }[c.id];
  const hold = c.crossed === null;
  if (hold) {
    const pending = c.pending;
    return ['hold', 'gray', name, pending ? esc(polite((c.checks && c.checks[0]) || c.headline)) : '급여를 어떻게 받는지 알아야 계산할 수 있어요', pending ? tag(STATUS.CHECK) : '<span class="tagm hold">계산 보류</span>'];
  }
  const st = c.status !== STATUS.CONFIRMED ? tag(c.status) : '';
  // 기준을 넘지 않았어도 원문 확인이 필요한 항목이 있으면 그대로라고 단정하지 않는다.
  if (!c.crossed && (c.checks || []).length && (c.id === 'healthDependent' || c.id === 'dependentDeduction')) {
    return ['hold', 'gray', name, esc(polite(c.checks[0])), tag(STATUS.CHECK), true];
  }
  if (c.id === 'jobSeekerAllowance') {
    if (c.beforeStart) return ['same', 'gray', '구직촉진수당은 일을 시작하기 전에 끝나요', `${c.endMonth}월까지 받아서 줄어드는 수당이 없어요`, st];
    if (c.ended) return ['down', 'red', '구직촉진수당이 끊겨요', '주 30시간 이상 일자리는 취업으로 봐요', st];
    if (c.crossed && c.paid === 0) return ['down', 'red', '그 달 구직촉진수당을 받지 못해요', `한 달에 ${won(c.flatZone.to)} 이상 벌면 0원이에요`, st];
    if (c.crossed) { const l = manParts(state.result.summary).loss; const until = c.endMonth && c.endMonth < state.result.timeline.end ? `${c.endMonth}월까지 줄고, 그 뒤로는 수당이 끝나요` : `한 달 ${won(c.flatZone.from)}까지는 전액, 넘으면 줄어요`; return ['down', 'red', `구직촉진수당이 월 ${l ? l + '만 원' : won(c.impact.max)}쯤 줄어요`, until, st]; }
    return ['same', 'gray', '구직촉진수당은 그대로예요', `한 달에 ${won(c.flatZone.from)}까지 벌면 전액 받아요`, st];
  }
  if (c.id === 'healthDependent') {
    const h = shortHealth(c);
    if (h) return ['down', 'red', h[0], h[1], st];
    return ['same', 'gray', '부모님 건강보험 피부양자는 그대로예요', '연 소득 2,000만 원 이하예요', st];
  }
  if (c.id === 'dependentDeduction') {
    if (c.crossed) return ['down', 'red', '부모님 세금 공제 대상에서 빠져요', `${c.crossMonth}월에 연 총급여 500만 원을 넘어요`, st];
    return ['same', 'gray', '부모님 세금 공제는 그대로예요', '연 소득 기준을 넘지 않아요', st];
  }
  if (c.crossed) return ['plus', 'green', c.holidayIncluded ? '4대보험에 가입돼요' : '주휴수당과 4대보험이 생겨요', c.holidayIncluded ? '주휴수당은 시급에 포함된 것으로 계산했어요' : '일주일에 15시간 이상이라서예요', st];
  if (c.employmentOnly) return ['plus', 'green', '고용보험에 가입돼요', '3개월 이상 일하면 주 15시간 미만이어도 가입해요', st];
  return null;
}

// 근무조건 비교 결과에서 가장 뜻있는 한 가지를 한 문장으로. 추천이 아니라 비교 기준이다.
function allowanceUntil() {
  const c = state.result && state.result.cards.find((x) => x.id === 'jobSeekerAllowance');
  return c && c.endMonth && !c.beforeStart && c.endMonth < state.result.timeline.end ? c.endMonth : null;
}
function betterOption() {
  const a = state.alts;
  if (!a || a.offeredOutOfRange) return null;
  const at = (h) => a.table.find((t) => t.weeklyHours === h);
  const cur = at(a.offered);
  if (!cur || cur.pendingIds.length) return null;
  if (a.dip && a.offered > a.dip.peakHours && a.dip.peakNet > cur.net) {
    const p = at(a.dip.peakHours);
    return { hours: p.weeklyHours, title: `주 ${p.weeklyHours}시간이면 ${manOrWon(p.net - cur.net)} 더 남아요`, sub: `일하는 시간은 ${a.offered - p.weeklyHours}시간 줄고, 한 달에 ${man(p.net)}이 늘어나요` };
  }
  if (cur.allowanceLoss > 0) {
    const keep = a.table.filter((t) => t.weeklyHours < a.offered && t.allowanceLoss === 0 && t.allowancePaid !== null).pop();
    if (keep) return { hours: keep.weeklyHours, title: `주 ${keep.weeklyHours}시간이면 정부 지원이 그대로예요`, sub: `그때 늘어나는 돈은 한 달 ${man(keep.net)}이에요` };
  }
  return null;
}
function betterOptionAll() {
  const b = betterOptionBase();
  const until = allowanceUntil();
  if (b && b.hours && until) b.sub += ` (수당이 끝나는 ${until}월까지 기준)`;
  return b;
}
function betterOptionBase() {
  const a = state.alts;
  if (!a || a.offeredOutOfRange) return null;
  const at = (h) => a.table.find((t) => t.weeklyHours === h);
  const cur = at(a.offered);
  if (!cur || cur.pendingIds.length) return null;
  const first = betterOption();
  if (first) return first;
  const best = a.table.reduce((b, t) => (t.net > b.net ? t : b), a.table[0]);
  if (best.weeklyHours === a.offered) return { hours: null, title: '할 수 있는 시간 안에서는 지금 조건이 가장 많이 남아요', sub: '근무시간을 바꾸면 어떻게 달라지는지 볼 수 있어요' };
  return null;
}

function resultTitle(r, job) {
  const s = r.summary;
  if (s.net <= 0 && s.addedIncome > 0) {
    return `<h1 class="t2">일해도 한 달 수입이<br><mark class="rd">늘지 않아요</mark></h1>
      <p class="cut">버는 돈 <b class="num">${man(s.addedIncome)}</b>보다 빠지는 돈이 더 커요</p>`;
  }
  const mp = manParts(s);
  // 급여를 어떻게 받는지 모르면 보험료·세금을 뺄 수 없어 "더 생겨요"라고 하지 않는다.
  if (job.incomeType === 'unknown') return `<h1 class="t2">한 달에 <mark class="num">${mp.gross}만 원</mark>을<br>받아요</h1>`;
  if (s.allowanceLoss > 0) {
    const ended = state.result.cards.some((c) => c.ended);
    return `<h1 class="t2"><span class="num">${mp.gross}만 원</span>을 벌지만<br>실제로 늘어나는 돈은<br><mark class="num">${mp.kept}만 원</mark>이에요</h1>
      <p class="cut">${mp.deduct ? '보험료와 ' : ''}${ended ? '끊기는' : '줄어드는'} 정부 지원으로 <mark class="rd"><b class="num">${mp.deduct + mp.loss}만 원</b></mark>이 빠져요</p>`;
  }
  return `<h1 class="t2">한 달에 <mark class="num">${mp.kept}만 원</mark><br>더 생겨요</h1>`;
}

function reportText(t) {
  if (t.includes('구직촉진수당')) return t.includes('취업') ? '취업한 사실을 고용센터에 신고해요' : '수당을 신청할 때마다 번 돈을 신고해요';
  return '다음 해 5월에 종합소득세를 신고해요';
}

function periodLabel(p) { return p.from === p.to ? `${p.from}월` : `${p.from}~${p.to}월`; }
function periodsCard(r) {
  const ps = r.summary.periods;
  if (ps.length < 2) return '';
  return `<p class="sec">달마다 늘어나는 돈</p><div class="rows kvs">${ps.map((p) => `<div class="kv col2"><span class="k"><b>${periodLabel(p)}</b><small>${p.allowancePaid === null ? '수당 끝남' : p.allowancePaid > 0 ? `수당 ${won(p.allowancePaid)} 받음` : '수당 0원'}</small></span><span class="v num">한 달 ${man(p.net)}</span></div>`).join('')}</div>`;
}
function nextPeriodLine(r) {
  const ps = r.summary.periods;
  if (ps.length < 2) return '';
  const later = ps[ps.length - 1];
  return `<p class="cut">${later.from}월부터는 수당이 끝나서 한 달에 <mark><b class="num">${man(later.net)}</b></mark>이 늘어나요</p>`;
}

function viewResult() {
  const r = state.result;
  const s = r.summary;
  const offer = state.offers[state.active];
  const job = jobOf(offer.fields);
  const lines = r.cards.map((c) => [c, cardLine(c)]).filter(([, l]) => l);
  const holds = lines.filter(([c, l]) => c.crossed === null || l[5]);
  const shown = lines.filter(([c, l]) => c.crossed !== null && !l[5]);
  const unknownPay = job.incomeType === 'unknown';
  const better = unknownPay ? null : betterOptionAll();
  const rowOf = ([c, l]) => row({ ic: l[0], cls: l[1], title: esc(l[2]), sub: l[3], badge: l[4], action: 'cardSheet', attrs: `data-id="${c.id}"` });
  const reports = s.reports.map((t) => row({ ic: 'doc', cls: 'blue', title: esc(reportText(t)), sub: t.includes('구직촉진수당') ? '고용센터 · 고용노동부 1350' : '홈택스 · 국세청 126', badge: '<span class="tagm blue">신고</span>' }));
  const pendingLine = holds.length
    ? `<p class="cut">${unknownPay ? `급여를 어떻게 받는지 몰라 ${holds.length}가지는 아직 계산하지 못했어요` : `${holds.length}가지는 확인이 필요해요`}${tag(STATUS.CHECK)}</p>` : '';
  const multi = state.offers.length > 1;
  return {
    html: `<p class="pre">${esc(josa(offer.name, '을', '를'))} 시작하면</p>
      ${resultTitle(r, job)}
      ${nextPeriodLine(r)}
      ${pendingLine}
      <div class="card bcard"><div class="hd"><span>버는 돈</span><b class="num">${man(s.addedIncome)}</b></div>${moneyBar(s, { height: 18 })}</div>
      ${better ? `<button type="button" class="better" data-action="${better.hours ? 'altsAt' : 'go'}" ${better.hours ? `data-hours="${better.hours}"` : 'data-step="alts"'}>
        <span class="tx"><small>근무시간을 바꾸면</small><b>${esc(better.title)}</b><span>${esc(better.sub)}</span></span>${icon('ch')}</button>` : ''}
      ${shown.length || reports.length ? `<p class="sec">달라지는 것</p><div class="rows">${shown.map(rowOf).join('')}${reports.join('')}</div>` : holds.length ? '' : '<p class="gline">지금 조건에서는 지원이나 자격에 달라지는 것이 없어요</p>'}
      ${holds.length ? `<p class="sec">${unknownPay ? '아직 계산하지 못한 것' : '확인이 필요한 것'}</p><div class="rows">${holds.map(rowOf).join('')}</div>
        ${unknownPay ? '<p class="gline">급여를 어떻게 받는지 공고에 없어서예요. 사장님께 물어보면 계산할 수 있어요</p>' : ''}` : ''}
      ${r.outOfScope.length ? `<p class="sec">계산하지 않는 지원</p><div class="rows">${r.outOfScope.map((o) => row({ title: esc(o.title), sub: esc(o.note ? `${polite(o.note)} · ${o.contact}` : o.contact) })).join('')}</div>` : ''}
      ${r.warnings.map((w) => `<p class="gline warn" role="alert">${esc(polite(w))}</p>`).join('')}
      ${periodsCard(r)}
      <div class="card mini"><div class="hd"><b>1년 동안 버는 돈</b><span class="num">12월까지 ${man(r.timeline.rows[11].cumulative.total)}</span></div>${yearBars(r)}</div>
      ${linkBtn('금액 자세히 보기', 'amountSheet')}
      ${r.notApplicable.length ? `<details class="raw-box"><summary>해당 없어 계산하지 않은 것 ${r.notApplicable.length}가지</summary><ul>${r.notApplicable.map((n) => `<li><b>${esc(n.title)}</b> ${esc(polite(n.reason))}</li>`).join('')}</ul></details>` : ''}
      ${r.notices.map((n) => `<p class="gline">${esc(polite(n))}</p>`).join('')}
      ${multi ? linkBtn(`다른 제안과 비교하기`, 'go', 'data-step="compare"') : ''}
      ${DISCLAIMER}`,
    bottom: unknownPay ? two(weak('근무시간 바꿔 보기', 'go', 'data-step="alts"').replace('cta weak', 'cta weak eq'), cta('물어볼 말 보기', 'go', 'data-step="basis"'))
      : two(weak('준비물 보기', 'go', 'data-step="basis"'), cta('근무시간 바꿔 보기', 'go', 'data-step="alts"')),
  };
}

function yearBars(r) {
  const rows = r.timeline.rows;
  const max = Math.max(1, rows[11].cumulative.total);
  return `<div class="bars" role="img" aria-label="1월부터 12월까지 누적 소득. 12월까지 ${won(rows[11].cumulative.total)}">${rows.map((row) => `<i class="${row.working ? '' : 'off'}" style="height:${Math.max(3, Math.round((row.cumulative.total / max) * 100))}%"></i>`).join('')}</div>
    <div class="bars-x" aria-hidden="true">${rows.map((row) => `<span>${row.month}</span>`).join('')}</div>`;
}

// ---------------- 제안 비교 ----------------

function viewCompare() {
  const c = state.comparison;
  const rows = c.rows;
  const scale = Math.max(...rows.map((r) => r.gross));
  const h = c.highlights;
  const title = rows.length > 1 && h.net !== -1 && h.netPerHour !== -1 && h.net !== h.netPerHour
    ? '<mark>한 달</mark>에 더 남는 제안과<br><mark>시간당</mark> 더 남는 제안이 달라요'
    : `제안 ${rows.length}개를<br><mark>같은 기준</mark>으로 계산했어요`;
  const lead = (i) => (rows.length > 1 && h.net === i ? '<span class="tagm ok">한 달 금액이 가장 커요</span>' : '') + (rows.length > 1 && h.netPerHour === i ? '<span class="tagm ok">시간당 금액이 가장 커요</span>' : '');
  return {
    html: `<h1 class="t2">${title}</h1>
      ${rows.map((r, i) => `<button type="button" class="cmp" data-action="detail" data-i="${i}">
        <span class="top"><span class="nm"><b>${esc(r.name)}</b>일주일에 ${r.job.weeklyHours}시간 · ${r.workedMonths}개월</span><span class="amt2 num">${man(r.net)}</span></span>
        ${moneyBar(r.result.summary, { scale, height: 12, legend: false })}
        <span class="meta"><span class="num">시간당 ${won(r.netPerHour)}</span>${lead(i)}${r.allowanceLoss ? '<span class="tagm need">정부 지원 줄어듦</span>' : ''}${r.result.summary.pendingIds.length ? `<span class="tagm need">확인 필요 ${r.result.summary.pendingIds.length}</span>` : ''}${r.withinHours ? '' : '<span class="tagm hold">할 수 있는 시간 초과</span>'}</span>
      </button>`).join('')}
      <div class="lg"><span>남는 돈</span><span class="o">보험료·세금</span><span class="r">줄어드는 정부 지원</span></div>
      <p class="gline">금액은 한 달에 늘어나는 돈이에요. 고르는 건 내 몫이에요. 카드를 누르면 자세히 볼 수 있어요</p>`,
    bottom: two(weak('제안 더하기', 'addOffer', state.offers.length < MAX_OFFERS ? '' : 'disabled'), cta('내 상황 바꾸기', 'go', 'data-step="profile"')),
  };
}

// ---------------- 근무조건 비교 ----------------

function altsTitle(a) {
  const loss = a.changePoints.find((c) => c.changes.some((x) => x.type === 'loss'));
  if (loss) {
    const x = loss.changes.find((y) => y.type === 'loss');
    const what = x.text.includes('끝남') ? '정부 지원이 끊겨요' : x.text.includes('지급되지') ? '정부 지원을 받지 못해요' : '정부 지원이 줄기 시작해요';
    return `<mark class="num">주 ${loss.weeklyHours}시간</mark>부터<br>${what}`;
  }
  const gain = a.changePoints.find((c) => c.changes.some((x) => x.type === 'gain'));
  if (gain) return `<mark class="num">주 ${gain.weeklyHours}시간</mark>부터<br>주휴수당과 4대보험이 생겨요`;
  return '할 수 있는 시간 안에서는<br><mark>달라지는 게 없어요</mark>';
}

function altOptions(a) {
  const at = (h) => a.table.find((t) => t.weeklyHours === h);
  const list = [];
  const add = (h, name) => { const t = at(h); if (t && !list.some((x) => x.weeklyHours === h)) list.push({ ...t, name }); };
  if (!a.offeredOutOfRange) add(a.offered, '받은 제안 그대로');
  if (a.dip) add(a.dip.peakHours, '가장 많이 남는 시간');
  const keep = a.table.filter((t) => t.allowanceLoss === 0 && t.allowancePaid !== null).pop();
  if (keep && a.table.some((t) => t.allowanceLoss > 0)) add(keep.weeklyHours, '정부 지원이 그대로인 가장 긴 시간');
  add(a.trace.to, '내가 할 수 있는 최대 시간');
  return list.sort((x, y) => x.weeklyHours - y.weeklyHours);
}

function viewAlts() {
  const a = state.alts;
  const opts = altOptions(a);
  const chosen = state.chosenHours ?? (a.offeredOutOfRange ? a.trace.to : a.offered);
  const scale = Math.max(...opts.map((o) => o.gross));
  const sumOf = (o) => ({ addedIncome: o.gross, insurance: o.gross - o.takeHome, withholding: 0, allowanceLoss: o.allowanceLoss });
  const typeIcon = { gain: ['plus', 'green'], loss: ['down', 'red'], check: ['down', 'red'], pending: ['hold', 'gray'], note: ['plus', 'green'] };
  return {
    html: `<h1 class="t2">${altsTitle(a)}</h1>
      ${a.offeredOutOfRange ? `<p class="gline warn">받은 제안(주 ${a.offered}시간)은 할 수 있는 시간을 넘어 비교에서 뺐어요</p>` : ''}
      <div role="radiogroup" aria-label="비교할 근무시간">${opts.map((o) => `<button type="button" role="radio" aria-checked="${o.weeklyHours === chosen}" class="opc ${o.weeklyHours === chosen ? 'on' : ''}" data-action="chooseHours" data-hours="${o.weeklyHours}">
        <span class="top"><span class="nm num">주 ${o.weeklyHours}시간</span><span class="am">늘어나는 돈 <b class="num">${man(o.net)}</b></span></span>
        <span class="gl2">${esc(o.name)}</span>
        ${moneyBar(sumOf(o), { scale, height: 12, legend: false })}
      </button>`).join('')}</div>
      <div class="lg"><span>남는 돈</span><span class="o">보험료</span><span class="r">줄어드는 정부 지원</span></div>
      ${a.changePoints.length ? `<p class="sec">달라지는 지점</p><div class="rows">${a.changePoints.map((c) => {
        const x = c.changes[0];
        const [ic, cls] = typeIcon[x.type] || ['hold', 'gray'];
        return row({ ic, cls, title: `주 ${c.weeklyHours}시간부터`, sub: esc(c.changes.map((y) => polite(y.text)).join(' · ')) });
      }).join('')}</div>` : ''}
      ${a.dip ? `<p class="gline">주 ${a.dip.from}~${a.dip.to}시간은 주 ${a.dip.peakHours}시간(한 달 ${man(a.dip.peakNet)})보다 남는 돈이 적어요. 줄어드는 정부 지원이 늘어나는 급여보다 커서예요</p>` : ''}
      ${allowanceUntil() ? `<p class="gline">수당이 끝나는 ${allowanceUntil()}월까지 기준이에요. ${allowanceUntil() + 1}월부터는 줄어드는 수당이 없어서 일한 만큼 늘어나요</p>` : ''}
      <p class="gline">시급과 기간은 그대로 두고 근무시간만 1시간씩 바꿔 ${a.trace.evaluated}번 계산했어요. 고르는 건 내 몫이에요</p>`,
    bottom: two(weak('준비물 보기', 'go', 'data-step="basis"'), cta('이 시간으로 문구 만들기', 'go', 'data-step="message"')),
  };
}

function requestState() {
  const a = state.alts;
  const offered = a.offered;
  const target = state.chosenHours ?? (a.offeredOutOfRange ? a.trace.to : offered);
  const available = Object.keys(REQUEST_ACTIONS).filter((k) => {
    if (k === 'expand') return target > offered;
    if (k === 'adjust') return target < offered;
    if (k === 'accept') return target === offered && !a.offeredOutOfRange;
    return true;
  });
  const fallback = target > offered ? 'expand' : target < offered ? 'adjust' : a.offeredOutOfRange ? 'terms' : 'accept';
  const action = available.includes(state.requestAction) ? state.requestAction : fallback;
  return { offered, target, available, action };
}
const ACTION_LABEL = { expand: '시간 늘리기 요청', adjust: '시간 조정 요청', terms: '급여 조건 확인', accept: '그대로 수락' };

function messageText() {
  const rq = requestState();
  const questions = state.comparison.rows[state.active].questions;
  return buildRequestMessage(rq.action, { offeredHours: rq.offered, targetHours: rq.target, questions: rq.action === 'expand' || rq.action === 'adjust' ? questions.filter((q) => !q.includes('근무시간')) : questions });
}

function viewMessage() {
  const rq = requestState();
  return {
    html: `<h1 class="t2">사장님께 보낼<br><mark>문구</mark>를 만들었어요</h1>
      <p class="gline num">주 ${rq.target}시간 기준</p>
      <div class="chips sel" role="radiogroup" aria-label="요청 종류">${rq.available.map((k) => `<button type="button" role="radio" aria-checked="${k === rq.action}" class="${k === rq.action ? 'on' : ''}" data-action="reqAction" data-value="${k}">${esc(ACTION_LABEL[k])}</button>`).join('')}</div>
      <pre class="msg" id="msg">${esc(messageText())}</pre>
      <p class="gline">근무시간과 일정만 담았어요. 고쳐서 보내도 돼요</p>
      ${linkBtn('다른 시간으로 바꾸기', 'go', 'data-step="alts"')}`,
    bottom: two(weak('준비물 보기', 'go', 'data-step="basis"'), cta('문구 복사하기', 'copy')),
  };
}

// ---------------- 시작 전 준비 ----------------

function viewBasis() {
  const r = state.result;
  const rules = state.rules;
  const questions = state.comparison.rows[state.active].questions;
  const reports = r.summary.reports.map(reportText);
  const checks = [...r.checks.map((c) => polite(c.text)), ...r.outOfScope.filter((o) => o.note).map((o) => `${o.title}: ${polite(o.note)}`)];
  let n = 0;
  const box = (t, extra = '') => `<label class="chk"><input type="checkbox" data-check="${n++}"><span>${esc(t)}${extra}</span></label>`;
  const groups = [
    ['사장님께 물어볼 것', questions.map((q) => box(q))],
    ['신고할 것', reports.map((q) => box(q, ' <span class="tagm blue">신고</span>'))],
    ['확인할 것', checks.map((q) => box(q))],
  ].filter(([, items]) => items.length);
  const total = n;
  const allowanceNote = r.cards.some((c) => c.id === 'jobSeekerAllowance')
    ? '<p class="gline">수당 지급 정지가 3번이 되면 수급자격이 철회돼요. 신고하지 않고 받으면 받은 돈을 돌려주고 같은 금액을 더 내야 해요</p>' : '';
  const contacts = Object.values(rules.contacts).map((c) => `<a class="kv" href="tel:${esc(c.phone)}"><span class="k">${esc(c.name)}</span><span class="v num">${esc(c.phone)}${icon('phone')}</span></a>`).join('');
  const others = r.outOfScope.map((o) => `<div class="kv"><span class="k">${esc(o.title)}</span><span class="v small">${esc(o.contact)}</span></div>`).join('');
  const sources = r.cards.map((c) => {
    const rule = rules[c.id];
    const list = c.sources.map((id) => rules.sources[id]).filter(Boolean);
    return `<li><b>${esc(c.title)}</b> ${tag(c.status)}<br>${list.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join('<br>')}<br><span class="small">확인일 ${esc(rule.checkedAt || (rule.current && rule.current.checkedAt) || rules.version)}</span></li>`;
  }).join('');
  return {
    html: `<h1 class="t2">시작하기 전에<br>${total ? `<mark>${total}가지</mark>만 챙겨요` : '<mark>챙길 것이 없어요</mark>'}</h1>
      ${groups.map(([t, items]) => `<p class="sec">${t}</p><div class="rows checks">${items.join('')}</div>`).join('')}
      ${allowanceNote}
      <p class="sec">물어볼 곳</p><div class="rows kvs">${contacts}${others}</div>
      <details class="raw-box"><summary>계산 근거와 출처</summary>
        <p class="small">규칙표 ${esc(rules.version)} 기준. 확실은 법령·고시 원문을 확인한 규칙, 어림값은 2차 자료로 계산한 값, 확인 필요는 원문을 확인하지 못한 규칙이에요.</p>
        <ul class="src">${sources}</ul></details>
      <p class="gline">신고를 피하는 방법은 알려 드리지 않아요</p>
      <p class="gline center"><button type="button" class="inline" data-action="restart">내 입력 모두 지우기</button></p>`,
    bottom: two(weak('처음으로', 'restart'), cta('다른 공고 올리기', 'newOffer')),
  };
}

// ---------------- 개인정보 처리 안내 ----------------

function viewPrivacy() {
  return {
    top: 'back',
    html: `<h1 class="t2">개인정보 처리 안내</h1>
      <p class="sec">무엇을 어디로 보내나요</p>
      <div class="rows kvs">
        <div class="kv col"><span class="k">공고 사진과 글</span><span class="v small">문턱 서버를 거쳐 Anthropic(미국)의 AI가 읽어요. 문턱 서버는 저장하지 않아요</span></div>
        <div class="kv col"><span class="k">내 상황 (나이, 근무 시간, 번 돈, 받는 지원)</span><span class="v small">이 브라우저 안에서만 계산에 써요. 서버로 보내지 않아요</span></div>
        <div class="kv col"><span class="k">로그인 · 쿠키 · 분석 도구</span><span class="v small">쓰지 않아요</span></div>
        <div class="kv col"><span class="k">글꼴</span><span class="v small">Pretendard 글꼴을 공개 서비스 jsDelivr에서 불러와요</span></div>
      </div>
      <p class="sec">꼭 지켜 주세요</p>
      <p class="gline">공고에 있는 이름, 전화번호, 주소는 지우거나 가리고 올려 주세요. AI로 보내는 내용에는 개인정보가 없어야 해요</p>
      <p class="sec">보관과 지우기</p>
      <p class="gline">입력한 내용은 이 탭에만 임시로 남고, 탭을 닫으면 사라져요. 지금 바로 지우려면 아래 버튼을 눌러 주세요</p>
      <p class="gline">AI 회사가 받은 내용을 처리하는 방식은 <a href="${LINKS.anthropicPrivacy}" target="_blank" rel="noopener">Anthropic 개인정보 처리방침</a>을 따라요</p>
      <p class="sec">만든 사람 · 문의</p>
      <p class="gline">문턱 팀 · 2026 대한민국 청년 CAREER FAIR AI 해커톤 출품작<br><a href="${LINKS.repo}" target="_blank" rel="noopener">GitHub 저장소</a>의 Issues로 문의해 주세요</p>
      ${DISCLAIMER}`,
    bottom: two(weak('내 입력 모두 지우기', 'restart').replace('cta weak', 'cta weak eq'), cta('돌아가기', 'back')),
  };
}

// ---------------- 아래에서 올라오는 창 ----------------

function sheetEdit(key) {
  const f = state.fields[key];
  let body = '';
  if (key === 'weeklyHours') body = stepper('e-val', f.value, '시간', 1, 52) + `<div class="chips center">${[15, 20, 24, 30].map((h) => `<button type="button" data-action="setNum" data-target="e-val" data-value="${h}">${h}시간</button>`).join('')}</div>`;
  else if (key === 'hourlyWage') body = `<div class="form"><label for="e-val">시급</label><div class="unit"><input id="e-val" type="number" inputmode="numeric" min="0" value="${f.value ?? ''}"><span>원</span></div></div>`;
  else if (key === 'months') body = `<div class="grid3">${Array.from({ length: 12 }, (_, i) => `<button type="button" class="opt c ${f.value === i + 1 ? 'on' : ''}" data-action="sheetPick" data-value="${i + 1}">${i + 1}개월</button>`).join('')}</div>`;
  else if (key === 'startMonth') body = `<div class="grid3">${Array.from({ length: 12 }, (_, i) => `<button type="button" class="opt c ${f.value === i + 1 ? 'on' : ''}" data-action="sheetPick" data-value="${i + 1}">${i + 1}월</button>`).join('')}</div>`;
  else if (key === 'incomeType') body = `<div class="opts">${Object.entries(PAY_LABEL).map(([v, l]) => `<button type="button" class="opt ${f.value === v ? 'on' : ''}" data-action="sheetPick" data-value="${v}">${esc(l)}<i aria-hidden="true"></i></button>`).join('')}</div>`;
  else body = `<div class="opts"><button type="button" class="opt ${f.value ? '' : 'on'}" data-action="sheetPick" data-value="false">시급과 따로 받아요<i aria-hidden="true"></i></button><button type="button" class="opt ${f.value ? 'on' : ''}" data-action="sheetPick" data-value="true">시급에 포함돼 있어요<i aria-hidden="true"></i></button></div>`;
  const numeric = ['weeklyHours', 'hourlyWage'].includes(key);
  return `<h2 id="sheet-title">${FIELD_NAME[key]}을 고쳐 주세요</h2>${body}
    ${two(weak('닫기', 'closeSheet'), numeric ? cta('이 값으로 바꾸기', 'saveEdit', `data-key="${key}"`) : '')}`;
}

function sheetAmounts() {
  const s = state.result.summary;
  const rows = s.parts.map((x) => `<div class="amt"><span class="k">${esc(x.label === '4대보험 근로자 부담분' ? '보험료 (4대보험)' : x.label)}${tag(x.status)}</span><span class="n ${x.amount < 0 ? 'minus' : ''}">${x.amount < 0 ? '−' : '+'}${won(Math.abs(x.amount))}</span></div>`).join('');
  return `<h2 id="sheet-title">이렇게 계산했어요</h2>${rows}
    <div class="sum"><span>한 달에 늘어나는 돈${s.periods.length > 1 ? ` (${periodLabel(s.periods[0])})` : ''}</span><span class="n">${won(s.net)}</span></div>
    ${s.periods.length > 1 ? s.periods.slice(1).map((p) => `<div class="amt"><span class="k">${periodLabel(p)} (수당 끝난 뒤)</span><span class="n">${won(p.net)}</span></div>`).join('') : ''}
    ${s.estimatedParts.length ? `<p class="gline">어림값: ${s.estimatedParts.map((x) => `${esc(x.label)} (${esc(polite(x.reason || '2차 자료 기준'))})`).join(', ')}</p>` : ''}
    <p class="gline">넣지 않은 것: ${esc(s.excluded.join(', '))}</p>
    ${cta('닫기', 'closeSheet')}`;
}

function sheetCard(id) {
  const c = state.result.cards.find((x) => x.id === id);
  const rules = state.rules;
  const l = cardLine(c) || ['', '', c.title, c.headline];
  const kv = (k, v) => `<div class="amt"><span class="k">${k}</span><span class="n">${v}</span></div>`;
  let body = '';
  if (c.id === 'jobSeekerAllowance') {
    body = kv('지금 받는 수당', won(rules.jobSeekerAllowance.monthlyAllowance)) + kv('일을 시작하면', won(c.paid)) + (c.impact.max ? `<div class="amt"><span class="k">${esc(c.impact.text)}</span><span class="n minus">−${won(c.impact.max)}</span></div>` : '');
  }
  if (c.proposed) body += kv('지금 기준', esc(c.limitText)) + kv('개정안 (국회 미확정)', esc(c.proposed.limitText));
  else if (c.limitText) body += `<p class="sec">기준</p><p class="gline">${esc(c.limitText)}</p>`;
  return `<h2 id="sheet-title">${esc(l[2])} ${tag(c.status)}</h2>
    <p class="gline">${esc(polite(c.headline))}</p>${body}
    ${(c.checks || []).length ? `<p class="sec">확인할 것</p>${c.checks.map((t) => `<p class="gline">${esc(polite(t))}</p>`).join('')}` : ''}
    ${c.notes.length ? `<p class="sec">알아 둘 것</p>${c.notes.map((t) => `<p class="gline">${esc(polite(t))}</p>`).join('')}` : ''}
    <p class="sec">근거</p>${c.sources.map((sid) => rules.sources[sid]).filter(Boolean).map((s) => `<p class="gline"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></p>`).join('')}
    ${cta('닫기', 'closeSheet')}`;
}

function renderSheet() {
  const sh = state.sheet;
  if (!sh) { sheetEl.hidden = true; sheetEl.innerHTML = ''; return; }
  const body = sh.type === 'edit' ? sheetEdit(sh.key) : sh.type === 'amounts' ? sheetAmounts() : sheetCard(sh.id);
  sheetEl.hidden = false;
  sheetEl.innerHTML = `<div class="dim" data-action="closeSheet"></div><div class="panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><div class="hdl" aria-hidden="true"></div>${body}</div>`;
  (sheetEl.querySelector('.panel input') || sheetEl.querySelector('.panel'))?.focus({ preventScroll: true });
}

// ---------------- 그리기 ----------------

// 새로고침해도 입력이 남도록 이 탭의 세션 저장소에 둔다. 탭을 닫으면 지워지고 서버로는 보내지 않는다.
const STORE_KEY = 'munteok-state-v2';
const SAVED_KEYS = ['step', 'mode', 'rawText', 'fields', 'profile', 'offers', 'editing', 'active', 'sample', 'extractedBy', 'manualType', 'reviewed', 'reviewTotal', 'profileQ', 'chosenHours', 'requestAction'];

function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(SAVED_KEYS.map((k) => [k, state[k]]))));
  } catch (e) { /* 저장소를 쓸 수 없으면 저장 없이 동작한다 */ }
}

function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (!saved || !VIEWS[saved.step]) return;
    Object.assign(state, saved);
    if (['compare', 'result', 'alts', 'message', 'basis'].includes(state.step)) {
      if (!state.offers.length) { state.step = 'start'; return; }
      recalculate();
      openOffer(Math.min(state.active || 0, state.offers.length - 1), true);
    }
    if (state.step === 'confirm' && !state.fields) state.step = state.offers.length ? 'offers' : 'start';
  } catch (e) {
    sessionStorage.removeItem(STORE_KEY);
    state.step = 'start';
  }
}

function recalculate() {
  const maxHours = state.profile.maxHours || 40;
  state.comparison = compareOffers(state.offers.map((o) => ({ name: o.name, job: jobOf(o.fields), meta: metaOf(o.fields) })), state.profile, state.rules, { maxHours });
}

function openOffer(i, keepChoice = false) {
  const job = jobOf(state.offers[i].fields);
  state.active = i;
  state.result = state.comparison.rows[i].result;
  state.alts = searchAlternatives(job, state.profile, state.rules, { maxHours: state.profile.maxHours || 40 });
  if (!keepChoice) { state.chosenHours = null; state.requestAction = null; }
}

const VIEWS = { start: viewStart, upload: viewUpload, samples: viewSamples, input: viewInput, confirm: viewConfirm, offers: viewOffers, profile: viewProfile, compare: viewCompare, result: viewResult, alts: viewAlts, message: viewMessage, basis: viewBasis, privacy: viewPrivacy };

function topHtml(v) {
  if (v.top === 'logo') return `<span class="logo">${LOGO}<span>문턱</span></span>`;
  const group = STEP_GROUP[state.step];
  const seg = group === undefined ? '' : `<div class="seg" role="progressbar" aria-label="진행 단계" aria-valuemin="1" aria-valuemax="6" aria-valuenow="${group + 1}">${Array.from({ length: 6 }, (_, i) => `<i class="${i <= group ? 'on' : ''}"></i>`).join('')}</div>`;
  return `<button type="button" class="backb" data-action="back" aria-label="뒤로 가기">${icon('back')}</button>${seg}`;
}

function render(keepScroll = false) {
  const y = window.scrollY;
  const v = VIEWS[state.step]();
  topEl.innerHTML = topHtml(v);
  app.innerHTML = v.html;
  barEl.innerHTML = v.bottom || '';
  barEl.hidden = !v.bottom;
  app.style.paddingBottom = v.bottom ? `${barEl.offsetHeight + 24}px` : '32px';
  renderSheet();
  window.scrollTo(0, keepScroll ? y : 0);
  persist();
}

// ---------------- 동작 ----------------

function saveProfileInputs() {
  const num = (id) => { const el = document.getElementById(id); return el ? (el.value !== '' ? Number(el.value) : null) : undefined; };
  const max = num('p-max');
  if (max !== undefined) state.profile.maxHours = max ? Math.min(52, Math.max(1, Math.round(max))) : null;
  const age = num('p-age');
  if (age !== undefined) state.profile.age = age;
  if (document.getElementById('y-wage')) state.profile.ytdIncome = { wage: num('y-wage') || 0, business: num('y-business') || 0, daily: num('y-daily') || 0 };
}

function back() {
  const s = state.step;
  state.aiError = null; state.inputHint = null; state.profileError = null;
  if (s === 'privacy') state.step = state.returnStep || 'start';
  else if (s === 'upload') state.step = state.offers.length ? 'offers' : 'start';
  else if (s === 'samples' || s === 'input') state.step = 'upload';
  else if (s === 'confirm') {
    if (state.reviewed.length && reviewQueue().length + missingFields().length < state.reviewTotal) state.reviewed.pop();
    else state.step = state.editing !== null ? 'offers' : 'upload';
  } else if (s === 'offers') state.step = 'upload';
  else if (s === 'profile') { saveProfileInputs(); if (state.profileQ > 0) state.profileQ -= 1; else state.step = 'offers'; }
  else if (s === 'compare') { state.step = 'profile'; state.profileQ = profileQuestions().length - 1; }
  else if (s === 'result') { if (state.offers.length > 1) state.step = 'compare'; else { state.step = 'profile'; state.profileQ = profileQuestions().length - 1; } }
  else if (s === 'alts' || s === 'basis') state.step = 'result';
  else if (s === 'message') state.step = 'alts';
  else state.step = 'start';
}

function resetAll() {
  Object.assign(state, { step: 'start', sample: null, rawText: '', fields: null, profile: clone(EMPTY_PROFILE), result: null, alts: null, aiError: null, offers: [], editing: null, comparison: null, reviewed: [], reviewTotal: 0, profileQ: 0, ytdOpen: false, chosenHours: null, requestAction: null, sheet: null, photoFile: null, photoName: null, manualType: null });
  try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ }
}

// 사진을 긴 변 1600px 이하 JPEG로 줄여 base64로 바꾼다. 전송량과 비용을 줄이기 위해서다.
function imageToBase64(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진 파일을 열지 못했어요')); };
    img.src = url;
  });
}

async function tryExtract() {
  const raw = document.getElementById('raw');
  if (raw) state.rawText = raw.value;
  state.aiError = null; state.inputHint = null;
  const body = {};
  if (state.mode === 'photo') {
    if (!state.photoFile) { state.inputHint = '사진을 먼저 골라 주세요'; render(true); return; }
    try { body.image = { mediaType: 'image/jpeg', data: await imageToBase64(state.photoFile) }; } catch (e) { state.aiError = { kind: 'photo', detail: e.message }; render(); return; }
    state.rawText = '';
  } else {
    if (!state.rawText.trim()) { state.inputHint = '공고나 메시지를 붙여 넣어 주세요'; render(true); return; }
    body.text = state.rawText;
  }
  if (!AI_AVAILABLE) { state.aiError = { kind: 'server', detail: '이 주소에서는 AI 서버가 연결되지 않았어요' }; render(); return; }
  state.loading = true;
  render();
  try {
    const res = await fetch(API_BASE + 'api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const kind = res.status === 422 ? 'notPosting' : state.mode === 'photo' && res.status === 400 ? 'photo' : 'server';
      throw Object.assign(new Error(data.error || ''), { kind });
    }
    state.fields = withDefaults(data.fields);
    state.extractedBy = data.model || 'AI';
    state.sample = null;
    beginReview();
    state.step = 'confirm';
  } catch (e) {
    state.aiError = { kind: e.kind || (state.mode === 'photo' ? 'photo' : 'server'), detail: e.kind === 'server' || e instanceof TypeError ? '' : '' };
  }
  state.loading = false;
  render();
}

// 주휴수당 포함 여부는 공고에 잘 적히지 않는다. 값이 없으면 "시급과 별도"로 가정하고 추정으로 표시한다.
function withDefaults(fields) {
  if (!fields.holidayIncluded) fields.holidayIncluded = { value: false, status: STATUS.ESTIMATED, evidence: '적혀 있지 않아 시급과 별도로 지급된다고 가정' };
  return fields;
}
function emptyFields() {
  const blank = (v) => ({ value: v, status: STATUS.CHECK, evidence: '' });
  return withDefaults({ hourlyWage: blank(null), weeklyHours: blank(null), startMonth: blank(null), months: blank(null), incomeType: blank('unknown') });
}

app.addEventListener('submit', (e) => {
  if (e.target.id !== 'manual') return;
  e.preventDefault();
  const set = (v) => ({ value: v, status: STATUS.CONFIRMED, evidence: '직접 입력' });
  const type = state.manualType || 'unknown';
  state.fields = withDefaults({
    hourlyWage: set(Number(document.getElementById('m-wage').value)),
    weeklyHours: set(Number(document.getElementById('m-hours').value)),
    startMonth: set(Number(document.getElementById('m-start').value)),
    months: set(Number(document.getElementById('m-months').value)),
    incomeType: type === 'unknown' ? { value: 'unknown', status: STATUS.CHECK, evidence: '모른다고 답함' } : set(type),
  });
  Object.assign(state, { rawText: '', sample: null, extractedBy: null, step: 'confirm' });
  beginReview();
  render();
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'photo' && t.files[0]) {
    state.photoFile = t.files[0];
    state.photoName = t.files[0].name;
    state.inputHint = null;
    const n = document.getElementById('photo-name');
    if (n) n.textContent = state.photoName;
    return;
  }
  if (t.dataset.offerName !== undefined) {
    const o = state.offers[Number(t.dataset.offerName)];
    if (o) { o.name = t.value.trim() || o.name; persist(); }
    return;
  }
  if (state.step === 'profile') { saveProfileInputs(); persist(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.sheet) { state.sheet = null; renderSheet(); }
  // 아래에서 올라오는 창 안에서만 Tab이 돌게 한다.
  if (e.key === 'Tab' && state.sheet) {
    const items = [...sheetEl.querySelectorAll('.panel button, .panel input, .panel a')];
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  const keep = () => render(true);
  switch (a) {
    case 'go': {
      saveProfileInputs();
      const to = el.dataset.step;
      if (to === 'upload' && state.step === 'start') resetAll();
      if (to === 'profile') state.profileQ = state.step === 'offers' || state.step === 'confirm' ? 0 : profileQuestions().length - 1;
      state.step = to; state.aiError = null; state.inputHint = null;
      if (to === 'upload' && !state.fields) state.fields = emptyFields();
      break;
    }
    case 'back': back(); break;
    case 'privacy': state.returnStep = state.step; state.step = 'privacy'; break;
    case 'mode':
      state.mode = el.dataset.mode; state.aiError = null; state.inputHint = null; state.step = 'input';
      break;
    case 'retry': {
      // 서버 문제면 같은 공고를 다시 읽고, 공고가 아니거나 사진을 못 읽었으면 다시 올리는 화면으로 간다.
      const kind = state.aiError && state.aiError.kind;
      state.aiError = null;
      if (kind === 'server') { tryExtract(); return; }
      break;
    }
    case 'extract': tryExtract(); return;
    case 'manualType':
      state.manualType = el.dataset.value;
      el.parentElement.querySelectorAll('.seg-b').forEach((b) => { b.classList.toggle('on', b === el); b.setAttribute('aria-pressed', b === el); });
      return;
    case 'sample': {
      const s = SAMPLES.find((x) => x.id === el.dataset.id);
      Object.assign(state, { sample: s.id, rawText: s.text, extractedBy: null, fields: withDefaults(clone(s.extraction)), profile: clone(s.profile), offers: [], editing: null, step: 'confirm' });
      beginReview();
      break;
    }
    case 'samplePair': {
      const pick = (id) => { const x = SAMPLES.find((y) => y.id === id); return { name: SAMPLE_TEXT[id][0], fields: withDefaults(clone(x.extraction)), rawText: x.text, extractedBy: null }; };
      Object.assign(state, { offers: [pick('cafe'), pick('tutor')], profile: clone(SAMPLES[0].profile), editing: null, fields: null, sample: null, step: 'offers' });
      break;
    }
    case 'reviewOk': state.reviewed.push(el.dataset.key); break;
    case 'answer': {
      const key = el.dataset.key; const value = el.dataset.value;
      if (key === 'incomeType') state.fields.incomeType = value === 'unknown' ? { value: 'unknown', status: STATUS.CHECK, evidence: '모른다고 답함' } : { value, status: STATUS.CONFIRMED, evidence: '직접 답함' };
      else if (key === 'months' && value === '0') state.fields.months = { value: 12, status: STATUS.ESTIMATED, evidence: '모른다고 답해 연말까지로 가정' };
      else state.fields[key] = { value: Number(value), status: STATUS.CONFIRMED, evidence: '직접 답함' };
      if (key === 'months' && value === '0') state.reviewed.push('months');
      break;
    }
    case 'editField': state.sheet = { type: 'edit', key: el.dataset.key }; renderSheet(); return;
    case 'sheetPick': {
      const key = state.sheet.key; const raw = el.dataset.value;
      const value = key === 'incomeType' ? raw : key === 'holidayIncluded' ? raw === 'true' : Number(raw);
      state.fields[key] = { value, status: key === 'incomeType' && value === 'unknown' ? STATUS.CHECK : STATUS.CONFIRMED, evidence: key === 'incomeType' && value === 'unknown' ? '모른다고 답함' : '직접 수정' };
      if (!state.reviewed.includes(key)) state.reviewed.push(key);
      state.sheet = null;
      keep();
      return;
    }
    case 'saveEdit': {
      const key = el.dataset.key; const input = document.getElementById('e-val');
      const v = input && input.value !== '' ? Number(input.value) : null;
      if (!v || v <= 0) { input?.focus(); return; }
      state.fields[key] = { value: key === 'weeklyHours' ? Math.min(52, v) : Math.round(v), status: STATUS.CONFIRMED, evidence: '직접 수정' };
      if (!state.reviewed.includes(key)) state.reviewed.push(key);
      state.sheet = null;
      keep();
      return;
    }
    case 'closeSheet': state.sheet = null; renderSheet(); return;
    case 'saveDraft': {
      const wasEditing = state.editing !== null;
      saveDraft();
      state.step = wasEditing || state.offers.length > 1 ? 'offers' : 'profile';
      state.profileQ = 0;
      break;
    }
    case 'saveAndAdd': saveDraft(); Object.assign(state, { fields: emptyFields(), step: 'upload' }); break;
    case 'addOffer': Object.assign(state, { editing: null, fields: emptyFields(), rawText: '', sample: null, extractedBy: null, aiError: null, step: 'upload' }); break;
    case 'newOffer': {
      const profile = clone(state.profile);
      resetAll();
      Object.assign(state, { profile, fields: emptyFields(), step: 'upload' });
      break;
    }
    case 'editOffer': {
      const o = state.offers[Number(el.dataset.i)];
      Object.assign(state, { editing: Number(el.dataset.i), fields: clone(o.fields), rawText: o.rawText, extractedBy: o.extractedBy, step: 'confirm' });
      state.reviewed = relevantKeys(state.fields); state.reviewTotal = 0;
      break;
    }
    case 'removeOffer': state.offers.splice(Number(el.dataset.i), 1); keep(); return;
    case 'detail': openOffer(Number(el.dataset.i)); state.step = 'result'; break;
    case 'nextQ': {
      saveProfileInputs();
      if (profileQuestions()[state.profileQ].q === 'maxHours' && !state.profile.maxHours) {
        state.profileError = '일할 수 있는 최대 시간을 넣어 주세요. 비교는 이 시간 안에서만 해요';
        keep(); document.getElementById('p-max')?.focus(); return;
      }
      state.profileError = null;
      state.profileQ = Math.min(state.profileQ + 1, profileQuestions().length - 1);
      break;
    }
    case 'step': case 'setNum': {
      const input = document.getElementById(el.dataset.target);
      if (!input) return;
      const min = Number(input.min || 0); const max = Number(input.max || 999);
      const next = a === 'setNum' ? Number(el.dataset.value) : (Number(input.value) || (Number(el.dataset.delta) > 0 ? min - 1 : min)) + Number(el.dataset.delta);
      input.value = Math.min(max, Math.max(min, next));
      if (state.step === 'profile') { saveProfileInputs(); state.profileError = null; persist(); }
      return;
    }
    case 'choose': {
      saveProfileInputs();
      const name = el.dataset.name; const value = el.dataset.value;
      if (el.dataset.multi) {
        const list = new Set(state.profile[name] || []);
        list.has(value) ? list.delete(value) : list.add(value);
        state.profile[name] = [...list];
      } else state.profile[name] = /EndMonth$/.test(name) && value !== 'unknown' ? Number(value) : value;
      keep();
      return;
    }
    case 'noSupports': state.profile.otherSupports = []; keep(); return;
    case 'ytd':
      state.ytdOpen = el.dataset.value === 'yes';
      if (!state.ytdOpen) state.profile.ytdIncome = { wage: 0, business: 0, daily: 0 };
      keep();
      return;
    case 'calculate': {
      saveProfileInputs();
      if (!state.profile.maxHours) { state.profileQ = 0; state.profileError = '일할 수 있는 최대 시간을 넣어 주세요. 비교는 이 시간 안에서만 해요'; break; }
      recalculate();
      openOffer(0);
      state.step = state.offers.length > 1 ? 'compare' : 'result';
      break;
    }
    case 'cardSheet': state.sheet = { type: 'card', id: el.dataset.id }; renderSheet(); return;
    case 'amountSheet': state.sheet = { type: 'amounts' }; renderSheet(); return;
    case 'altsAt': state.chosenHours = Number(el.dataset.hours); state.requestAction = null; state.step = 'alts'; break;
    case 'chooseHours': state.chosenHours = Number(el.dataset.hours); state.requestAction = null; keep(); return;
    case 'reqAction': state.requestAction = el.dataset.value; keep(); return;
    case 'copy': {
      const text = document.getElementById('msg').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
        () => { el.textContent = '복사했어요'; },
        () => { el.textContent = '문구를 길게 눌러 복사해 주세요'; },
      );
      return;
    }
    case 'restart': resetAll(); break;
    default: return;
  }
  render();
});

fetch('data/rules.json').then((r) => r.json()).then((rules) => {
  state.rules = rules;
  window.__munteok = state; // 점검용
  restore();
  render();
}).catch(() => {
  app.innerHTML = '<p class="gline warn" role="alert">계산 규칙을 불러오지 못했어요. 새로고침해 주세요</p>';
});
