// 문턱 계산 엔진
// 기준선 판정과 금액 계산은 전부 이 파일에서 한다. AI는 이 계산값을 바꾸지 않는다.
// 모든 함수는 rules(data/rules.json)를 인자로 받는 순수 함수다.

export const WEEKS_PER_MONTH = 4.345; // 365일 ÷ 7일 ÷ 12개월

export const STATUS = { CONFIRMED: '확정', ESTIMATED: '추정', CHECK: '확인 필요' };
const STATUS_RANK = { '확정': 0, '추정': 1, '확인 필요': 2 };

/** 규칙의 확인 수준을 화면 표시 등급으로 바꾼다. */
export function statusOf(verification) {
  if (verification === 'official') return STATUS.CONFIRMED;
  if (verification === 'secondary') return STATUS.ESTIMATED;
  return STATUS.CHECK;
}

/** 여러 등급 중 가장 불확실한 등급을 돌려준다. */
export function worstStatus(...statuses) {
  return statuses.reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a), STATUS.CONFIRMED);
}

/**
 * 한 달 급여를 계산한다.
 * job: { hourlyWage, weeklyHours, incomeType: 'wage' | 'daily' | 'business' | 'unknown' }
 */
export function monthlyPay(job, rules) {
  const r = rules.weekly15h;
  const base = Math.round(job.hourlyWage * job.weeklyHours * WEEKS_PER_MONTH);
  const isWage = job.incomeType === 'wage';
  const over15 = isWage && job.weeklyHours >= r.thresholdHours;
  // 공고의 시급에 주휴수당이 이미 포함되어 있으면 따로 더하지 않는다.
  const holidayIncluded = over15 && job.holidayIncluded === true;
  const holidayHours = over15 && !holidayIncluded ? (Math.min(job.weeklyHours, 40) / 40) * 8 : 0;
  const holidayPay = Math.round(job.hourlyWage * holidayHours * WEEKS_PER_MONTH);
  const gross = base + holidayPay;
  const rates = r.employeeRates;
  const insuranceRate = rates.pension + rates.health + rates.longTermCare + rates.employment;
  const insurance = over15 ? Math.round(gross * insuranceRate) : 0;
  const withholding = job.incomeType === 'business' ? Math.round(gross * rules.businessWithholding.rate) : 0;
  return { base, holidayPay, gross, insurance, withholding, takeHome: gross - insurance - withholding, over15, holidayIncluded };
}

/** 구직촉진수당의 감액 기준선(이 금액에서 소득을 뺀 만큼 지급). */
export function allowanceLine(rules) {
  const a = rules.jobSeekerAllowance;
  return Math.max(a.medianIncome60, a.monthlyAllowance * a.lineMultiplier);
}

/** 그 달 소득이 monthlyIncome일 때 받는 구직촉진수당. */
export function allowancePayment(monthlyIncome, rules) {
  const a = rules.jobSeekerAllowance;
  return Math.max(0, Math.min(a.monthlyAllowance, allowanceLine(rules) - monthlyIncome));
}

/**
 * 1~12월 누적 소득 표를 만든다.
 * job: { startMonth(1~12), months(근무 개월 수) }, ytd: 올해 이미 번 소득 { wage, daily, business }
 */
export function buildTimeline(job, profile, pay) {
  const ytd = { wage: 0, daily: 0, business: 0, ...(profile.ytdIncome || {}) };
  const start = Math.min(12, Math.max(1, job.startMonth || 1));
  const requestedMonths = Math.max(1, job.months || 12);
  const end = Math.min(12, start + requestedMonths - 1);
  const type = job.incomeType;
  const rows = [];
  const cum = { wage: ytd.wage, daily: ytd.daily, business: ytd.business };
  for (let m = 1; m <= 12; m++) {
    const working = m >= start && m <= end;
    const income = working ? pay.gross : 0;
    if (working && (type === 'wage' || type === 'daily' || type === 'business')) cum[type] += income;
    const unknown = working && type === 'unknown' ? income : 0;
    const prevUnknown = rows.length ? rows[rows.length - 1].cumulative.unknown : 0;
    rows.push({
      month: m,
      working,
      income,
      cumulative: { wage: cum.wage, daily: cum.daily, business: cum.business, unknown: prevUnknown + unknown,
        total: cum.wage + cum.daily + cum.business + prevUnknown + unknown },
    });
  }
  // 연간 기준은 한 해(1~12월)만 계산한다. 해를 넘기는 달은 세지 않고 몇 달이 빠졌는지 알려 준다.
  const countedMonths = end - start + 1;
  return { rows, start, end, requestedMonths, countedMonths, uncountedMonths: requestedMonths - countedMonths };
}

/** 누적값이 limit을 처음 넘는 달. 넘지 않으면 null. */
export function firstCrossMonth(rows, pick, limit) {
  const hit = rows.find((row) => pick(row.cumulative) > limit);
  return hit ? hit.month : null;
}

function won(n) { return Math.round(n).toLocaleString('ko-KR') + '원'; }

// ---------------- 확인 수준 게이트 ----------------
// official  : 금액, 판정, 대안에 쓴다.
// secondary : 금액에 쓰되 "추정"으로 따로 표시한다.
// unverified: 금액, 판정, 대안에 쓰지 않는다. 추가 확인 항목(checks)으로만 내보낸다.
export function usable(verification) {
  return verification === 'official' || verification === 'secondary';
}

// ---------------- 제도별 카드 ----------------

function dependentCard(job, profile, rules, timeline) {
  const rule = rules.dependentDeduction;
  const card = { id: 'dependentDeduction', title: rule.title, period: rule.period, sources: ['tax_current', 'tax_proposed'], notes: [] };
  if (profile.taxDependent === 'no') return { ...card, applicable: false, reason: '부모의 연말정산 부양가족이 아니라고 답함' };
  const rows = timeline.rows;
  const last = rows[11].cumulative;

  card.checks = [];
  const judge = (limits, record) => {
    // 근로소득만 있으면 총급여 기준, 사업소득만 있으면 수입 기준(보수적), 섞이면 판단 보류
    const hasBusiness = last.business > 0;
    const hasWage = last.wage > 0;
    // 일용근로소득이 소득 요건에서 빠지는지 원문 확인 전이면, 일용 소득이 있을 때는 판정하지 않는다.
    if (last.daily > 0 && !usable(rule.dailyWageExcluded.verification)) {
      if (record) card.checks.push(`일용근로소득 ${won(last.daily)}이 부양가족 소득 요건에 포함되는지 확인 필요 (국세청 126)`);
      return { crossed: null, pending: true, month: null, status: STATUS.CHECK, text: '일용근로소득을 계산에 넣는지 확인 전이라 판정하지 않음' };
    }
    if (job.incomeType === 'unknown' || last.unknown > 0) {
      return { crossed: null, month: null, status: STATUS.CHECK, text: '소득 종류를 알아야 판단할 수 있음' };
    }
    if (hasBusiness && hasWage) {
      return { crossed: null, month: null, status: STATUS.CHECK, text: '근로소득과 사업소득이 함께 있어 소득금액 계산이 필요함' };
    }
    if (hasBusiness) {
      const month = firstCrossMonth(rows, (c) => c.business, limits.incomeAmountLimit);
      if (!month) return { crossed: false, month: null, status: statusOf(limits.verification), text: `사업소득 수입이 ${won(limits.incomeAmountLimit)} 이하` };
      // 수입은 넘지만, 경비를 뺀 금액으로 판단하는 방식이 확인 전이라 판정하지 않는다.
      if (record) card.checks.push(`사업소득 수입이 ${month}월에 ${won(limits.incomeAmountLimit)}을 넘음. 경비를 뺀 소득금액이 기준을 넘는지 확인 필요 (국세청 126)`);
      return { crossed: null, pending: true, month: null, status: STATUS.CHECK, text: `사업소득 수입이 ${won(limits.incomeAmountLimit)}을 넘음. 실제로 기준을 넘는지는 확인 전이라 판정하지 않음` };
    }
    if (hasWage) {
      const month = firstCrossMonth(rows, (c) => c.wage, limits.wageOnlyGrossLimit);
      const status = statusOf(limits.verification);
      if (!month) return { crossed: false, month: null, status, text: `연간 총급여가 ${won(limits.wageOnlyGrossLimit)} 이하` };
      return { crossed: true, month, status, text: `연간 총급여가 ${won(limits.wageOnlyGrossLimit)}을 넘음` };
    }
    return { crossed: false, month: null, status: STATUS.CHECK, text: '계산에 넣을 소득이 없음' };
  };

  const current = judge(rule.current, true);
  const proposed = judge(rule.proposed, false);
  card.applicable = true;
  card.pending = Boolean(current.pending);
  card.crossed = current.crossed;
  card.crossMonth = current.month;
  card.status = current.status;
  card.headline = current.text;
  card.limitText = `근로소득만 있으면 총급여 ${won(rule.current.wageOnlyGrossLimit)}, 그 밖에는 소득금액 ${won(rule.current.incomeAmountLimit)}`;
  card.proposed = {
    crossed: proposed.crossed, crossMonth: proposed.month, text: proposed.text,
    limitText: `총급여 ${won(rule.proposed.wageOnlyGrossLimit)}, 소득금액 ${won(rule.proposed.incomeAmountLimit)}`,
    state: rule.proposed.state,
  };
  if (profile.taxDependent === 'unknown') {
    card.status = STATUS.CHECK;
    card.notes.push('부양가족으로 올라 있는지 모른다고 답해, 올라 있다고 가정하고 계산함');
  }
  if (last.daily > 0) card.notes.push(rule.dailyWageExcluded.note);
  if (current.crossed) {
    // 부모 세금 증가액은 근거가 부족해 금액으로 계산하지 않고 확인 항목으로만 안내한다.
    card.notes.push(rule.impact.note);
    if (profile.age != null && profile.age > rule.impact.basicDeductionMaxAge) {
      card.notes.push(`만 ${rule.impact.basicDeductionMaxAge}세를 넘으면 기본공제 대상이 아닐 수 있음`);
    }
  }
  return card;
}

function healthCard(job, profile, rules, timeline, pay) {
  const rule = rules.healthDependent;
  const card = { id: 'healthDependent', title: rule.title, period: rule.period, sources: ['health_law', 'health_guide'], notes: [] };
  if (profile.healthDependent === 'no') return { ...card, applicable: false, reason: '부모의 건강보험 피부양자가 아니라고 답함' };
  const rows = timeline.rows;
  const last = rows[11].cumulative;
  card.applicable = true;
  card.limitText = `소득 합계 연 ${won(rule.totalIncomeLimit)}, 사업자등록 없는 사업소득 연 ${won(rule.unregisteredBusinessIncomeLimit)}`;
  const base = statusOf(rule.verification);
  card.checks = [];

  if (job.incomeType === 'unknown') {
    Object.assign(card, { crossed: null, crossMonth: null, status: STATUS.CHECK, headline: '소득 종류를 알아야 판단할 수 있음' });
  } else {
    // 직장가입자 전환 규칙이 확인 전이면 판정에 쓰지 않고 확인 항목으로만 남긴다.
    if (pay.over15) {
      if (usable(rule.employeeConversion.verification)) {
        Object.assign(card, { crossed: true, crossMonth: timeline.start, status: statusOf(rule.employeeConversion.verification), headline: '주 15시간 이상 일하면 직장가입자가 되어 피부양자에서 빠짐' });
      } else {
        card.checks.push('주 15시간 이상 일하면 직장가입자가 되어 피부양자에서 빠지는지 확인 필요 (국민건강보험공단 1577-1000)');
      }
    }
  }
  if (job.incomeType !== 'unknown' && card.crossed === undefined) {
    const businessMonth = firstCrossMonth(rows, (c) => c.business, rule.unregisteredBusinessIncomeLimit);
    const totalMonth = firstCrossMonth(rows, (c) => c.total, rule.totalIncomeLimit);
    if (totalMonth) {
      Object.assign(card, { crossed: true, crossMonth: totalMonth, status: worstStatus(base, STATUS.ESTIMATED), headline: `연간 소득 합계가 ${won(rule.totalIncomeLimit)}을 넘음` });
    } else if (businessMonth) {
      card.pending = true;
      card.checks.push(`사업소득 수입이 ${businessMonth}월에 ${won(rule.unregisteredBusinessIncomeLimit)}을 넘음. 경비를 뺀 금액이 기준을 넘는지 확인 필요 (국민건강보험공단 1577-1000)`);
      Object.assign(card, { crossed: null, crossMonth: null, status: STATUS.CHECK, headline: `사업소득 수입이 ${won(rule.unregisteredBusinessIncomeLimit)}을 넘음. 실제로 기준을 넘는지는 확인 전이라 판정하지 않음` });
    } else {
      Object.assign(card, { crossed: false, crossMonth: null, status: last.business > 0 ? base : worstStatus(base, STATUS.ESTIMATED), headline: '소득 기준을 넘지 않음' });
    }
  }
  if (profile.healthDependent === 'unknown') {
    card.status = STATUS.CHECK;
    card.notes.push('피부양자인지 모른다고 답해, 피부양자라고 가정하고 계산함');
  }
  if (card.crossed) card.notes.push(rule.impactNote);
  card.notes.push('판정은 소득 자료가 반영되는 다음 해에 이루어짐');
  return card;
}

function allowanceCard(job, profile, rules, pay) {
  const rule = rules.jobSeekerAllowance;
  const card = { id: 'jobSeekerAllowance', title: rule.title, period: rule.period, sources: ['allowance_amount', 'allowance_formula', 'median_income'], notes: [] };
  if (profile.allowance === 'no') return { ...card, applicable: false, reason: '구직촉진수당을 받지 않는다고 답함' };
  const line = allowanceLine(rules);
  const paid = allowancePayment(pay.gross, rules);
  const loss = rule.monthlyAllowance - paid;
  card.applicable = true;
  card.limitText = `월 소득 ${won(line - rule.monthlyAllowance)}까지 전액, ${won(line)} 이상이면 0원`;
  card.status = worstStatus(statusOf(rule.allowanceVerification), statusOf(rule.medianVerification), statusOf(rule.formulaVerification));
  card.crossed = loss > 0;
  card.crossMonth = null;
  card.paid = paid;
  card.impact = { kind: 'monthly', min: loss, max: loss, status: card.status, text: '줄어드는 수당(월)' };
  card.headline = loss === 0
    ? `수당 ${won(rule.monthlyAllowance)} 전액 유지`
    : paid === 0 ? '이 소득이면 그 달 수당이 지급되지 않음' : `수당이 ${won(paid)}으로 줄어듦`;
  card.flatZone = { from: line - rule.monthlyAllowance, to: line };
  card.checks = [];
  const emp = rule.employmentCheck;
  if (emp && !usable(emp.verification) && job.weeklyHours >= emp.weeklyHours) card.checks.push(emp.note);
  card.notes.push(rule.note);
  if (profile.allowance === 'applying') {
    card.status = STATUS.CHECK;
    card.notes.push('신청 중이라고 답해, 수급이 확정된 경우를 가정한 참고 계산임');
  }
  if (job.incomeType === 'unknown') card.status = worstStatus(card.status, STATUS.CHECK);
  return card;
}

function weeklyCard(job, rules, pay) {
  const rule = rules.weekly15h;
  const card = { id: 'weekly15h', title: rule.title, period: rule.period, sources: ['labor_15h', 'insurance_rates'], notes: [] };
  if (job.incomeType !== 'wage') {
    const reason = job.incomeType === 'unknown' ? '소득 종류를 알아야 판단할 수 있음' : '근로소득(4대보험 대상)이 아니어서 적용하지 않음';
    if (job.incomeType === 'unknown') {
      return { ...card, applicable: true, crossed: null, crossMonth: null, status: STATUS.CHECK, headline: reason, limitText: `주 ${rule.thresholdHours}시간` };
    }
    return { ...card, applicable: false, reason };
  }
  card.applicable = true;
  card.limitText = `주 ${rule.thresholdHours}시간`;
  card.status = worstStatus(statusOf(rule.verification), statusOf(rule.ratesVerification));
  card.crossed = pay.over15;
  card.holidayIncluded = pay.holidayIncluded;
  card.crossMonth = null;
  card.headline = pay.over15
    ? pay.holidayIncluded
      ? `주 ${rule.thresholdHours}시간 이상: 주휴수당은 시급에 포함된 것으로 계산, 4대보험 월 ${won(pay.insurance)} 공제`
      : `주 ${rule.thresholdHours}시간 이상: 주휴수당 월 ${won(pay.holidayPay)} 발생, 4대보험 월 ${won(pay.insurance)} 공제`
    : `주 ${rule.thresholdHours}시간 미만: 주휴수당과 4대보험 가입 대상이 아님`;
  card.notes.push(rule.note);
  return card;
}

/**
 * 카드의 변화가 사용자에게 어떤 종류인지 구분한다.
 * 기준을 넘었다는 사실(crossed)과, 그 변화가 유리한지 불리한지는 별개다.
 *   gain  급여가 늘어나는 변화 (주휴수당 발생)
 *   loss  받던 지원이 줄어드는 변화
 *   check   확인된 규칙으로 자격이 달라지는 변화
 *   pending 확인 전인 규칙이나 모르는 값 때문에 판정하지 못함
 *   note    알아 둘 변화 (유불리 없음)
 *   keep    변화 없음
 */
export function effectOf(card) {
  if (card.id === 'weekly15h') {
    if (card.crossed === true) return card.holidayIncluded ? { type: 'note', label: '4대보험 가입' } : { type: 'gain', label: '급여 증가' };
    if (card.crossed === null) return { type: 'pending', label: '판단 보류' };
    return { type: 'keep', label: '변화 없음' };
  }
  if (card.id === 'jobSeekerAllowance') {
    return card.crossed ? { type: 'loss', label: '수당 감소' } : { type: 'keep', label: '수당 유지' };
  }
  if (card.crossed === true) return { type: 'check', label: '자격 변동 확인' };
  // 확인 전인 규칙이나 모르는 값 때문에 판정하지 못한 경우. 불리한 변화로 세지 않고 따로 표시한다.
  if (card.crossed === null) return { type: 'pending', label: card.pending ? '추가 확인 필요' : '판단 보류' };
  return { type: 'keep', label: '자격 유지' };
}

/**
 * 일자리 조건과 내 상황으로 전체 결과를 계산한다.
 * job: { hourlyWage, weeklyHours, startMonth, months, incomeType }
 * profile: { age, allowance: 'yes'|'no'|'applying', healthDependent, taxDependent: 'yes'|'no'|'unknown',
 *            ytdIncome: { wage, daily, business }, maxHours, otherSupports: [] }
 */
export function evaluate(job, profile, rules) {
  const pay = monthlyPay(job, rules);
  const timeline = buildTimeline(job, profile, pay);
  const all = [
    dependentCard(job, profile, rules, timeline),
    healthCard(job, profile, rules, timeline, pay),
    allowanceCard(job, profile, rules, pay),
    weeklyCard(job, rules, pay),
  ];
  const cards = all.filter((c) => c.applicable).map((c) => ({ ...c, effect: effectOf(c) }));
  const notApplicable = all.filter((c) => !c.applicable).map((c) => ({ id: c.id, title: c.title, reason: c.reason }));
  const allowance = cards.find((c) => c.id === 'jobSeekerAllowance');
  const allowanceLoss = allowance ? allowance.impact.min : 0;
  const outOfScope = (profile.otherSupports || []).filter((id) => rules.outOfScope[id]).map((id) => {
    const o = rules.outOfScope[id];
    const contact = o.contact ? `${rules.contacts[o.contact].name} ${rules.contacts[o.contact].phone}` : o.contactText;
    return { id, title: o.title, contact };
  });
  const warnings = [];
  if (job.hourlyWage < rules.minimumWage.hourly) {
    warnings.push(`시급이 ${rules.appliesToYear}년 최저임금 ${won(rules.minimumWage.hourly)}보다 낮음. 수습 등 예외가 아니면 확인이 필요함`);
  }
  // 계산 범위에 대한 안내. 경고가 아니라 결과를 읽을 때 알아야 할 전제다.
  const notices = [`${rules.appliesToYear}년 규칙으로 한 해(1월~12월)를 계산한 값입니다. 다음 해의 기준 금액은 달라질 수 있습니다.`];
  if (timeline.uncountedMonths > 0) {
    notices.push(`${timeline.start}월부터 ${timeline.requestedMonths}개월 중 12월까지의 ${timeline.countedMonths}개월만 계산했습니다. 해를 넘기는 ${timeline.uncountedMonths}개월은 연간 기준이 새로 시작되므로 새해 규칙으로 다시 계산해야 합니다.`);
  }
  const next = rules.minimumWage.next;
  if (next && job.hourlyWage >= rules.minimumWage.hourly && job.hourlyWage < next.hourly) {
    notices.push(`${next.year}년 최저임금은 시급 ${won(next.hourly)}입니다. 해를 넘겨 일하면 ${next.year}년 1월부터 시급이 그 이상이어야 합니다.`);
  }
  // 금액을 확인 수준별로 나눈다. 큰 숫자에는 확정 항목만 쓰고, 추정 항목은 따로 보여 준다.
  const parts = [{ label: '급여', amount: pay.base, status: STATUS.CONFIRMED }];
  if (pay.holidayPay) parts.push({ label: '주휴수당', amount: pay.holidayPay, status: statusOf(rules.weekly15h.verification) });
  if (pay.insurance) parts.push({ label: '4대보험 근로자 부담분', amount: -pay.insurance, status: statusOf(rules.weekly15h.ratesVerification), reason: '요율을 2차 자료로 넣음' });
  if (pay.withholding) parts.push({ label: '3.3% 원천징수', amount: -pay.withholding, status: statusOf(rules.businessWithholding.verification), reason: '미리 내는 세금이며 다음 해 5월 종합소득세 신고로 정산됨' });
  if (allowanceLoss) parts.push({ label: '구직촉진수당 감소', amount: -allowanceLoss, status: allowance.status, reason: '2025년 계산식 기준. 2026년 적용 확인 전' });
  const sum = (list) => list.reduce((a, b) => a + b.amount, 0);
  const confirmedNet = sum(parts.filter((x) => x.status === STATUS.CONFIRMED));
  const estimatedParts = parts.filter((x) => x.status !== STATUS.CONFIRMED);
  const checks = cards.flatMap((c) => (c.checks || []).map((text) => ({ cardId: c.id, title: c.title, text })));
  const reports = [];
  if (allowance && pay.gross > 0) reports.push('구직촉진수당: 소득이 생기면 고용센터에 신고');
  if (job.incomeType === 'business') reports.push('3.3% 소득: 다음 해 5월 종합소득세 신고');
  const has = (id) => cards.some((c) => c.id === id);
  const excluded = ['소득세', has('dependentDeduction') ? '부모의 세금 변화' : null, has('healthDependent') ? '건강보험 지역가입자 보험료' : null, '교통비·식비 등 개인 지출'].filter(Boolean);
  return {
    notices,
    checks,
    ruleVersion: rules.version,
    year: rules.appliesToYear,
    pay,
    timeline,
    cards,
    notApplicable,
    outOfScope,
    warnings,
    summary: {
      addedIncome: pay.gross,
      insurance: pay.insurance,
      withholding: pay.withholding,
      allowanceLoss,
      net: pay.takeHome - allowanceLoss,
      // 계산에 넣은 것과 넣지 않은 것. 화면에서 그대로 밝힌다.
      parts,
      confirmedNet,
      estimatedParts,
      included: parts.map((x) => x.label),
      excluded,
      crossedIds: cards.filter((c) => c.crossed).map((c) => c.id),
      // 지원이 줄거나 자격 확인이 필요한 변화만 모은다. 급여가 늘어나는 변화는 넣지 않는다.
      // 확인 전인 규칙으로 판정하지 못한 카드(pending)는 넣지 않는다.
      adverseIds: cards.filter((c) => c.effect.type === 'loss' || c.effect.type === 'check').map((c) => c.id),
      pendingIds: cards.filter((c) => c.effect.type === 'pending').map((c) => c.id),
      reports,
      reportNeeded: reports.length > 0,
    },
  };
}

/**
 * 사용자가 가능한 범위 안에서 주당 근무시간을 바꿔 가며 계산해 비교할 조건을 찾는다.
 * AI 에이전트가 이 함수를 도구로 호출한다. 계산 자체는 전부 evaluate가 한다.
 * maxHours는 사용자가 답한 "주당 가능한 최대 시간"이다.
 */
export function searchAlternatives(job, profile, rules, { minHours = 1, maxHours = 40 } = {}) {
  const top = Math.max(minHours, Math.min(52, Math.round(maxHours)));
  const table = [];
  for (let h = minHours; h <= top; h++) {
    const r = evaluate({ ...job, weeklyHours: h }, profile, rules);
    table.push({
      weeklyHours: h, gross: r.pay.gross, takeHome: r.pay.takeHome, allowanceLoss: r.summary.allowanceLoss, net: r.summary.net,
      crossedIds: r.summary.crossedIds, adverseIds: r.summary.adverseIds, pendingIds: r.summary.pendingIds, checkCount: r.checks.length,
      effects: r.cards.map((c) => ({ id: c.id, type: c.effect.type, label: c.effect.label })),
    });
  }
  const at = (h) => table.find((t) => t.weeklyHours === h);
  const offered = Math.round(job.weeklyHours);
  const options = [];
  const push = (kind, label, row) => {
    if (row && !options.some((o) => o.weeklyHours === row.weeklyHours)) options.push({ kind, label, ...row });
  };

  // 받은 제안. 가능한 범위를 넘으면 범위 밖이라 비교에서 빠진다.
  push('original', '받은 제안 그대로', at(offered));
  // 가능한 범위에서 예상 추가수입이 가장 큰 조건. 같으면 근무시간이 적은 쪽.
  push('best', '가능한 범위에서 예상 추가수입이 가장 큰 조건', table.reduce((a, b) => (b.net > a.net ? b : a)));
  // 지원이 줄거나 자격 확인이 필요한 변화가 없는 조건 중 가장 긴 근무시간.
  // 주 4시간 미만이면 현실적인 제안이 아니어서 보여주지 않는다.
  const noChange = [...table].reverse().find((t) => t.adverseIds.length === 0);
  if (noChange && noChange.weeklyHours >= 4) push('noChange', '지원과 자격이 그대로인 가장 긴 근무시간', noChange);

  // 더 일해도 예상 추가수입이 직전 최고치보다 적은 구간을 찾는다.
  // peak: 구간 직전의 최고치, recover: 그 최고치를 다시 넘는 최소 근무시간
  let dip = null;
  let peak = table[0];
  for (const t of table) {
    if (t.net > peak.net) {
      if (dip && !dip.recoverHours) { dip.recoverHours = t.weeklyHours; dip.to = t.weeklyHours - 1; }
      if (!dip) peak = t;
    } else if (t.net < peak.net && !dip) {
      dip = { peakHours: peak.weeklyHours, peakNet: peak.net, from: t.weeklyHours, to: top, recoverHours: null };
    }
  }
  if (dip && dip.recoverHours) push('recover', '수당이 줄어든 뒤 예상 추가수입이 다시 커지는 근무시간', at(dip.recoverHours));

  return {
    options,
    table,
    dip,
    offeredOutOfRange: !at(offered),
    trace: { variable: '주당 근무시간', from: minHours, to: top, evaluated: table.length },
  };
}

/**
 * 시작 전에 고용주에게 확인할 질문을 만든다.
 * meta: 항목별 표시 등급 { hourlyWage: '확정' | '추정' | '확인 필요', weeklyHours, months, ... }
 */
export function employerQuestions(job, meta = {}, rules) {
  const q = [];
  const unsure = (key) => meta[key] && meta[key] !== STATUS.CONFIRMED;
  if (job.incomeType === 'unknown') q.push('급여에서 4대보험을 떼나요, 3.3%를 떼나요?');
  if (job.incomeType === 'wage' && job.weeklyHours >= rules.weekly15h.thresholdHours && (!meta.holidayIncluded || unsure('holidayIncluded'))) q.push('주휴수당은 시급과 별도로 지급되나요?');
  if (job.incomeType === 'business') q.push('근로계약서를 쓰나요, 용역(프리랜서) 계약인가요?');
  if (unsure('hourlyWage')) q.push('시급이 정확히 얼마인가요?');
  if (unsure('weeklyHours')) q.push('주당 근무시간과 휴게시간이 정확히 어떻게 되나요?');
  if (unsure('months') || unsure('startMonth')) q.push('근무는 언제부터 언제까지인가요?');
  return q;
}

/**
 * 일자리 제안 여러 개를 같은 기준으로 계산해 나란히 비교한다.
 * offers: [{ name, job, meta }]. 어느 제안이 나은지 결론을 내리지 않고, 기준별로 앞서는 제안만 표시한다.
 */
export function compareOffers(offers, profile, rules, { maxHours = 40 } = {}) {
  const rows = offers.map((o) => {
    const r = evaluate(o.job, profile, rules);
    const workedMonths = r.timeline.end - r.timeline.start + 1;
    const unsure = Object.values(o.meta || {}).filter((s) => s !== STATUS.CONFIRMED).length;
    return {
      name: o.name,
      job: o.job,
      gross: r.pay.gross,
      allowanceLoss: r.summary.allowanceLoss,
      net: r.summary.net,
      netPerHour: Math.round(r.summary.net / (o.job.weeklyHours * WEEKS_PER_MONTH)),
      workedMonths,
      uncountedMonths: r.timeline.uncountedMonths,
      periodNet: r.summary.net * workedMonths,
      effects: r.cards.map((c) => ({ id: c.id, type: c.effect.type, label: c.effect.label })),
      adverseIds: r.summary.adverseIds,
      checkCount: r.checks.length,
      confirmedNet: r.summary.confirmedNet,
      unsure,
      questions: employerQuestions(o.job, o.meta, rules),
      withinHours: o.job.weeklyHours <= maxHours,
      result: r,
    };
  });
  // 내가 가능한 시간 안에 있는 제안 중에서만 앞서는 제안을 표시한다. 못 하는 조건을 추천처럼 보이게 하지 않기 위해서다.
  const lead = (pick, better) => rows.reduce((best, row, i) => {
    if (!row.withinHours) return best;
    return best === -1 || better(pick(row), pick(rows[best])) ? i : best;
  }, -1);
  return {
    rows,
    highlights: {
      net: lead((r) => r.net, (a, b) => a > b),
      netPerHour: lead((r) => r.netPerHour, (a, b) => a > b),
      fewestUnsure: lead((r) => r.unsure, (a, b) => a < b),
    },
    maxHours,
  };
}
