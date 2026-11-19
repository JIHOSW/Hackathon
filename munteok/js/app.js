// 문턱 화면 흐름
// 시작 → 올리기 → 추출 확인 → 추가 질문 → 내 상황 → 결과 → 대안 비교 → 근거와 다음 행동
// 계산은 전부 engine.js가 한다. 이 파일은 입력을 모으고 결과를 그리기만 한다.
import { evaluate, searchAlternatives, STATUS } from './engine.js';
import { SAMPLES, EMPTY_PROFILE, INCOME_TYPES } from './samples.js';

const app = document.getElementById('app');
const stepsEl = document.getElementById('steps');
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

const state = {
  step: 'start', rules: null, sample: null, mode: 'text', rawText: '', fileName: '',
  fields: null, profile: clone(EMPTY_PROFILE), result: null, alts: null, aiError: null, chosen: null,
};

const FIELD_LABELS = { hourlyWage: '시급 (원)', weeklyHours: '주당 근무시간', startMonth: '시작 월', months: '근무 개월 수', incomeType: '소득 종류' };
const STEP_GROUP = { upload: 0, confirm: 1, questions: 1, profile: 2, result: 3, alts: 3, basis: 3 };
const STEP_NAMES = ['올리기', '확인', '내 상황', '결과'];
const CARD_SHORT = { dependentDeduction: '부모 공제', healthDependent: '피부양자', jobSeekerAllowance: '구직촉진수당', weekly15h: '주 15시간' };

function emptyFields() {
  const blank = (v) => ({ value: v, status: STATUS.CHECK, evidence: '' });
  return { hourlyWage: blank(null), weeklyHours: blank(null), startMonth: blank(null), months: blank(null), incomeType: blank('unknown') };
}

function badge(status) {
  const cls = status === STATUS.CONFIRMED ? 's-confirmed' : status === STATUS.ESTIMATED ? 's-estimated' : 's-check';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

function crossTag(crossed) {
  if (crossed === true) return '<span class="tag over">넘음</span>';
  if (crossed === 'maybe') return '<span class="tag maybe">넘을 수 있음</span>';
  if (crossed === false) return '<span class="tag ok">넘지 않음</span>';
  return '<span class="tag hold">판단 보류</span>';
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
    <p class="lead">알바 공고나 제안 메시지의 조건으로 수당, 부모님 세금, 건강보험이 어떻게 달라지는지 봅니다.</p>
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
  const rows = Object.keys(FIELD_LABELS).map((key) => `
    <div class="field">
      <div class="field-head"><label for="fld-${key}"><b>${FIELD_LABELS[key]}</b></label>${badge(f[key].status)}</div>
      ${fieldInput(key, f[key]).replace('data-field', `id="fld-${key}" data-field`)}
      ${f[key].evidence ? `<p class="evidence">근거: ${esc(f[key].evidence)}</p>` : ''}
    </div>`).join('');
  const need = missingFields().length;
  return `<h1>추출 결과 확인</h1>
    <p class="lead">원문에서 읽은 값입니다. 틀린 값은 바로 고치세요.</p>
    ${state.rawText ? `<div class="card"><h3>원문</h3><pre class="raw">${esc(state.rawText)}</pre></div>` : ''}
    <div class="card">${rows}</div>
    <div class="card soft"><p class="small" style="margin:0"><b>확정</b> 원문에 적힌 값 · <b>추정</b> 문맥으로 계산한 값 · <b>확인 필요</b> 원문에서 알 수 없는 값</p></div>
    ${ready ? '' : '<p class="hint" role="alert">시급과 주당 근무시간을 입력해야 다음으로 갈 수 있습니다.</p>'}
    <button class="btn" data-action="afterConfirm" ${ready ? '' : 'disabled'}>${need ? `추가 질문 ${need}개에 답하기` : '내 상황 입력으로'}</button>`;
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

function viewProfile() {
  const p = state.profile;
  const f = state.fields;
  const yn = [['yes', '예'], ['no', '아니오'], ['unknown', '모름']];
  const brackets = Object.entries(state.rules.dependentDeduction.impact.parentBrackets).map(([k, v]) => [k, v.label]).concat([['unknown', '모름']]);
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
      <label class="f" style="margin-top:0">부모님의 연 소득 구간</label>
      ${choices('parentBracket', brackets, p.parentBracket)}
      <p class="hint">모르면 부모님 세금 영향을 범위로만 표시합니다.</p>
      <label class="f">그 밖에 받고 있는 지원 (여러 개 선택 가능)</label>
      ${choices('otherSupports', others, p.otherSupports, true)}
      <p class="hint">이 제도들은 이번 버전에서 계산하지 않고 문의처만 안내합니다.</p>
    </div>
    <div class="card soft">
      <h3>계산에 쓰는 일자리 조건</h3>
      <dl class="kv">
        <dt>시급</dt><dd>${won(f.hourlyWage.value)}</dd>
        <dt>주당 근무시간</dt><dd>${esc(f.weeklyHours.value)}시간</dd>
        <dt>기간</dt><dd>${esc(f.startMonth.value)}월부터 ${esc(f.months.value)}개월</dd>
        <dt>소득 종류</dt><dd>${esc(INCOME_TYPES[f.incomeType.value])}</dd>
      </dl>
      <button class="btn link" data-action="go" data-step="confirm">조건 수정</button>
    </div>
    <button class="btn" data-action="calculate">계산하기</button>`;
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
    <p>${crossTag(c.crossed)} ${esc(c.headline)}</p>
    <dl class="kv">
      <dt>기준선</dt><dd>${esc(c.limitText)}</dd>
      ${c.crossMonth ? `<dt>넘는 시점</dt><dd>${c.crossMonth}월</dd>` : ''}
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
    const cls = firstHit && row.month >= firstHit ? 'hit' : row.working ? 'work' : '';
    return `<div class="bar ${cls}" style="height:${Math.max(2, Math.round((row.cumulative.total / max) * 100))}%" title="${row.month}월 누적 ${won(row.cumulative.total)}"></div>`;
  }).join('');
  return `<div class="card">
    <h3>월별 누적 소득</h3>
    <p class="small">${firstHit ? `${firstHit}월부터 연간 기준선을 넘는 구간입니다(붉은색).` : '연간 기준선을 넘는 달이 없습니다.'} 12월 누적 ${won(rows[11].cumulative.total)}</p>
    <div class="tl" role="img" aria-label="1월부터 12월까지 누적 소득 막대 그래프">${bars}</div>
    <div class="tl-x">${rows.map((row) => `<span>${row.month}</span>`).join('')}</div>
  </div>`;
}

function viewResult() {
  const r = state.result;
  const s = r.summary;
  const deduct = s.insurance + s.withholding;
  const none = s.crossedIds.length === 0;
  return `<h1>결과</h1>
    <p class="lead">${r.year}년 기준 규칙으로 계산했습니다. 연간 기준은 1월부터 12월까지 합산합니다.</p>
    <div class="sum">
      <div class="card"><div class="k">추가 소득 (월)</div><div class="v mono">${won(s.addedIncome)}</div></div>
      <div class="card"><div class="k">${r.pay.withholding ? '3.3% 원천징수' : '4대보험 공제'} (월)</div><div class="v mono">${won(deduct)}</div></div>
      <div class="card"><div class="k">줄어드는 수당 (월)</div><div class="v mono">${won(s.allowanceLoss)}</div></div>
      <div class="card"><div class="k">실질 순소득 변화 (월)</div><div class="v mono">${won(s.net)}</div></div>
    </div>
    ${r.pay.holidayPay ? `<p class="small" style="margin-top:8px">추가 소득에는 주휴수당 ${won(r.pay.holidayPay)}이 포함되어 있습니다.</p>` : ''}
    ${r.warnings.map((w) => `<div class="card warn" role="alert"><p class="small" style="margin:0">${esc(w)}</p></div>`).join('')}
    <h2>제도별 결과</h2>
    ${none ? '<div class="card soft"><p style="margin:0"><b>현재 조건에서는 넘는 기준선이 없습니다.</b></p></div>' : ''}
    ${r.cards.map(cardHtml).join('')}
    ${timelineHtml(r)}
    ${r.notApplicable.length ? `<div class="card"><h3>해당하지 않아 계산하지 않은 제도</h3><ul class="notes">${r.notApplicable.map((n) => `<li>${esc(n.title)}: ${esc(n.reason)}</li>`).join('')}</ul></div>` : ''}
    ${r.outOfScope.length ? `<div class="card warn"><h3>이번 버전에서 계산하지 않는 제도</h3><ul class="notes">${r.outOfScope.map((o) => `<li><b>${esc(o.title)}</b>: 확인 필요. 문의처 ${esc(o.contact)}</li>`).join('')}</ul></div>` : ''}
    <button class="btn" data-action="go" data-step="alts">대안 비교 보기</button>
    <div class="btn-row"><button class="btn ghost" data-action="go" data-step="basis">근거와 다음 행동</button><button class="btn ghost" data-action="go" data-step="profile">조건 바꿔 다시</button></div>`;
}

function requestMessage(original, option) {
  return `안녕하세요. 근무시간과 관련해 여쭙고 싶습니다.\n제안해 주신 주 ${original}시간 대신 주 ${option.weeklyHours}시간으로 조정할 수 있을까요?\n제가 받고 있는 지원 제도의 소득 기준 때문에 근무시간을 맞춰야 해서 부탁드립니다.\n요일과 시간대는 최대한 맞추겠습니다. 감사합니다.`;
}

function viewAlts() {
  const a = state.alts;
  const original = a.options.find((o) => o.kind === 'original');
  const dip = a.dip ? `<div class="card danger">
      <h3>더 일해도 손해인 구간</h3>
      <p style="margin:0">주 ${a.dip.from}~${a.dip.to}시간은 실질 순소득이 주 ${a.dip.peakHours}시간 때(월 ${won(a.dip.peakNet)})보다 적습니다.${a.dip.recoverHours ? ` 주 ${a.dip.recoverHours}시간부터 다시 커집니다.` : ''}</p>
    </div>` : '';
  const cards = a.options.map((o) => `<div class="card">
      <div class="card-head"><h3>${esc(o.label)}</h3><span class="tag ${o.crossedIds.length ? 'over' : 'ok'}">${o.crossedIds.length ? '기준선 ' + o.crossedIds.length + '개 넘음' : '기준선 이하'}</span></div>
      <dl class="kv">
        <dt>근무시간</dt><dd>주 ${o.weeklyHours}시간</dd>
        <dt>월 급여</dt><dd>${won(o.gross)}</dd>
        <dt>줄어드는 수당</dt><dd>${won(o.allowanceLoss)}</dd>
        <dt>실질 순소득</dt><dd><b>${won(o.net)}</b></dd>
        <dt>넘는 기준선</dt><dd>${o.crossedIds.length ? o.crossedIds.map((id) => CARD_SHORT[id]).join(', ') : '없음'}</dd>
      </dl>
      ${o.kind === 'original' ? '' : `<button class="btn ghost" data-action="pick" data-kind="${o.kind}" style="margin-top:10px">이 조건으로 요청 문구 만들기</button>`}
    </div>`).join('');
  const chosen = state.chosen && a.options.find((o) => o.kind === state.chosen);
  const msg = chosen ? `<div class="card soft" id="msg-card">
      <h3>근무시간 조정 요청 문구</h3>
      <pre class="msg" id="msg">${esc(requestMessage(original ? original.weeklyHours : state.fields.weeklyHours.value, chosen))}</pre>
      <button class="btn" data-action="copy">문구 복사</button>
      <p class="hint">문구 예시입니다. 상황에 맞게 고쳐 쓰세요.</p>
    </div>` : '';
  return `<h1>대안 비교</h1>
    <p class="lead">${esc(a.trace.variable)}을 ${a.trace.from}~${a.trace.to}시간으로 바꿔 가며 ${a.trace.evaluated}번 계산해 찾은 조건입니다. 시급과 기간은 그대로 두었습니다.</p>
    ${dip}${cards}${msg}
    <div class="btn-row"><button class="btn ghost" data-action="go" data-step="result">결과로</button><button class="btn ghost" data-action="go" data-step="basis">근거와 다음 행동</button></div>`;
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
  return `<h1>근거와 다음 행동</h1>
    <p class="lead">규칙표 ${esc(rules.version)} 기준입니다. 확정은 정부·법령 원문을 확인한 규칙, 추정은 2차 자료나 계산값, 확인 필요는 원문을 확인하지 못한 규칙입니다.</p>
    ${cards}
    <div class="card warn">
      <h3>신고 의무</h3>
      <p class="small" style="margin:0">수당을 받는 중에 소득이 생기면 담당 기관에 신고해야 합니다. 이 서비스는 소득을 숨기거나 신고를 피하는 방법을 안내하지 않습니다.</p>
    </div>
    <div class="card"><h3>공식 문의처</h3><ul class="notes">${contacts}</ul></div>
    <div class="btn-row"><button class="btn ghost" data-action="go" data-step="result">결과로</button><button class="btn" data-action="restart">조건 바꿔 다시 계산</button></div>`;
}

const VIEWS = { start: viewStart, upload: viewUpload, confirm: viewConfirm, questions: viewQuestions, profile: viewProfile, result: viewResult, alts: viewAlts, basis: viewBasis };

function render() {
  if (state.step === 'questions' && missingFields().length === 0) state.step = 'profile';
  app.innerHTML = VIEWS[state.step]();
  const group = STEP_GROUP[state.step];
  stepsEl.innerHTML = group === undefined ? '' : STEP_NAMES.map((n, i) => `<li class="${i === group ? 'on' : i < group ? 'done' : ''}" ${i === group ? 'aria-current="step"' : ''}>${i + 1} ${n}</li>`).join('');
  window.scrollTo(0, 0);
}

// ---------------- 동작 ----------------

function saveProfileInputs() {
  const num = (id) => { const el = document.getElementById(id); return el && el.value !== '' ? Number(el.value) : null; };
  if (!document.getElementById('p-age')) return;
  state.profile.age = num('p-age');
  state.profile.ytdIncome = { wage: num('y-wage') || 0, business: num('y-business') || 0, daily: num('y-daily') || 0 };
}

function jobFromFields() {
  const f = state.fields;
  return { hourlyWage: Number(f.hourlyWage.value), weeklyHours: Number(f.weeklyHours.value), startMonth: Number(f.startMonth.value), months: Number(f.months.value), incomeType: f.incomeType.value };
}

async function tryExtract() {
  const raw = document.getElementById('raw');
  if (raw) state.rawText = raw.value;
  state.aiError = null;
  try {
    const res = await fetch('api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: state.rawText }) });
    if (!res.ok) throw new Error('호출 실패 (' + res.status + ')');
    const data = await res.json();
    state.fields = data.fields;
    state.step = 'confirm';
  } catch (e) {
    state.aiError = 'AI 서버에 연결되지 않았거나 호출이 실패했습니다. 다시 시도하거나, 직접 입력 또는 가상 샘플을 이용하세요.';
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
  state.rawText = '';
  state.sample = null;
  state.step = 'confirm';
  render();
});

app.addEventListener('change', (e) => {
  const key = e.target.dataset.field;
  if (!key || !state.fields) return;
  const raw = e.target.value;
  const value = key === 'incomeType' ? raw : raw === '' ? null : Number(raw);
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
    if (el.dataset.step === 'upload' && !state.fields) state.fields = emptyFields();
    state.step = el.dataset.step;
    state.aiError = null;
  } else if (action === 'sample') {
    const s = SAMPLES.find((x) => x.id === el.dataset.id);
    Object.assign(state, { sample: s.id, rawText: s.text, fields: clone(s.extraction), profile: clone(s.profile), result: null, alts: null, chosen: null, step: 'confirm' });
  } else if (action === 'mode') {
    const raw = document.getElementById('raw');
    if (raw) state.rawText = raw.value;
    state.mode = el.dataset.mode;
    state.aiError = null;
  } else if (action === 'extract') {
    tryExtract();
    return;
  } else if (action === 'afterConfirm') {
    state.step = missingFields().length ? 'questions' : 'profile';
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
    const job = jobFromFields();
    state.result = evaluate(job, state.profile, state.rules);
    state.alts = searchAlternatives(job, state.profile, state.rules);
    state.chosen = null;
    state.step = 'result';
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
    Object.assign(state, { step: 'start', sample: null, rawText: '', fields: null, profile: clone(EMPTY_PROFILE), result: null, alts: null, chosen: null, aiError: null });
  }
  render();
});

fetch('data/rules.json').then((r) => r.json()).then((rules) => {
  state.rules = rules;
  window.__munteok = state; // 점검용
  render();
}).catch(() => {
  app.innerHTML = '<div class="card warn" role="alert"><h3>규칙표를 불러오지 못했습니다</h3><p class="small">data/rules.json 파일을 확인하세요.</p></div>';
});
