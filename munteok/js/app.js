// 문턱 화면 흐름
// 시작 → 올리기 → 추출 확인 → 추가 질문 → 내 상황 → 결과 → 대안 비교 → 근거와 다음 행동
// 계산은 전부 engine.js가 한다. 이 파일은 입력을 모으고 결과를 그리기만 한다.
import { evaluate, searchAlternatives, compareOffers, STATUS } from './engine.js';
import { SAMPLES, EMPTY_PROFILE, INCOME_TYPES } from './samples.js';
import { API_BASE, AI_AVAILABLE } from './config.js';

const app = document.getElementById('app');
const stepsEl = document.getElementById('steps');
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

const state = {
  step: 'start', rules: null, sample: null, mode: 'text', rawText: '', fileName: '',
  fields: null, profile: clone(EMPTY_PROFILE), result: null, alts: null, aiError: null, chosen: null,
  offers: [], editing: null, active: 0, comparison: null,
};
const MAX_OFFERS = 3;

const FIELD_LABELS = { hourlyWage: '시급 (원)', weeklyHours: '주당 근무시간', startMonth: '시작 월', months: '근무 개월 수', incomeType: '소득 종류', holidayIncluded: '주휴수당' };
const STEP_GROUP = { upload: 0, confirm: 1, questions: 1, offers: 1, profile: 2, compare: 3, result: 3, alts: 3, basis: 3 };
const STEP_NAMES = ['올리기', '확인', '내 상황', '결과'];

function emptyFields() {
  const blank = (v) => ({ value: v, status: STATUS.CHECK, evidence: '' });
  return withDefaults({ hourlyWage: blank(null), weeklyHours: blank(null), startMonth: blank(null), months: blank(null), incomeType: blank('unknown') });
}

// 주휴수당 포함 여부는 공고에 잘 적히지 않는다. 값이 없으면 "시급과 별도"로 가정하고 추정으로 표시한다.
function withDefaults(fields) {
  if (!fields.holidayIncluded) fields.holidayIncluded = { value: false, status: STATUS.ESTIMATED, evidence: '적혀 있지 않아 시급과 별도로 지급된다고 가정' };
  return fields;
}

function badge(status) {
  const cls = status === STATUS.CONFIRMED ? 's-confirmed' : status === STATUS.ESTIMATED ? 's-estimated' : 's-check';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

// 기준을 넘는지 여부. 좋고 나쁨을 뜻하지 않으므로 중립 색으로만 표시한다.
function crossTag(crossed) {
  if (crossed === true) return '<span class="tag neutral">기준 초과</span>';
  if (crossed === 'maybe') return '<span class="tag neutral">초과 가능</span>';
  if (crossed === false) return '<span class="tag neutral">기준 이내</span>';
  return '<span class="tag hold">판단 보류</span>';
}

// 변화의 종류. 급여 증가, 수당 감소, 자격 확인, 변화 없음을 색으로 구분한다.
function effectTag(effect) {
  return `<span class="tag e-${effect.type}">${esc(effect.label)}</span>`;
}

function choices(name, options, current, multi = false) {
  return `<div class="choices">${options.map(([v, label]) => {
    const on = multi ? (current || []).includes(v) : String(current) === String(v);
    return `<button type="button" class="choice ${on ? 'on' : ''}" data-action="choose" data-name="${name}" data-value="${esc(v)}" ${multi ? 'data-multi="1"' : ''} aria-pressed="${on}">${esc(label)}</button>`;
  }).join('')}</div>`;
}

// ---------------- 화면 ----------------

function viewStart() {
  return `
    <h1>일을 더 해도 되는지,<br>넘게 되는 기준선과 손익을 계산해 드립니다</h1>
    <p class="lead">알바 공고나 제안 메시지를 올리면 급여와 지원의 변화를 계산합니다. 제안이 여러 개면 같은 기준으로 나란히 비교합니다.</p>
    <div class="card">
      <h3>계산하는 제도</h3>
      <ul class="notes">
        <li>부모 연말정산 부양가족 공제</li><li>건강보험 피부양자</li><li>구직촉진수당</li><li>주 15시간 기준 (주휴수당·4대보험)</li>
      </ul>
      <p class="small" style="margin-top:8px">그 밖의 제도는 계산하지 않고 문의처만 안내합니다.</p>
    </div>
    <button class="btn" data-action="go" data-step="upload">새 계산 시작</button>
    <h2>가상 샘플로 바로 체험하기</h2>
    ${SAMPLES.map((s) => `<button class="sample" data-action="sample" data-id="${s.id}"><b>${esc(s.title)}</b><span>${esc(s.scenario)}</span></button>`).join('')}
    <button class="sample" data-action="samplePair"><b>두 제안 비교하기</b><span>카페 공고와 학원 보조 제안을 나란히 비교</span></button>
    <p class="small">샘플은 지어낸 공고와 인물입니다.</p>`;
}

function viewUpload() {
  const tab = (id, label) => `<button class="tab ${state.mode === id ? 'on' : ''}" data-action="mode" data-mode="${id}">${label}</button>`;
  let body = '';
  if (state.mode === 'photo') {
    body = `<label class="f" for="photo">공고 사진 또는 스크린샷</label>
      <input id="photo" type="file" accept="image/*">
      <p class="hint">실제 개인정보가 담긴 사진은 올리지 마세요.</p>
      <button class="btn" data-action="extract" style="margin-top:14px">AI로 조건 추출</button>`;
  } else if (state.mode === 'text') {
    body = `<label class="f" for="raw">공고나 제안 메시지를 붙여 넣으세요</label>
      <textarea id="raw" placeholder="예: 주 3회 저녁 6시~10시, 시급 13,000원, 3.3% 떼고 지급">${esc(state.rawText)}</textarea>
      <p class="hint">이름, 연락처 같은 개인정보는 지우고 붙여 넣으세요.</p>
      <button class="btn" data-action="extract" style="margin-top:14px">AI로 조건 추출</button>`;
  } else {
    body = `<form id="manual">
      <label class="f" for="m-wage">시급 (원)</label><input id="m-wage" type="number" inputmode="numeric" min="0" required>
      <label class="f" for="m-hours">주당 근무시간</label><input id="m-hours" type="number" inputmode="decimal" min="1" max="52" step="0.5" required>
      <label class="f" for="m-start">시작 월</label>
      <select id="m-start">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}월</option>`).join('')}</select>
      <label class="f" for="m-months">근무 개월 수</label><input id="m-months" type="number" inputmode="numeric" min="1" max="12" value="12" required>
      <label class="f">급여 지급 방식</label>
      ${choices('manualType', [['wage', '4대보험 공제'], ['business', '3.3% 공제'], ['daily', '일당으로 그때그때'], ['unknown', '모름']], state.manualType || 'unknown')}
      <button class="btn" type="submit" style="margin-top:16px">조건 확인으로</button>
    </form>`;
  }
  const error = state.aiError ? `<div class="card warn" role="alert">
      <h3>AI 추출을 지금 사용할 수 없습니다</h3>
      <p class="small">${esc(state.aiError)}</p>
      <div class="btn-row"><button class="btn ghost" data-action="extract">다시 시도</button><button class="btn ghost" data-action="mode" data-mode="manual">직접 입력으로</button></div>
      <button class="btn link" data-action="go" data-step="start">가상 샘플 결과 보기</button>
    </div>` : '';
  return `<h1>일자리 조건 올리기</h1>
    <p class="lead">편한 방식 하나를 고르세요.</p>
    <div class="tabs" role="tablist">${tab('photo', '사진')}${tab('text', '붙여넣기')}${tab('manual', '직접 입력')}</div>
    ${error}<div class="card">${body}</div>`;
}

function fieldInput(key, f) {
  if (key === 'incomeType') {
    return `<select data-field="incomeType">${Object.entries(INCOME_TYPES).map(([v, l]) => `<option value="${v}" ${f.value === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }
  if (key === 'holidayIncluded') {
    return `<select data-field="holidayIncluded"><option value="false" ${f.value ? '' : 'selected'}>시급과 별도로 받음</option><option value="true" ${f.value ? 'selected' : ''}>시급에 이미 포함됨</option></select>`;
  }
  if (key === 'startMonth') {
    return `<select data-field="startMonth"><option value="">선택</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${f.value === i + 1 ? 'selected' : ''}>${i + 1}월</option>`).join('')}</select>`;
  }
  const attrs = key === 'weeklyHours' ? 'min="1" max="52" step="0.5"' : key === 'months' ? 'min="1" max="12"' : 'min="0"';
  return `<input type="number" inputmode="decimal" data-field="${key}" value="${f.value ?? ''}" ${attrs}>`;
}

function missingFields() {
  const f = state.fields;
  const list = [];
  if (f.incomeType.value === 'unknown' && f.incomeType.evidence !== '모른다고 답함') list.push('incomeType');
  if (!f.startMonth.value) list.push('startMonth');
  if (!f.months.value) list.push('months');
  return list;
}

function viewConfirm() {
  const f = state.fields;
  const ready = f.hourlyWage.value > 0 && f.weeklyHours.value > 0;
  const rows = Object.keys(FIELD_LABELS).filter((key) => key !== 'holidayIncluded' || f.incomeType.value === 'wage').map((key) => `
    <div class="field">
      <div class="field-head"><label for="fld-${key}"><b>${FIELD_LABELS[key]}</b></label>${badge(f[key].status)}</div>
      ${fieldInput(key, f[key]).replace('data-field', `id="fld-${key}" data-field`)}
      ${f[key].evidence ? `<p class="evidence">근거: ${esc(f[key].evidence)}</p>` : ''}
    </div>`).join('');
  const need = missingFields().length;
  return `<h1>추출 결과 확인</h1>
    <p class="lead">원문에서 읽은 값입니다. 틀린 값은 바로 고치세요.</p>
    ${state.extractedBy ? `<p class="small">AI(${esc(state.extractedBy)})가 추출한 내용입니다. AI는 틀릴 수 있으니 원문과 대조해 확인하세요.</p>` : ''}
    ${state.rawText ? `<div class="card"><h3>원문</h3><pre class="raw">${esc(state.rawText)}</pre></div>` : ''}
    <div class="card">${rows}</div>
    <div class="card soft"><p class="small" style="margin:0"><b>확정</b> 원문에 적힌 값 · <b>추정</b> 문맥으로 계산한 값 · <b>확인 필요</b> 원문에서 알 수 없는 값</p></div>
    ${ready ? '' : '<p class="hint" role="alert">시급과 주당 근무시간을 입력해야 다음으로 갈 수 있습니다.</p>'}
    <button class="btn" data-action="afterConfirm" ${ready ? '' : 'disabled'}>${need ? `추가 질문 ${need}개에 답하기` : '이 제안 저장'}</button>`;
}

const QUESTIONS = {
  incomeType: {
    ask: '급여에서 무엇을 떼고 받나요?',
    why: '소득 종류에 따라 적용되는 기준이 달라집니다.',
    options: [['wage', '4대보험을 뗀다'], ['business', '3.3%를 뗀다'], ['daily', '일당으로 그때그때 받는다'], ['unknown', '모름']],
  },
  startMonth: {
    ask: '몇 월부터 일하나요?',
    why: '연간 기준은 1월부터 12월까지의 소득을 합쳐서 판단합니다.',
    options: Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}월`]),
  },
  months: {
    ask: '몇 개월 일할 예정인가요?',
    why: '일하는 기간에 따라 연간 기준을 넘는 시점이 달라집니다.',
    options: [['1', '1개월'], ['2', '2개월'], ['3', '3개월'], ['6', '6개월'], ['12', '연말까지'], ['0', '모름']],
  },
};

function viewQuestions() {
  const queue = missingFields();
  const key = queue[0];
  const q = QUESTIONS[key];
  return `<h1>추가 질문</h1>
    <p class="lead">원문에서 알 수 없는 항목만 묻습니다. 남은 질문 ${queue.length}개.</p>
    <div class="card">
      <h3>${esc(q.ask)}</h3>
      <p class="small">${esc(q.why)}</p>
      ${choices('answer:' + key, q.options, null)}
      <p class="hint">“모름”을 고르면 그 값이 필요한 제도는 확인 필요로 표시됩니다.</p>
    </div>
    <button class="btn link" data-action="go" data-step="confirm">추출 결과로 돌아가기</button>`;
}

function offerLine(f) {
  return `시급 ${won(f.hourlyWage.value)}, 주 ${f.weeklyHours.value}시간, ${f.startMonth.value}월부터 ${f.months.value}개월, ${INCOME_TYPES[f.incomeType.value]}`;
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
    const sample = SAMPLES.find((x) => x.id === state.sample);
    state.offers.push({ name: sample ? sample.title : `제안 ${state.offers.length + 1}`, ...draft });
  }
  Object.assign(state, { editing: null, fields: null, rawText: '', sample: null, extractedBy: null, step: 'offers' });
}

function viewOffers() {
  const cards = state.offers.map((o, i) => `<div class="card">
      <label class="f" for="name-${i}" style="margin-top:0">제안 이름</label>
      <input id="name-${i}" type="text" maxlength="20" data-offer-name="${i}" value="${esc(o.name)}">
      <p class="small" style="margin:8px 0 0">${esc(offerLine(o.fields))}</p>
      <div class="btn-row"><button class="btn ghost" data-action="editOffer" data-i="${i}">수정</button><button class="btn ghost" data-action="removeOffer" data-i="${i}">삭제</button></div>
    </div>`).join('');
  const canAdd = state.offers.length < MAX_OFFERS;
  return `<h1>저장한 제안</h1>
    <p class="lead">제안을 ${MAX_OFFERS}개까지 넣어 같은 기준으로 비교할 수 있습니다. 하나만 넣어도 됩니다.</p>
    ${cards || '<div class="card soft"><p style="margin:0">저장한 제안이 없습니다.</p></div>'}
    ${canAdd ? '<button class="btn ghost" data-action="addOffer">비교할 제안 추가</button>' : ''}
    <button class="btn" data-action="go" data-step="profile" style="margin-top:10px" ${state.offers.length ? '' : 'disabled'}>내 상황 입력으로</button>`;
}

function viewCompare() {
  const c = state.comparison;
  const hasAllowance = state.profile.allowance !== 'no';
  const h = c.highlights;
  const mark = (i, key, text) => (c.rows.length > 1 && h[key] === i ? ` <span class="tag e-gain">${text}</span>` : '');
  const cards = c.rows.map((r, i) => `<div class="card" data-offer="${i}">
      <div class="card-head"><h3>${esc(r.name)}</h3></div>
      <p>${r.effects.filter((e) => e.type !== 'keep').map(effectTag).join(' ') || '<span class="tag e-keep">지원·자격 변화 없음</span>'}${r.withinHours ? '' : ' <span class="tag e-check">가능한 시간 초과</span>'}</p>
      <dl class="kv">
        <dt>조건</dt><dd>시급 ${won(r.job.hourlyWage)}, 주 ${r.job.weeklyHours}시간, ${r.workedMonths}개월</dd>
        <dt>급여 (월)</dt><dd>${won(r.gross)}</dd>
        ${hasAllowance ? `<dt>줄어드는 수당 (월)</dt><dd>${won(r.allowanceLoss)}</dd>` : ''}
        <dt>예상 추가수입 (월, 추정 포함)</dt><dd><b>${won(r.net)}</b>${mark(i, 'net', '가장 큼')}</dd>
        ${r.checkCount ? `<dt>추가 확인 항목</dt><dd>${r.checkCount}개</dd>` : ''}
        <dt>일한 시간당</dt><dd>${won(r.netPerHour)}${mark(i, 'netPerHour', '가장 큼')}</dd>
        <dt>올해 일하는 ${r.workedMonths}개월 합계</dt><dd>${won(r.periodNet)}</dd>
        ${r.uncountedMonths ? `<dt>계산에서 빠진 기간</dt><dd>해를 넘기는 ${r.uncountedMonths}개월</dd>` : ''}
        <dt>확인 안 된 조건</dt><dd>${r.unsure}개${mark(i, 'fewestUnsure', '가장 적음')}</dd>
      </dl>
      ${r.questions.length ? `<p class="small" style="margin:10px 0 4px"><b>시작 전에 고용주에게 물어볼 것</b></p><ul class="notes">${r.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
      <button class="btn ghost" data-action="detail" data-i="${i}" style="margin-top:10px">이 제안 자세히 보기</button>
    </div>`).join('');
  return `<h1>제안 비교</h1>
    <p class="lead">제안 ${c.rows.length}개를 같은 규칙으로 계산했습니다. 기준마다 앞서는 제안을 표시할 뿐, 어느 쪽을 고를지는 직접 정하세요.</p>
    <p class="small">${state.rules.appliesToYear}년 규칙으로 한 해(1월~12월)를 계산한 값입니다. 해를 넘기는 기간은 넣지 않았습니다.</p>
    <p class="small"><b>예상 추가수입</b>은 급여에서 4대보험이나 3.3%${hasAllowance ? ', 줄어드는 수당' : ''}을 뺀 금액입니다. 소득세와 부모님 세금 변화는 넣지 않았습니다.</p>
    ${cards}
    <div class="btn-row"><button class="btn ghost" data-action="go" data-step="offers">제안 수정·추가</button><button class="btn ghost" data-action="go" data-step="profile">내 상황 바꾸기</button></div>`;
}

function viewProfile() {
  const p = state.profile;
  const yn = [['yes', '예'], ['no', '아니오'], ['unknown', '모름']];
  const others = Object.entries(state.rules.outOfScope).map(([k, v]) => [k, v.title]);
  return `<h1>내 상황</h1>
    <p class="lead">계산에 필요한 것만 묻습니다. 입력값은 이 브라우저 안에서만 쓰입니다.</p>
    <div class="card">
      <label class="f" for="p-age" style="margin-top:0">만 나이</label>
      <input id="p-age" type="number" inputmode="numeric" min="15" max="45" value="${p.age ?? ''}">
      <label class="f">구직촉진수당을 받고 있나요?</label>
      ${choices('allowance', [['yes', '예'], ['no', '아니오'], ['applying', '신청 중']], p.allowance)}
      <label class="f">부모님의 건강보험 피부양자인가요?</label>
      ${choices('healthDependent', yn, p.healthDependent)}
      <label class="f">부모님 연말정산에 부양가족으로 올라 있나요?</label>
      ${choices('taxDependent', yn, p.taxDependent)}
      <p class="hint">“모름”이면 해당한다고 가정해 계산하고 확인 필요로 표시합니다.</p>
    </div>
    <div class="card">
      <h3>올해 이미 번 소득</h3>
      <p class="small">없으면 0으로 두세요. 세금을 떼기 전 금액입니다.</p>
      <label class="f" for="y-wage">근로소득 (원)</label><input id="y-wage" type="number" inputmode="numeric" min="0" value="${p.ytdIncome.wage}">
      <label class="f" for="y-business">사업소득, 3.3% 떼는 일 (원)</label><input id="y-business" type="number" inputmode="numeric" min="0" value="${p.ytdIncome.business}">
      <label class="f" for="y-daily">일용근로소득 (원)</label><input id="y-daily" type="number" inputmode="numeric" min="0" value="${p.ytdIncome.daily}">
    </div>
    <div class="card">
      <label class="f" for="p-max" style="margin-top:0">주당 최대 몇 시간까지 일할 수 있나요?</label>
      <input id="p-max" type="number" inputmode="numeric" min="1" max="52" value="${p.maxHours ?? 40}">
      <p class="hint">근무조건 비교는 이 시간 안에서만 합니다.</p>
      <label class="f">그 밖에 받고 있는 지원 (여러 개 선택 가능)</label>
      ${choices('otherSupports', others, p.otherSupports, true)}
      <p class="hint">이 제도들은 이번 버전에서 계산하지 않고 문의처만 안내합니다.</p>
    </div>
    <div class="card soft">
      <h3>계산할 제안 ${state.offers.length}개</h3>
      <ul class="notes">${state.offers.map((o) => `<li>${esc(o.name)}: ${esc(offerLine(o.fields))}</li>`).join('')}</ul>
      <button class="btn link" data-action="go" data-step="offers">제안 수정·추가</button>
    </div>
    <button class="btn" data-action="calculate">${state.offers.length > 1 ? '비교하기' : '계산하기'}</button>`;
}

function cardHtml(c) {
  const impact = c.impact && c.impact.max > 0
    ? `<dt>${esc(c.impact.text)}</dt><dd>${c.impact.min === c.impact.max ? won(c.impact.max) : `${won(c.impact.min)} ~ ${won(c.impact.max)}`} ${badge(c.impact.status)}</dd>` : '';
  const proposed = c.proposed ? `<div class="two">
      <div><b>현행 기준</b>${esc(c.limitText)}<br>${crossTag(c.crossed)} ${c.crossMonth ? c.crossMonth + '월' : ''}</div>
      <div><b>개정안 기준 (국회 미확정)</b>${esc(c.proposed.limitText)}<br>${crossTag(c.proposed.crossed)} ${c.proposed.crossMonth ? c.proposed.crossMonth + '월' : ''}</div>
    </div>` : '';
  return `<div class="card" data-card="${c.id}">
    <div class="card-head"><h3>${esc(c.title)}</h3>${badge(c.status)}</div>
    <p>${effectTag(c.effect)} ${esc(c.headline)}</p>
    <dl class="kv">
      <dt>기준선</dt><dd>${esc(c.limitText)}</dd>
      ${c.crossMonth ? `<dt>기준에 닿는 시점</dt><dd>${c.crossMonth}월</dd>` : ''}
      ${impact}
    </dl>
    ${proposed}
    ${c.notes.length ? `<ul class="notes">${c.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function timelineHtml(r) {
  const rows = r.timeline.rows;
  const max = Math.max(1, rows[11].cumulative.total);
  const months = r.cards.map((c) => c.crossMonth).filter(Boolean);
  const firstHit = months.length ? Math.min(...months) : null;
  const bars = rows.map((row) => {
    const cls = firstHit && row.month >= firstHit ? 'reach' : row.working ? 'work' : '';
    return `<div class="bar ${cls}" style="height:${Math.max(2, Math.round((row.cumulative.total / max) * 100))}%" title="${row.month}월 누적 ${won(row.cumulative.total)}"></div>`;
  }).join('');
  return `<div class="card">
    <h3>월별 누적 소득</h3>
    <p class="small">${firstHit ? `${firstHit}월에 연간 기준에 닿습니다(진한 색 구간).` : '연간 기준에 닿는 달이 없습니다.'} 12월 누적 ${won(rows[11].cumulative.total)}</p>
    <div class="tl" role="img" aria-label="1월부터 12월까지 누적 소득 막대 그래프">${bars}</div>
    <div class="tl-x">${rows.map((row) => `<span>${row.month}</span>`).join('')}</div>
  </div>`;
}

function viewResult() {
  const r = state.result;
  const s = r.summary;
  const types = new Set(r.cards.map((c) => c.effect.type));
  const chips = [
    types.has('gain') ? '<span class="tag e-gain">급여 증가</span>' : '',
    types.has('loss') ? '<span class="tag e-loss">수당 감소</span>' : '',
    types.has('check') ? '<span class="tag e-check">자격 변동 확인</span>' : '',
    types.has('pending') ? '<span class="tag e-pending">추가 확인 필요</span>' : '',
    s.reportNeeded ? '<span class="tag e-report">신고 필요</span>' : '',
  ].filter(Boolean).join(' ');
  const multi = state.offers.length > 1;
  return `${multi ? `<p class="small"><button class="btn link" data-action="go" data-step="compare">← 제안 비교로</button></p>` : ''}<h1>${multi ? esc(state.offers[state.active].name) + ': ' : ''}이 일을 시작하면 달라지는 것</h1>
    <div class="card soft"><ul class="notes" style="margin:0">${r.notices.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
    <div class="card">
      <div class="k small">확인된 규칙으로 계산한 금액 (월)</div>
      <div class="v-big mono">${won(s.confirmedNet)}</div>
      <dl class="kv">
        ${s.parts.map((x) => `<dt>${esc(x.label)}</dt><dd>${x.amount < 0 ? '−' : ''}${won(Math.abs(x.amount))} ${badge(x.status)}</dd>`).join('')}
      </dl>
      ${s.estimatedParts.length ? `<p style="margin:12px 0 0">추정 항목까지 반영하면 <b class="mono">${won(s.net)}</b></p>
      <ul class="notes">${s.estimatedParts.map((x) => `<li>${esc(x.label)}: ${esc(x.reason)}</li>`).join('')}</ul>` : ''}
      <p class="small" style="margin:10px 0 0"><b>넣지 않은 것</b> ${esc(s.excluded.join(', '))}</p>
    </div>
    ${r.checks.length ? `<div class="card pending">
      <h3>추가 확인 항목 ${r.checks.length}개</h3>
      <p class="small">원문을 확인하지 못한 규칙이라 금액과 판정에 넣지 않았습니다. 시작 전에 확인하세요.</p>
      <ul class="notes">${r.checks.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>
    </div>` : ''}
    ${r.warnings.map((w) => `<div class="card warn" role="alert"><p class="small" style="margin:0">${esc(w)}</p></div>`).join('')}
    <h2>제도별 변화</h2>
    ${chips ? `<p>${chips}</p>` : '<div class="card soft"><p style="margin:0"><b>현재 조건에서는 지원이나 자격에 달라지는 것이 없습니다.</b></p></div>'}
    ${r.cards.map(cardHtml).join('')}
    ${timelineHtml(r)}
    ${r.notApplicable.length ? `<div class="card"><h3>해당하지 않아 계산하지 않은 제도</h3><ul class="notes">${r.notApplicable.map((n) => `<li>${esc(n.title)}: ${esc(n.reason)}</li>`).join('')}</ul></div>` : ''}
    ${r.outOfScope.length ? `<div class="card warn"><h3>이번 버전에서 계산하지 않는 제도</h3><ul class="notes">${r.outOfScope.map((o) => `<li><b>${esc(o.title)}</b>: 확인 필요. 문의처 ${esc(o.contact)}</li>`).join('')}</ul></div>` : ''}
    <button class="btn" data-action="go" data-step="alts">근무조건 비교하기</button>
    <div class="btn-row"><button class="btn ghost" data-action="go" data-step="basis">근거와 시작 전 준비</button><button class="btn ghost" data-action="go" data-step="profile">조건 바꿔 다시</button></div>`;
}

// 선택한 조건이 받은 제안보다 긴지 짧은지에 따라 요청 문구를 다르게 쓴다.
function requestMessage(offered, option) {
  const h = option.weeklyHours;
  if (h > offered) {
    return `안녕하세요. 근무시간과 관련해 여쭙고 싶습니다.\n제안해 주신 주 ${offered}시간보다 더 일할 수 있는데, 주 ${h}시간 정도로 늘릴 수 있을까요?\n가능한 요일과 시간대를 알려 주시면 맞추겠습니다. 감사합니다.`;
  }
  if (h < offered) {
    return `안녕하세요. 근무시간과 관련해 여쭙고 싶습니다.\n제 사정상 주 ${offered}시간은 어려워서, 주 ${h}시간으로 조정할 수 있을까요?\n요일과 시간대는 최대한 맞추겠습니다. 감사합니다.`;
  }
  return `안녕하세요. 제안해 주신 주 ${offered}시간 조건으로 일하고 싶습니다.\n시작 전에 급여 지급 방식(4대보험 또는 3.3%)과 주휴수당 지급 여부를 확인하고 싶습니다. 감사합니다.`;
}

function viewAlts() {
  const a = state.alts;
  const hasAllowance = state.profile.allowance !== 'no';
  const offered = Math.round(state.offers[state.active].fields.weeklyHours.value);
  const dip = a.dip ? `<div class="card soft">
      <h3>알아 둘 구간: 더 일해도 예상 추가수입이 줄어듦</h3>
      <p style="margin:0">주 ${a.dip.from}~${a.dip.to}시간은 예상 추가수입이 주 ${a.dip.peakHours}시간 때(월 ${won(a.dip.peakNet)})보다 적습니다. 수당이 줄어드는 폭이 급여가 늘어나는 폭보다 크기 때문입니다. 수당 계산식이 추정이라 이 구간도 추정입니다.${a.dip.recoverHours ? ` 주 ${a.dip.recoverHours}시간부터 다시 커집니다.` : ''}</p>
    </div>` : '';
  const cards = a.options.map((o) => `<div class="card">
      <div class="card-head"><h3>${esc(o.label)}</h3></div>
      <p>${o.effects.filter((e) => e.type !== 'keep').map(effectTag).join(' ') || '<span class="tag e-keep">지원·자격 변화 없음</span>'}</p>
      <dl class="kv">
        <dt>근무시간</dt><dd>주 ${o.weeklyHours}시간</dd>
        <dt>급여 (월)</dt><dd>${won(o.gross)}</dd>
        ${hasAllowance ? `<dt>줄어드는 수당 (월)</dt><dd>${won(o.allowanceLoss)}</dd>` : ''}
        <dt>예상 추가수입 (월, 추정 포함)</dt><dd><b>${won(o.net)}</b></dd>
        ${o.checkCount ? `<dt>추가 확인 항목</dt><dd>${o.checkCount}개</dd>` : ''}
      </dl>
      <button class="btn ghost" data-action="pick" data-kind="${o.kind}" style="margin-top:10px">이 조건으로 문구 만들기</button>
    </div>`).join('');
  const chosen = state.chosen && a.options.find((o) => o.kind === state.chosen);
  const msg = chosen ? `<div class="card soft" id="msg-card">
      <h3>고용주에게 보낼 문구</h3>
      <pre class="msg" id="msg">${esc(requestMessage(offered, chosen))}</pre>
      <button class="btn" data-action="copy">문구 복사</button>
      <p class="hint">문구 예시입니다. 상황에 맞게 고쳐 쓰세요.</p>
    </div>` : '';
  return `<h1>근무조건 비교</h1>
    <p class="lead">내가 가능한 주 ${a.trace.to}시간 안에서 ${esc(a.trace.variable)}을 바꿔 가며 ${a.trace.evaluated}번 계산했습니다. 시급과 기간은 그대로 두었습니다. 어떤 조건을 고를지는 직접 정하세요.</p>
    ${a.offeredOutOfRange ? `<div class="card warn"><p class="small" style="margin:0">받은 제안(주 ${offered}시간)은 내가 가능한 시간을 넘어 비교에서 빠졌습니다.</p></div>` : ''}
    ${dip}${cards}${msg}
    <div class="btn-row"><button class="btn ghost" data-action="go" data-step="result">결과로</button><button class="btn ghost" data-action="go" data-step="basis">근거와 시작 전 준비</button></div>`;
}

function viewBasis() {
  const r = state.result;
  const rules = state.rules;
  const ruleOf = (id) => rules[id];
  const cards = r.cards.map((c) => {
    const rule = ruleOf(c.id);
    const checked = rule.checkedAt || (rule.current && rule.current.checkedAt) || '';
    return `<div class="card">
      <div class="card-head"><h3>${esc(c.title)}</h3>${badge(c.status)}</div>
      <dl class="kv"><dt>적용 연도</dt><dd>${rules.appliesToYear}년</dd><dt>확인일</dt><dd>${esc(checked)}</dd><dt>판단 단위</dt><dd>${esc(c.period)}</dd></dl>
      <ul class="notes">${c.sources.map((id) => rules.sources[id]).filter(Boolean).map((s) => `<li>${esc(s.basis)}: <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>
    </div>`;
  }).join('');
  const contacts = Object.values(rules.contacts).map((c) => `<li>${esc(c.name)} <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></li>`).join('');
  return `<h1>근거와 시작 전 준비</h1>
    <p class="lead">규칙표 ${esc(rules.version)} 기준입니다. 확정은 정부·법령 원문을 확인한 규칙, 추정은 2차 자료나 계산값, 확인 필요는 원문을 확인하지 못한 규칙입니다.</p>
    ${cards}
    ${r.checks.length ? `<div class="card pending"><h3>시작 전에 확인할 것</h3><ul class="notes">${r.checks.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul></div>` : ''}
    ${r.summary.reports.length ? `<div class="card"><h3>신고할 것</h3><ul class="notes">${r.summary.reports.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="card warn">
      <h3>신고 의무</h3>
      <p class="small" style="margin:0">수당을 받는 중에 소득이 생기면 담당 기관에 신고해야 합니다. 이 서비스는 소득을 숨기거나 신고를 피하는 방법을 안내하지 않습니다.</p>
    </div>
    <div class="card"><h3>공식 문의처</h3><ul class="notes">${contacts}</ul></div>
    <div class="btn-row"><button class="btn ghost" data-action="go" data-step="result">결과로</button><button class="btn" data-action="restart">조건 바꿔 다시 계산</button></div>`;
}

// 새로고침해도 입력이 남도록 이 탭의 세션 저장소에 둔다. 탭을 닫으면 지워지고 서버로는 보내지 않는다.
const STORE_KEY = 'munteok-state-v1';
const SAVED_KEYS = ['step', 'mode', 'rawText', 'fields', 'profile', 'offers', 'editing', 'active', 'sample', 'extractedBy', 'manualType'];

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
    const needsResult = ['compare', 'result', 'alts', 'basis'].includes(state.step);
    if (needsResult) {
      if (!state.offers.length) { state.step = 'start'; return; }
      recalculate();
      openOffer(Math.min(state.active || 0, state.offers.length - 1));
    }
    if (['confirm', 'questions'].includes(state.step) && !state.fields) state.step = state.offers.length ? 'offers' : 'start';
  } catch (e) {
    sessionStorage.removeItem(STORE_KEY);
    state.step = 'start';
  }
}

function recalculate() {
  const maxHours = state.profile.maxHours || 40;
  state.comparison = compareOffers(state.offers.map((o) => ({ name: o.name, job: jobOf(o.fields), meta: metaOf(o.fields) })), state.profile, state.rules, { maxHours });
}

const VIEWS = { start: viewStart, upload: viewUpload, confirm: viewConfirm, questions: viewQuestions, offers: viewOffers, compare: viewCompare, profile: viewProfile, result: viewResult, alts: viewAlts, basis: viewBasis };

function render() {
  if (state.step === 'questions' && missingFields().length === 0) saveDraft();
  app.innerHTML = VIEWS[state.step]();
  const group = STEP_GROUP[state.step];
  stepsEl.innerHTML = group === undefined ? '' : STEP_NAMES.map((n, i) => `<li class="${i === group ? 'on' : i < group ? 'done' : ''}" ${i === group ? 'aria-current="step"' : ''}>${i + 1} ${n}</li>`).join('');
  window.scrollTo(0, 0);
  persist();
}

// ---------------- 동작 ----------------

// 제안 하나의 상세 결과와 근무조건 비교를 준비한다.
function openOffer(i) {
  const job = jobOf(state.offers[i].fields);
  state.active = i;
  state.result = state.comparison.rows[i].result;
  state.alts = searchAlternatives(job, state.profile, state.rules, { maxHours: state.profile.maxHours || 40 });
  state.chosen = null;
}

function saveProfileInputs() {
  const num = (id) => { const el = document.getElementById(id); return el && el.value !== '' ? Number(el.value) : null; };
  if (!document.getElementById('p-age')) return;
  state.profile.age = num('p-age');
  state.profile.maxHours = Math.min(52, Math.max(1, num('p-max') || 40));
  state.profile.ytdIncome = { wage: num('y-wage') || 0, business: num('y-business') || 0, daily: num('y-daily') || 0 };
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다.')); };
    img.src = url;
  });
}

async function tryExtract(button) {
  const raw = document.getElementById('raw');
  if (raw) state.rawText = raw.value;
  const photo = document.getElementById('photo');
  if (photo && photo.files[0]) state.photoFile = photo.files[0];
  state.aiError = null;

  const body = {};
  if (state.mode === 'photo') {
    if (!state.photoFile) { state.aiError = '사진을 먼저 골라 주세요.'; render(); return; }
    try {
      body.image = { mediaType: 'image/jpeg', data: await imageToBase64(state.photoFile) };
    } catch (e) {
      state.aiError = e.message; render(); return;
    }
    state.rawText = '';
  } else {
    if (!state.rawText.trim()) { state.aiError = '공고나 메시지를 붙여 넣어 주세요.'; render(); return; }
    body.text = state.rawText;
  }
  if (!AI_AVAILABLE) {
    state.aiError = '이 주소에서는 AI 추출 서버가 아직 연결되지 않았습니다. 직접 입력이나 가상 샘플을 이용하세요.';
    render();
    return;
  }

  if (button) { button.disabled = true; button.textContent = 'AI가 조건을 읽는 중…'; }
  try {
    const res = await fetch(API_BASE + 'api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `AI 호출이 실패했습니다 (${res.status}).`);
    state.fields = withDefaults(data.fields);
    state.extractedBy = data.model || 'AI';
    state.sample = null;
    state.step = 'confirm';
  } catch (e) {
    state.aiError = (e instanceof TypeError ? 'AI 서버에 연결하지 못했습니다.' : e.message) + ' 다시 시도하거나, 직접 입력 또는 가상 샘플을 이용하세요.';
  }
  render();
}

app.addEventListener('submit', (e) => {
  if (e.target.id !== 'manual') return;
  e.preventDefault();
  const set = (v) => ({ value: v, status: STATUS.CONFIRMED, evidence: '직접 입력' });
  const type = state.manualType || 'unknown';
  state.fields = {
    hourlyWage: set(Number(document.getElementById('m-wage').value)),
    weeklyHours: set(Number(document.getElementById('m-hours').value)),
    startMonth: set(Number(document.getElementById('m-start').value)),
    months: set(Number(document.getElementById('m-months').value)),
    incomeType: type === 'unknown' ? { value: 'unknown', status: STATUS.CHECK, evidence: '' } : set(type),
  };
  withDefaults(state.fields);
  state.rawText = '';
  state.sample = null;
  state.extractedBy = null;
  state.step = 'confirm';
  render();
});

app.addEventListener('change', (e) => {
  if (e.target.dataset.offerName !== undefined) {
    const o = state.offers[Number(e.target.dataset.offerName)];
    if (o) { o.name = e.target.value.trim() || o.name; persist(); }
    return;
  }
  const key = e.target.dataset.field;
  if (!key && state.step === 'profile') { saveProfileInputs(); persist(); return; }
  if (!key || !state.fields) return;
  const raw = e.target.value;
  const value = key === 'incomeType' ? raw : key === 'holidayIncluded' ? raw === 'true' : raw === '' ? null : Number(raw);
  const known = key === 'incomeType' ? value !== 'unknown' : value !== null;
  state.fields[key] = { value, status: known ? STATUS.CONFIRMED : STATUS.CHECK, evidence: known ? '직접 수정' : '' };
  render();
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'go') {
    saveProfileInputs();
    if (el.dataset.step === 'upload' && state.step === 'start') Object.assign(state, { offers: [], editing: null, fields: emptyFields(), rawText: '', sample: null, extractedBy: null, profile: clone(EMPTY_PROFILE) });
    state.step = el.dataset.step;
    state.aiError = null;
  } else if (action === 'sample') {
    const s = SAMPLES.find((x) => x.id === el.dataset.id);
    Object.assign(state, { sample: s.id, rawText: s.text, extractedBy: null, fields: withDefaults(clone(s.extraction)), profile: clone(s.profile), result: null, alts: null, chosen: null, offers: [], editing: null, step: 'confirm' });
  } else if (action === 'samplePair') {
    const pick = (id) => { const x = SAMPLES.find((y) => y.id === id); return { name: x.title, fields: withDefaults(clone(x.extraction)), rawText: x.text, extractedBy: null }; };
    Object.assign(state, { offers: [pick('cafe'), pick('tutor')], profile: clone(SAMPLES[0].profile), editing: null, fields: null, sample: null, step: 'offers' });
  } else if (action === 'addOffer') {
    Object.assign(state, { editing: null, fields: emptyFields(), rawText: '', sample: null, extractedBy: null, aiError: null, step: 'upload' });
  } else if (action === 'editOffer') {
    const o = state.offers[Number(el.dataset.i)];
    Object.assign(state, { editing: Number(el.dataset.i), fields: clone(o.fields), rawText: o.rawText, extractedBy: o.extractedBy, step: 'confirm' });
  } else if (action === 'removeOffer') {
    state.offers.splice(Number(el.dataset.i), 1);
  } else if (action === 'detail') {
    openOffer(Number(el.dataset.i));
    state.step = 'result';
  } else if (action === 'mode') {
    const raw = document.getElementById('raw');
    if (raw) state.rawText = raw.value;
    state.mode = el.dataset.mode;
    state.aiError = null;
  } else if (action === 'extract') {
    tryExtract(el);
    return;
  } else if (action === 'afterConfirm') {
    if (missingFields().length) state.step = 'questions'; else saveDraft();
  } else if (action === 'choose') {
    const name = el.dataset.name;
    const value = el.dataset.value;
    if (name.startsWith('answer:')) {
      const key = name.slice(7);
      if (key === 'incomeType') {
        state.fields.incomeType = value === 'unknown'
          ? { value: 'unknown', status: STATUS.CHECK, evidence: '모른다고 답함' }
          : { value, status: STATUS.CONFIRMED, evidence: '추가 질문에서 답함' };
      } else if (key === 'months' && value === '0') {
        state.fields.months = { value: 12, status: STATUS.ESTIMATED, evidence: '모른다고 답해 연말까지로 가정' };
      } else {
        state.fields[key] = { value: Number(value), status: STATUS.CONFIRMED, evidence: '추가 질문에서 답함' };
      }
    } else if (name === 'manualType') {
      state.manualType = value;
      el.parentElement.querySelectorAll('.choice').forEach((b) => { b.classList.toggle('on', b === el); b.setAttribute('aria-pressed', b === el); });
      return;
    } else {
      saveProfileInputs();
      if (el.dataset.multi) {
        const list = new Set(state.profile[name] || []);
        list.has(value) ? list.delete(value) : list.add(value);
        state.profile[name] = [...list];
      } else {
        state.profile[name] = value;
      }
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
      return;
    }
  } else if (action === 'calculate') {
    saveProfileInputs();
    recalculate();
    openOffer(0);
    state.step = state.offers.length > 1 ? 'compare' : 'result';
  } else if (action === 'pick') {
    state.chosen = el.dataset.kind;
    render();
    document.getElementById('msg-card')?.scrollIntoView({ block: 'center' });
    return;
  } else if (action === 'copy') {
    const text = document.getElementById('msg').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      () => { el.textContent = '복사했습니다'; },
      () => { el.textContent = '복사하지 못했습니다. 문구를 길게 눌러 복사하세요'; },
    );
    return;
  } else if (action === 'restart') {
    Object.assign(state, { step: 'start', sample: null, rawText: '', fields: null, profile: clone(EMPTY_PROFILE), result: null, alts: null, chosen: null, aiError: null, offers: [], editing: null, comparison: null });
  }
  render();
});

fetch('data/rules.json').then((r) => r.json()).then((rules) => {
  state.rules = rules;
  window.__munteok = state; // 점검용
  restore();
  render();
}).catch(() => {
  app.innerHTML = '<div class="card warn" role="alert"><h3>규칙표를 불러오지 못했습니다</h3><p class="small">data/rules.json 파일을 확인하세요.</p></div>';
});
