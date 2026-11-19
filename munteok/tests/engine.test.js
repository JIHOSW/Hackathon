// 규칙 엔진 기대값 테스트
// 기대값은 엔진과 별개로 손으로 계산한 값이다. 규칙표(data/rules.json)의 수치가 바뀌면 함께 고친다.
import { monthlyPay, allowancePayment, allowanceLine, evaluate, searchAlternatives, compareOffers, employerQuestions, STATUS } from '../js/engine.js';

export function runTests(rules) {
  const results = [];
  const eq = (name, actual, expected) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, pass, actual, expected });
  };
  const base = { age: 20, allowance: 'no', healthDependent: 'no', taxDependent: 'no', ytdIncome: { wage: 0, daily: 0, business: 0 }, parentBracket: 'unknown', otherSupports: [] };
  const card = (r, id) => r.cards.find((c) => c.id === id);

  // 1. 한 달 급여
  let p = monthlyPay({ hourlyWage: 10320, weeklyHours: 14, incomeType: 'wage' }, rules);
  eq('주 14시간: 기본급', p.base, 627766);
  eq('주 14시간: 주휴수당 없음', p.holidayPay, 0);
  eq('주 14시간: 4대보험 없음', p.insurance, 0);
  p = monthlyPay({ hourlyWage: 10320, weeklyHours: 16, incomeType: 'wage' }, rules);
  eq('주 16시간: 기본급', p.base, 717446);
  eq('주 16시간: 주휴수당', p.holidayPay, 143489);
  eq('주 16시간: 4대보험', p.insurance, 83660);
  p = monthlyPay({ hourlyWage: 10320, weeklyHours: 20, incomeType: 'wage' }, rules);
  eq('주 20시간: 월 급여 합계', p.gross, 1076170);
  eq('주 20시간: 실수령', p.takeHome, 971594);
  p = monthlyPay({ hourlyWage: 13000, weeklyHours: 12, incomeType: 'business' }, rules);
  eq('사업소득: 월 수입', p.gross, 677820);
  eq('사업소득: 3.3% 원천징수', p.withholding, 22368);
  eq('사업소득: 주휴수당 없음', p.holidayPay, 0);

  // 2. 구직촉진수당
  eq('수당 기준선', allowanceLine(rules), 1538543);
  eq('소득 90만 원: 전액', allowancePayment(900000, rules), 600000);
  eq('소득 938,543원: 전액(경계)', allowancePayment(938543, rules), 600000);
  eq('소득 120만 원: 감액', allowancePayment(1200000, rules), 338543);
  eq('소득 1,538,543원: 0원(경계)', allowancePayment(1538543, rules), 0);
  eq('소득 160만 원: 0원', allowancePayment(1600000, rules), 0);

  // 3. 시나리오 A: 수당 수급자, 시급 10,500원 주 24시간
  const jobA = { hourlyWage: 10500, weeklyHours: 24, startMonth: 1, months: 12, incomeType: 'wage' };
  const profA = { ...base, age: 27, allowance: 'yes' };
  let r = evaluate(jobA, profA, rules);
  eq('A: 월 급여', r.pay.gross, 1313928);
  eq('A: 받는 수당', card(r, 'jobSeekerAllowance').paid, 224615);
  eq('A: 줄어드는 수당', r.summary.allowanceLoss, 375385);
  eq('A: 수당 카드 등급', card(r, 'jobSeekerAllowance').status, STATUS.ESTIMATED);
  eq('A: 해당 없는 제도 2개', r.notApplicable.map((c) => c.id), ['dependentDeduction', 'healthDependent']);
  const alt = searchAlternatives(jobA, profA, rules);
  const opt = (k) => alt.options.find((o) => o.kind === k);
  eq('A: 주 15시간은 급여 증가로 구분', card(r, 'weekly15h').effect.type, 'gain');
  eq('A: 수당은 감소로 구분', card(r, 'jobSeekerAllowance').effect.type, 'loss');
  eq('A: 불리하거나 확인할 변화는 수당뿐', r.summary.adverseIds, ['jobSeekerAllowance']);
  eq('A: 소득 신고 필요', r.summary.reportNeeded, true);
  eq('A 대안: 받은 제안', opt('original').weeklyHours, 24);
  eq('A 대안: 지원이 그대로인 가장 긴 시간', opt('noChange').weeklyHours, 17);
  eq('A 대안: 40시간까지 가능하면 가장 큰 조건은 40시간', opt('best').weeklyHours, 40);
  eq('A 대안: 손해 구간 직전 최고는 주 18시간', alt.dip.peakHours, 18);
  eq('A 대안: 손해 구간은 주 19~29시간', [alt.dip.from, alt.dip.to], [19, 29]);
  eq('A 대안: 예상 추가수입이 다시 커지는 최소', opt('recover').weeklyHours, 30);
  // 주당 최대 20시간만 가능한 경우: 그 범위 안에서만 비교한다
  const alt20 = searchAlternatives(jobA, profA, rules, { maxHours: 20 });
  const opt20 = (k) => alt20.options.find((o) => o.kind === k);
  eq('최대 20시간: 계산 횟수', alt20.trace.evaluated, 20);
  eq('최대 20시간: 받은 제안(24시간)은 범위 밖', [alt20.offeredOutOfRange, opt20('original')], [true, undefined]);
  eq('최대 20시간: 가장 큰 조건은 주 18시간', [opt20('best').weeklyHours, opt20('best').net], [18, 842783]);
  eq('최대 20시간: 지원이 그대로인 가장 긴 시간', opt20('noChange').weeklyHours, 17);
  eq('최대 20시간: 다시 커지는 구간 없음', [alt20.dip.from, alt20.dip.to, alt20.dip.recoverHours, opt20('recover')], [19, 20, null, undefined]);
  const altNone = searchAlternatives({ ...jobA, weeklyHours: 10 }, { ...base }, rules);
  eq('수당이 없으면 손해 구간 없음', altNone.dip, null);
  eq('A 대안: 계산 횟수', alt.trace.evaluated, 40);

  // 4. 부모 공제: 시급 10,320원 주 14시간, 1월 시작
  const jobD = { hourlyWage: 10320, weeklyHours: 14, startMonth: 1, months: 12, incomeType: 'wage' };
  r = evaluate(jobD, { ...base, taxDependent: 'yes', parentBracket: 'b2' }, rules);
  let d = card(r, 'dependentDeduction');
  eq('부모 공제: 넘음', d.crossed, true);
  eq('부모 공제: 8월에 넘음', d.crossMonth, 8);
  eq('부모 공제: 등급 확정', d.status, STATUS.CONFIRMED);
  eq('부모 공제: 개정안은 12월', d.proposed.crossMonth, 12);
  eq('부모 공제: 부모 세금 금액은 계산하지 않음', d.impact, undefined);
  eq('부모 공제: 자격 변동 확인으로 구분', d.effect.type, 'check');
  r = evaluate({ ...jobD, months: 7 }, { ...base, taxDependent: 'yes' }, rules);
  eq('부모 공제: 7개월만 일하면 넘지 않음', card(r, 'dependentDeduction').crossed, false);
  r = evaluate(jobD, { ...base, taxDependent: 'yes', ytdIncome: { wage: 3000000, daily: 0, business: 0 } }, rules);
  eq('부모 공제: 이미 번 300만 원이 있으면 4월', card(r, 'dependentDeduction').crossMonth, 4);

  // 5. 시나리오 B: 3.3% 사업소득, 3월 시작 10개월
  const jobB = { hourlyWage: 13000, weeklyHours: 12, startMonth: 3, months: 10, incomeType: 'business' };
  r = evaluate(jobB, { ...base, taxDependent: 'yes', healthDependent: 'yes' }, rules);
  d = card(r, 'dependentDeduction');
  eq('B 부모 공제: 넘을 수 있음', d.crossed, 'maybe');
  eq('B 부모 공제: 4월', d.crossMonth, 4);
  eq('B 부모 공제: 확인 필요', d.status, STATUS.CHECK);
  const h = card(r, 'healthDependent');
  eq('B 피부양자: 넘을 수 있음', h.crossed, 'maybe');
  eq('B 피부양자: 10월', h.crossMonth, 10);
  eq('B: 주 15시간 카드는 해당 없음', r.notApplicable.map((c) => c.id), ['jobSeekerAllowance', 'weekly15h']);

  const altB = searchAlternatives(jobB, { ...base, taxDependent: 'yes', healthDependent: 'yes' }, rules);
  eq('B 대안: 주 4시간 미만인 조건은 제안하지 않음', altB.options.map((o) => o.kind), ['original', 'best']);

  // 5-1. 제안 두 개 비교: 카페(A)와 학원 보조(B), 수당 수급자
  const cmp = compareOffers([
    { name: '카페', job: jobA, meta: { hourlyWage: '확정', weeklyHours: '추정', startMonth: '확정', months: '추정', incomeType: '확정' } },
    { name: '학원', job: jobB, meta: { hourlyWage: '확정', weeklyHours: '추정', startMonth: '확정', months: '확정', incomeType: '확정' } },
  ], profA, rules, { maxHours: 20 });
  eq('비교: 월 예상 추가수입', cmp.rows.map((x) => x.net), [810863, 655452]);
  eq('비교: 시간당 예상 추가수입', cmp.rows.map((x) => x.netPerHour), [7776, 12571]);
  eq('비교: 일하는 기간 전체', cmp.rows.map((x) => x.periodNet), [9730356, 6554520]);
  eq('비교: 월 금액은 카페, 시간당은 학원이 앞섬', [cmp.highlights.net, cmp.highlights.netPerHour], [0, 1]);
  eq('비교: 확인 안 된 항목이 적은 쪽은 학원', cmp.highlights.fewestUnsure, 1);
  eq('비교: 카페는 가능한 시간(20시간)을 넘음', cmp.rows.map((x) => x.withinHours), [false, true]);
  eq('비교: 학원은 수당이 줄지 않음', cmp.rows[1].allowanceLoss, 0);
  eq('고용주 질문: 카페 3개', cmp.rows[0].questions.length, 3);
  eq('고용주 질문: 학원은 계약 형태와 근무시간', cmp.rows[1].questions, ['근로계약서를 쓰나요, 용역(프리랜서) 계약인가요?', '주당 근무시간과 휴게시간이 정확히 어떻게 되나요?']);
  eq('고용주 질문: 소득 종류를 모르면 지급 방식부터', employerQuestions({ incomeType: 'unknown', weeklyHours: 10 }, {}, rules), ['급여에서 4대보험을 떼나요, 3.3%를 떼나요?']);

  // 6. 피부양자: 주 15시간 이상 근로소득
  r = evaluate({ hourlyWage: 10320, weeklyHours: 16, startMonth: 1, months: 12, incomeType: 'wage' }, { ...base, healthDependent: 'yes' }, rules);
  eq('피부양자: 직장가입 전환 가능', card(r, 'healthDependent').crossed, 'maybe');
  r = evaluate(jobD, { ...base, healthDependent: 'yes' }, rules);
  eq('피부양자: 주 14시간은 넘지 않음', card(r, 'healthDependent').crossed, false);

  // 7. 소득 종류 모름, 범위 밖 제도, 최저임금
  r = evaluate({ hourlyWage: 11000, weeklyHours: 16, startMonth: 1, months: 12, incomeType: 'unknown' }, { ...base, taxDependent: 'yes', healthDependent: 'yes', allowance: 'yes', otherSupports: ['youthRent', 'nothing'] }, rules);
  eq('모름: 모든 카드가 확인 필요', r.cards.map((c) => c.status), [STATUS.CHECK, STATUS.CHECK, STATUS.CHECK, STATUS.CHECK]);
  eq('모름: 부모 공제 판단 보류', card(r, 'dependentDeduction').crossed, null);
  eq('범위 밖 제도 1개 안내', r.outOfScope.map((o) => o.title), ['청년월세지원']);
  r = evaluate({ hourlyWage: 9860, weeklyHours: 10, startMonth: 1, months: 3, incomeType: 'wage' }, base, rules);
  eq('최저임금 미달 경고', r.warnings.length, 1);
  r = evaluate(jobD, base, rules);
  eq('해당 제도가 없으면 주 15시간 카드만', r.cards.map((c) => c.id), ['weekly15h']);
  eq('넘는 기준선 없음', r.summary.crossedIds, []);
  eq('주 15시간 미만은 변화 없음', card(r, 'weekly15h').effect.type, 'keep');
  eq('수당이 없으면 신고 안내 없음', r.summary.reportNeeded, false);

  // 8. 연도 범위: 해를 넘기는 기간과 다음 해 최저임금 안내
  r = evaluate({ hourlyWage: 10500, weeklyHours: 10, startMonth: 11, months: 6, incomeType: 'wage' }, base, rules);
  eq('11월부터 6개월: 올해 2개월만 계산', [r.timeline.countedMonths, r.timeline.uncountedMonths], [2, 4]);
  eq('11월부터 6개월: 12월 누적은 2개월치', r.timeline.rows[11].cumulative.wage, 2 * r.pay.gross);
  eq('해를 넘기면 안내 3개(연도, 빠진 기간, 다음 해 최저임금)', r.notices.length, 3);
  r = evaluate({ hourlyWage: 11000, weeklyHours: 10, startMonth: 3, months: 10, incomeType: 'wage' }, base, rules);
  eq('해를 넘기지 않고 시급이 충분하면 연도 안내만', [r.timeline.uncountedMonths, r.notices.length], [0, 1]);
  r = evaluate({ hourlyWage: 9860, weeklyHours: 10, startMonth: 1, months: 3, incomeType: 'wage' }, base, rules);
  eq('올해 최저임금 미달이면 경고만, 다음 해 안내는 생략', [r.warnings.length, r.notices.length], [1, 1]);

  return results;
}
