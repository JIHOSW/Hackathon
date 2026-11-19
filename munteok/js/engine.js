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
  const holidayHours = over15 ? (Math.min(job.weeklyHours, 40) / 40) * 8 : 0;
  const holidayPay = Math.round(job.hourlyWage * holidayHours * WEEKS_PER_MONTH);
  const gross = base + holidayPay;
  const rates = r.employeeRates;
  const insuranceRate = rates.pension + rates.health + rates.longTermCare + rates.employment;
  const insurance = over15 ? Math.round(gross * insuranceRate) : 0;
  const withholding = job.incomeType === 'business' ? Math.round(gross * rules.businessWithholding.rate) : 0;
  return { base, holidayPay, gross, insurance, withholding, takeHome: gross - insurance - withholding, over15 };
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
  const end = Math.min(12, start + Math.max(1, job.months || 12) - 1);
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
  return { rows, start, end };
}

/** 누적값이 limit을 처음 넘는 달. 넘지 않으면 null. */
export function firstCrossMonth(rows, pick, limit) {
  const hit = rows.find((row) => pick(row.cumulative) > limit);
  return hit ? hit.month : null;
}

function won(n) { return Math.round(n).toLocaleString('ko-KR') + '원'; }

// ---------------- 제도별 카드 ----------------

function dependentCard(job, profile, rules, timeline) {
  const rule = rules.dependentDeduction;
  const card = { id: 'dependentDeduction', title: rule.title, period: rule.period, sources: ['tax_current', 'tax_proposed'], notes: [] };
  if (profile.taxDependent === 'no') return { ...card, applicable: false, reason: '부모의 연말정산 부양가족이 아니라고 답함' };
  const rows = timeline.rows;
  const last = rows[11].cumulative;

  const judge = (limits) => {
    // 근로소득만 있으면 총급여 기준, 사업소득만 있으면 수입 기준(보수적), 섞이면 판단 보류
    const hasBusiness = last.business > 0;
    const hasWage = last.wage > 0;
    if (job.incomeType === 'unknown' || last.unknown > 0) {
      return { crossed: null, month: null, status: STATUS.CHECK, text: '소득 종류를 알아야 판단할 수 있음' };
    }
    if (hasBusiness && hasWage) {
      return { crossed: null, month: null, status: STATUS.CHECK, text: '근로소득과 사업소득이 함께 있어 소득금액 계산이 필요함' };
    }
    if (hasBusiness) {
      const month = firstCrossMonth(rows, (c) => c.business, limits.incomeAmountLimit);
      if (!month) return { crossed: false, month: null, status: statusOf(limits.verification), text: `사업소득 수입이 ${won(limits.incomeAmountLimit)} 이하` };
      return { crossed: 'maybe', month, status: STATUS.CHECK, text: `사업소득 수입이 ${won(limits.incomeAmountLimit)}을 넘음. 경비를 뺀 금액이 기준이라 넘을 수 있음` };
    }
    if (hasWage) {
      const month = firstCrossMonth(rows, (c) => c.wage, limits.wageOnlyGrossLimit);
      const status = statusOf(limits.verification);
      if (!month) return { crossed: false, month: null, status, text: `연간 총급여가 ${won(limits.wageOnlyGrossLimit)} 이하` };
      return { crossed: true, month, status, text: `연간 총급여가 ${won(limits.wageOnlyGrossLimit)}을 넘음` };
    }
    return { crossed: false, month: null, status: STATUS.CHECK, text: '계산에 넣을 소득이 없음' };
  };

  const current = judge(rule.current);
  const proposed = judge(rule.proposed);
  card.applicable = true;
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
  if (last.daily > 0) {
    card.status = worstStatus(card.status, statusOf(rule.dailyWageExcluded.verification));
    card.notes.push(rule.dailyWageExcluded.note);
  }
  if (current.crossed) {
    const imp = rule.impact;
    if (profile.age != null && profile.age <= imp.basicDeductionMaxAge) {
      const b = imp.parentBrackets[profile.parentBracket];
      const calc = (rate) => Math.round(imp.basicDeductionAmount * rate * imp.localTaxMultiplier);
      card.impact = b
        ? { kind: 'annual', min: calc(b.rate), max: calc(b.rate), status: statusOf(imp.verification) }
        : { kind: 'annual', min: calc(imp.unknownRange.minRate), max: calc(imp.unknownRange.maxRate), status: statusOf(imp.verification) };
      card.impact.text = '부모의 연간 세금 증가(대략값)';
      card.notes.push(imp.note);
    } else {
      card.notes.push('만 20세를 넘으면 기본공제 대상이 아닐 수 있음. 교육비·의료비 등 다른 공제에 미치는 영향은 계산하지 않음');
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

  if (job.incomeType === 'unknown') {
    Object.assign(card, { crossed: null, crossMonth: null, status: STATUS.CHECK, headline: '소득 종류를 알아야 판단할 수 있음' });
  } else if (pay.over15) {
    Object.assign(card, {
      crossed: 'maybe', crossMonth: timeline.start, status: statusOf(rule.employeeConversion.verification),
      headline: '주 15시간 이상 일하면 직장가입자가 되어 피부양자에서 빠질 수 있음',
    });
    card.notes.push(rule.employeeConversion.note);
  } else {
    const businessMonth = firstCrossMonth(rows, (c) => c.business, rule.unregisteredBusinessIncomeLimit);
    const totalMonth = firstCrossMonth(rows, (c) => c.total, rule.totalIncomeLimit);
    if (totalMonth) {
      Object.assign(card, { crossed: true, crossMonth: totalMonth, status: worstStatus(base, STATUS.ESTIMATED), headline: `연간 소득 합계가 ${won(rule.totalIncomeLimit)}을 넘음` });
    } else if (businessMonth) {
      Object.assign(card, { crossed: 'maybe', crossMonth: businessMonth, status: STATUS.CHECK, headline: `사업소득 수입이 ${won(rule.unregisteredBusinessIncomeLimit)}을 넘음. 경비를 뺀 금액이 기준이라 넘을 수 있음` });
      card.notes.push(rule.businessIncomeMeasure.note);
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
  card.crossMonth = null;
  card.headline = pay.over15
    ? `주 ${rule.thresholdHours}시간 이상: 주휴수당 월 ${won(pay.holidayPay)} 발생, 4대보험 월 ${won(pay.insurance)} 공제`
    : `주 ${rule.thresholdHours}시간 미만: 주휴수당과 4대보험 가입 대상이 아님`;
  card.notes.push(rule.note);
  return card;
}

/**
 * 일자리 조건과 내 상황으로 전체 결과를 계산한다.
 * job: { hourlyWage, weeklyHours, startMonth, months, incomeType }
 * profile: { age, allowance: 'yes'|'no'|'applying', healthDependent, taxDependent: 'yes'|'no'|'unknown',
 *            ytdIncome: { wage, daily, business }, parentBracket: 'b1'..'b4'|'unknown', otherSupports: [] }
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
  const cards = all.filter((c) => c.applicable);
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
  return {
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
      crossedIds: cards.filter((c) => c.crossed).map((c) => c.id),
    },
  };
}

/**
 * 주당 근무시간을 1~40시간으로 바꿔 가며 계산해 대안을 찾는다.
 * AI 에이전트가 이 함수를 도구로 호출한다. 계산 자체는 전부 evaluate가 한다.
 */
export function searchAlternatives(job, profile, rules, { minHours = 1, maxHours = 40 } = {}) {
  const table = [];
  for (let h = minHours; h <= maxHours; h++) {
    const r = evaluate({ ...job, weeklyHours: h }, profile, rules);
    table.push({ weeklyHours: h, gross: r.pay.gross, takeHome: r.pay.takeHome, allowanceLoss: r.summary.allowanceLoss, net: r.summary.net, crossedIds: r.summary.crossedIds });
  }
  const at = (h) => table.find((t) => t.weeklyHours === h);
  const original = at(Math.min(maxHours, Math.max(minHours, Math.round(job.weeklyHours))));
  const options = [];
  if (original) options.push({ kind: 'original', label: '원래 조건', ...original });

  const safe = [...table].reverse().find((t) => t.crossedIds.length === 0);
  if (safe) options.push({ kind: 'safeAll', label: '어떤 기준선도 넘지 않는 최대 근무시간', ...safe });

  if (profile.allowance !== 'no') {
    const keep = [...table].reverse().find((t) => t.allowanceLoss === 0);
    if (keep && (!safe || keep.weeklyHours !== safe.weeklyHours)) {
      options.push({ kind: 'keepAllowance', label: '수당을 전액 유지하는 최대 근무시간', ...keep });
    }
  }

  // 더 일해도 실질 순소득이 직전 최고치보다 적은 구간(손해 구간)을 찾는다.
  // peak: 구간 직전의 최고 순소득, recover: 그 최고치를 다시 넘는 최소 근무시간
  let dip = null;
  let peak = table[0];
  for (const t of table) {
    if (t.net > peak.net) {
      if (dip && !dip.recoverHours) { dip.recoverHours = t.weeklyHours; dip.to = t.weeklyHours - 1; }
      if (!dip) peak = t;
    } else if (t.net < peak.net && !dip) {
      dip = { peakHours: peak.weeklyHours, peakNet: peak.net, from: t.weeklyHours, to: maxHours, recoverHours: null };
    }
  }
  if (dip && dip.recoverHours) {
    options.push({ kind: 'breakEven', label: '손해 구간을 지나 실질 순소득이 다시 커지는 최소 근무시간', ...table.find((t) => t.weeklyHours === dip.recoverHours) });
  }
  return {
    options,
    table,
    dip,
    trace: { variable: '주당 근무시간', from: minHours, to: maxHours, evaluated: table.length },
  };
}
