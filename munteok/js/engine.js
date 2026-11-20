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
  // 기간을 일수로 넣으면(job.days, 한 달보다 짧은 일) 한 달 대신 그 기간 동안의 돈을 계산한다.
  const days = shortDays(job);
  const weeks = days ? days / 7 : WEEKS_PER_MONTH;
  const base = Math.round(job.hourlyWage * job.weeklyHours * weeks);
  const isWage = job.incomeType === 'wage';
  const over15 = isWage && job.weeklyHours >= r.thresholdHours;
  // 공고의 시급에 주휴수당이 이미 포함되어 있으면 따로 더하지 않는다.
  const holidayIncluded = over15 && job.holidayIncluded === true;
  const holidayHours = over15 && !holidayIncluded ? (Math.min(job.weeklyHours, 40) / 40) * 8 : 0;
  // 주휴수당은 한 주를 다 채워야 생기므로, 일수로 넣은 기간은 다 채운 주만 센다(근로기준법 제55조).
  const holidayWeeks = days ? Math.floor(days / 7) : WEEKS_PER_MONTH;
  const holidayPay = Math.round(job.hourlyWage * holidayHours * holidayWeeks);
  const gross = base + holidayPay;
  const rates = r.employeeRates;
  // 4대보험 가입은 한 달 소정근로시간 60시간이 기준이다. 주 15시간 이상이면 확실히 해당한다.
  // 주 15시간 미만이어도 3개월 이상 계속 일하면 고용보험은 가입 대상이다(고용보험법 시행령 제3조).
  const cov = r.coverage || {};
  const monthlyHours = job.weeklyHours * weeks;
  const healthPension = over15;
  const employmentIns = isWage && (over15 || (!days && cov.employmentMonthsException != null && (job.months || 0) >= cov.employmentMonthsException));
  // 주 15시간 미만인데 한 달로 바꾸면 60시간 이상인 구간(주 14시간): 건강보험·국민연금 대상인지 공단 확인이 필요하다.
  const insuranceBoundary = !days && isWage && !over15 && cov.monthlyHours != null && monthlyHours >= cov.monthlyHours;
  const insuranceRate = (healthPension ? rates.pension + rates.health + rates.longTermCare : 0) + (employmentIns ? rates.employment : 0);
  const insurance = Math.round(gross * insuranceRate);
  const withholding = job.incomeType === 'business' ? Math.round(gross * rules.businessWithholding.rate) : 0;
  return { base, holidayPay, gross, insurance, withholding, takeHome: gross - insurance - withholding, over15, holidayIncluded, healthPension, employmentIns, insuranceBoundary, monthlyHours, days };
}

/** 한 달보다 짧게 일하는 일수(1~31). 개월로 넣었으면 null. */
export const MAX_SHORT_DAYS = 31;
export function shortDays(job) {
  const d = Math.round(Number(job.days));
  return d >= 1 && d <= MAX_SHORT_DAYS ? d : null;
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
  // 일수로 넣은 짧은 일은 시작하는 달에 모두 번 것으로 본다.
  const days = shortDays(job);
  const requestedMonths = days ? 1 : Math.max(1, job.months || 12);
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
  return { rows, start, end, requestedMonths, countedMonths, uncountedMonths: requestedMonths - countedMonths, days };
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
  // 자녀는 20세 이하만 기본공제 대상이다(소득세법 제50조). 장애인은 나이 제한이 없어 안내에 적는다.
  if (usable(rule.impact.verification) && profile.age != null && profile.age > rule.impact.basicDeductionMaxAge) {
    return { ...card, applicable: false, reason: `만 ${rule.impact.basicDeductionMaxAge}세를 넘으면 소득과 관계없이 부모님 기본공제 대상이 아님 (장애인은 예외)` };
  }
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
    const conv = rule.employeeConversion;
    if (pay.over15 && pay.days) {
      // 1개월이 안 되는 일은 직장가입자 대상에서 빠질 수 있다(국민건강보험법 시행령 제9조). 원문 확인 전이라 판정하지 않는다.
      card.checks.push(`${pay.days}일 동안만 일하면 직장가입자가 되지 않을 수 있어, 피부양자에서 빠지는지 확인 필요 (국민건강보험공단 1577-1000)`);
    } else if (pay.over15) {
      if (usable(conv.verification)) {
        Object.assign(card, { crossed: true, crossMonth: timeline.start, status: statusOf(conv.verification), headline: '한 달 60시간(주 15시간) 이상 일하면 직장가입자가 되어 피부양자에서 빠짐' });
      } else {
        card.checks.push('주 15시간 이상 일하면 직장가입자가 되어 피부양자에서 빠지는지 확인 필요 (국민건강보험공단 1577-1000)');
      }
    } else if (pay.insuranceBoundary) {
      card.checks.push(`주 ${job.weeklyHours}시간은 한 달 약 ${Math.round(pay.monthlyHours)}시간이라 직장가입자가 되는지 확인 필요 (국민건강보험공단 1577-1000)`);
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

/**
 * 수당을 받는 마지막 달. 숫자면 그 달까지, 'unknown'이면 모름(일하는 동안 계속 받는다고 보고 확인 항목을 남김),
 * 값이 없으면 일하는 동안 계속 받는다고 본다.
 */
export function allowanceEnd(profile) {
  const v = profile.allowanceEndMonth;
  return typeof v === 'number' && v >= 1 && v <= 12 ? v : null;
}

function allowanceCard(job, profile, rules, pay, timeline) {
  const rule = rules.jobSeekerAllowance;
  const card = { id: 'jobSeekerAllowance', title: rule.title, period: rule.period, sources: ['allowance_amount', 'allowance_formula', 'median_income'], notes: [] };
  if (profile.allowance === 'no') return { ...card, applicable: false, reason: '구직촉진수당을 받지 않는다고 답함' };
  const endMonth = allowanceEnd(profile);
  card.endMonth = endMonth;
  if (endMonth && endMonth < timeline.start) {
    return { ...card, applicable: true, crossed: false, crossMonth: null, paid: 0, ended: false, beforeStart: true, status: statusOf(rule.allowanceVerification),
      impact: { kind: 'monthly', min: 0, max: 0, status: statusOf(rule.allowanceVerification), text: '줄어드는 수당(월)' },
      flatZone: { from: allowanceLine(rules) - rule.monthlyAllowance, to: allowanceLine(rules) },
      headline: `일을 시작하는 ${timeline.start}월 전에 수당이 끝나서 줄어드는 수당이 없음`, limitText: `${endMonth}월까지 받음`, checks: [] };
  }
  const line = allowanceLine(rules);
  // 주 30시간 이상 일자리에 취업하면 취업지원이 끝나 수당도 끊긴다(시행규칙 제20조). 일용근로는 제외.
  const emp = rule.employmentCheck;
  // 한 달이 안 되는 일(일수로 넣은 일)은 일용근로로 볼 수 있어, 수당이 끝난다고 판정하지 않고 확인 항목으로 남긴다.
  const ended = Boolean(emp && usable(emp.verification) && job.incomeType !== 'daily' && !pay.days && job.weeklyHours >= emp.weeklyHours);
  const paid = ended ? 0 : allowancePayment(pay.gross, rules);
  const loss = rule.monthlyAllowance - paid;
  card.applicable = true;
  card.limitText = `월 소득 ${won(line - rule.monthlyAllowance)}까지 전액, ${won(line)} 이상이면 0원`;
  card.status = worstStatus(statusOf(rule.allowanceVerification), statusOf(rule.medianVerification), statusOf(rule.formulaVerification));
  card.crossed = loss > 0;
  card.crossMonth = null;
  card.paid = paid;
  card.ended = ended;
  card.impact = { kind: 'monthly', min: loss, max: loss, status: card.status, text: ended ? '받지 못하게 되는 수당(월)' : '줄어드는 수당(월)' };
  card.headline = ended
    ? `주 ${emp.weeklyHours}시간 이상 일자리에 취업하면 수당 지급이 끝남`
    : loss === 0
      ? `수당 ${won(rule.monthlyAllowance)} 전액 유지`
      : paid === 0 ? '이 소득이면 그 달 수당이 지급되지 않음' : `수당이 ${won(paid)}으로 줄어듦`;
  card.flatZone = { from: line - rule.monthlyAllowance, to: line };
  card.checks = [];
  if (endMonth && endMonth < timeline.end) card.notes.push(`${endMonth}월에 수당이 끝나면 ${endMonth + 1}월부터는 줄어드는 수당이 없음`);
  if (profile.allowanceEndMonth === 'unknown') card.checks.push('수당이 몇 월에 끝나는지 몰라 일하는 동안 계속 받는다고 보고 계산함. 고용24나 고용센터(1350)에서 끝나는 달을 확인 필요');
  if (emp && !usable(emp.verification) && job.weeklyHours >= emp.weeklyHours) card.checks.push(emp.note);
  if (emp && pay.days && job.incomeType !== 'daily' && job.weeklyHours >= emp.weeklyHours) {
    card.checks.push(`주 ${emp.weeklyHours}시간 이상이지만 ${pay.days}일만 일하는 일이라, 취업으로 보아 수당이 끝나는지 확인 필요 (고용센터 1350)`);
  }
  if (ended) card.notes.push(emp.note);
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
  card.employmentOnly = !pay.over15 && pay.employmentIns;
  card.crossMonth = null;
  card.checks = [];
  // 일수로 넣은 일은 금액이 한 달이 아니라 그 기간 동안의 돈이다.
  const amt = (n) => (pay.days ? `${won(n)}(${pay.days}일 동안)` : `월 ${won(n)}`);
  card.headline = pay.over15
    ? pay.holidayIncluded
      ? `주 ${rule.thresholdHours}시간 이상: 주휴수당은 시급에 포함된 것으로 계산, 4대보험 ${amt(pay.insurance)} 공제`
      : pay.days && !pay.holidayPay
        ? `주 ${rule.thresholdHours}시간 이상이지만 한 주를 다 채우지 않아 주휴수당은 넣지 않음, 4대보험 ${amt(pay.insurance)} 공제`
        : `주 ${rule.thresholdHours}시간 이상: 주휴수당 ${amt(pay.holidayPay)} 발생, 4대보험 ${amt(pay.insurance)} 공제`
    : card.employmentOnly
      ? `주 ${rule.thresholdHours}시간 미만: 주휴수당은 없고, 3개월 이상 일해 고용보험 ${amt(pay.insurance)}만 공제`
      : `주 ${rule.thresholdHours}시간 미만: 주휴수당과 4대보험 가입 대상이 아님`;
  if (pay.days && pay.over15) {
    if (pay.holidayPay) card.checks.push('일이 끝나는 마지막 주는 다음 주 근무가 없어 주휴수당이 없을 수 있어 확인 필요 (고용노동부 1350)');
    card.checks.push(`${pay.days}일만 일하면 국민연금·건강보험 가입 대상이 아닐 수 있어 확인 필요. 보험료는 떼는 것으로 보고 계산함 (국민연금공단 1355, 국민건강보험공단 1577-1000)`);
  }
  if (pay.insuranceBoundary && rule.coverage) card.checks.push(rule.coverage.boundaryNote + ' (국민건강보험공단 1577-1000)');
  if (card.employmentOnly && rule.coverage) card.notes.push(rule.coverage.employmentNote);
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
    if (card.employmentOnly) return { type: 'note', label: '고용보험 가입' };
    if (card.crossed === null) return { type: 'pending', label: '판단 보류' };
    return { type: 'keep', label: '변화 없음' };
  }
  if (card.id === 'jobSeekerAllowance') {
    if (card.ended) return { type: 'loss', label: '수당 종료' };
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
    allowanceCard(job, profile, rules, pay, timeline),
    weeklyCard(job, rules, pay),
  ];
  const cards = all.filter((c) => c.applicable).map((c) => ({ ...c, effect: effectOf(c) }));
  const notApplicable = all.filter((c) => !c.applicable).map((c) => ({ id: c.id, title: c.title, reason: c.reason }));
  const allowance = cards.find((c) => c.id === 'jobSeekerAllowance');
  const allowanceLoss = allowance ? allowance.impact.min : 0;
  const outOfScope = (profile.otherSupports || []).filter((id) => rules.outOfScope[id]).map((id) => {
    const o = rules.outOfScope[id];
    const contact = o.contact ? `${rules.contacts[o.contact].name} ${rules.contacts[o.contact].phone}` : o.contactText;
    const item = { id, title: o.title, contact };
    if (o.note) item.note = o.note;
    // 실업급여는 계산하지 않지만, 끝나는 달을 알면 그 뒤로는 줄어들 실업급여가 없다는 것까지는 알려 준다.
    if (id === 'unemploymentBenefit') {
      const end = typeof profile.unemploymentEndMonth === 'number' ? profile.unemploymentEndMonth : null;
      item.endMonth = end;
      item.note = end ? `${end}월에 끝나면 그 뒤로는 일해도 줄어들 실업급여가 없음. 끝나기 전에 일하면 받는 금액이 달라질 수 있어 확인 필요` : '일을 시작하면 고용센터에 알려야 하고, 받는 금액이 달라질 수 있어 확인 필요';
    }
    return item;
  });
  const warnings = [];
  if (profile.allowance !== 'no' && (profile.otherSupports || []).includes('unemploymentBenefit')) {
    warnings.push('실업급여(구직급여)를 받게 되면 국민취업지원제도 지원이 끝남(시행규칙 제20조). 두 지원을 함께 받고 있다면 고용센터(1350)에 확인 필요');
  }
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
  if (pay.days) {
    notices.push(`${pay.days}일 동안 일하고, 번 돈은 모두 ${timeline.start}월에 받는 것으로 계산했습니다. 달을 넘겨 일하면 달마다 금액이 나뉘어 수당이 줄어드는 정도가 달라질 수 있습니다.`);
  }
  // 금액을 확인 수준별로 나눈다. 큰 숫자에는 확정 항목만 쓰고, 추정 항목은 따로 보여 준다.
  const parts = [{ label: '급여', amount: pay.base, status: STATUS.CONFIRMED }];
  if (pay.holidayPay) parts.push({ label: '주휴수당', amount: pay.holidayPay, status: statusOf(rules.weekly15h.verification) });
  const reasonIf = (status, text) => (status === STATUS.CONFIRMED ? undefined : text);
  // 한 달이 안 되는 일은 국민연금·건강보험 가입 대상인지 확인 전이라, 떼는 것으로 계산하되 어림값으로 표시한다.
  const insStatus = pay.days && pay.healthPension ? STATUS.ESTIMATED : statusOf(rules.weekly15h.ratesVerification);
  const insReason = pay.days && pay.healthPension ? '한 달이 안 되는 일은 국민연금·건강보험 가입 대상이 아닐 수 있음' : '요율을 2차 자료로 넣음';
  if (pay.insurance) parts.push({ label: '4대보험 근로자 부담분', amount: -pay.insurance, status: insStatus, reason: reasonIf(insStatus, insReason) });
  if (pay.withholding) parts.push({ label: '3.3% 원천징수', amount: -pay.withholding, status: statusOf(rules.businessWithholding.verification), reason: '미리 내는 세금이며 다음 해 5월 종합소득세 신고로 정산됨' });
  if (allowanceLoss) parts.push({ label: allowance.ended ? '구직촉진수당 종료' : '구직촉진수당 감소', amount: -allowanceLoss, status: allowance.status, reason: reasonIf(allowance.status, '수급 확정 전이거나 소득 종류를 몰라 참고로 계산함') });
  const sum = (list) => list.reduce((a, b) => a + b.amount, 0);
  const confirmedNet = sum(parts.filter((x) => x.status === STATUS.CONFIRMED));
  const estimatedParts = parts.filter((x) => x.status !== STATUS.CONFIRMED);
  const checks = cards.flatMap((c) => (c.checks || []).map((text) => ({ cardId: c.id, title: c.title, text })));
  // 달마다 늘어나는 돈. 수당이 끝나는 달을 기준으로 구간을 나눈다.
  const endMonth = allowance ? allowance.endMonth : null;
  const months = [];
  for (let m = timeline.start; m <= timeline.end; m++) {
    const active = Boolean(allowance) && (!endMonth || m <= endMonth);
    const loss = active ? allowanceLoss : 0;
    months.push({ month: m, gross: pay.gross, deductions: pay.insurance + pay.withholding, allowanceLoss: loss, allowancePaid: active ? allowance.paid : null, net: pay.takeHome - loss });
  }
  const periods = [];
  for (const row of months) {
    const last = periods[periods.length - 1];
    if (last && last.net === row.net && last.allowanceLoss === row.allowanceLoss && (last.allowancePaid === null) === (row.allowancePaid === null)) last.to = row.month;
    else periods.push({ from: row.month, to: row.month, net: row.net, allowanceLoss: row.allowanceLoss, allowancePaid: row.allowancePaid, gross: row.gross, deductions: row.deductions });
  }
  const reports = [];
  if (allowance && !allowance.beforeStart && pay.gross > 0) reports.push(allowance.ended ? '구직촉진수당: 취업 사실을 고용센터에 신고' : '구직촉진수당: 수당을 신청할 때마다 번 돈을 신고');
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
      months,
      periods,
      periodNet: months.reduce((a, b) => a + b.net, 0),
      // 일수로 넣은 일이면 위 금액은 한 달이 아니라 그 기간 동안의 돈이다.
      days: pay.days,
    },
  };
}

/**
 * 사용자가 가능한 범위 안에서 주당 근무시간을 바꿔 가며 계산해, 비교할 기준을 만든다.
 * 추천 순위가 아니라 비교 기준이다: 받은 제안, 내가 가능한 최대 시간, 그 사이에서 무언가 바뀌는 지점.
 * AI 에이전트가 이 함수를 도구로 호출한다. 계산 자체는 전부 evaluate가 한다.
 * maxHours는 사용자가 답한 "주당 가능한 최대 시간"이다.
 */
export function searchAlternatives(job, profile, rules, { minHours = 1, maxHours = 40 } = {}) {
  const top = Math.max(minHours, Math.min(52, Math.round(maxHours)));
  const table = [];
  for (let h = minHours; h <= top; h++) {
    const r = evaluate({ ...job, weeklyHours: h }, profile, rules);
    const allowance = r.cards.find((c) => c.id === 'jobSeekerAllowance');
    table.push({
      weeklyHours: h, gross: r.pay.gross, takeHome: r.pay.takeHome, allowanceLoss: r.summary.allowanceLoss, net: r.summary.net,
      confirmedNet: r.summary.confirmedNet, over15: r.pay.over15, holidayIncluded: r.pay.holidayIncluded,
      allowancePaid: allowance ? allowance.paid : null, allowanceEnded: Boolean(allowance && allowance.ended),
      insuranceBoundary: r.pay.insuranceBoundary, allowanceStatus: allowance ? allowance.status : null,
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
  // 받은 제안. 가능한 범위를 넘으면 비교에서 빠진다.
  push('original', '받은 제안 그대로', at(offered));
  push('max', '내가 가능한 최대 시간', at(top));

  // 변화 지점: 한 시간 늘렸을 때 무언가 바뀌는 근무시간을 모두 찾는다.
  const titleOf = (id) => rules[id].title;
  const changePoints = [];
  for (let i = 1; i < table.length; i++) {
    const prev = table[i - 1];
    const cur = table[i];
    const changes = [];
    if (!prev.over15 && cur.over15) changes.push({ type: cur.holidayIncluded ? 'note' : 'gain', text: cur.holidayIncluded ? '4대보험 가입 대상이 됨' : '주휴수당이 생기고 4대보험 가입 대상이 됨' });
    const mark = cur.allowanceStatus && cur.allowanceStatus !== STATUS.CONFIRMED ? ` (${cur.allowanceStatus})` : '';
    if (!prev.insuranceBoundary && cur.insuranceBoundary) changes.push({ type: 'pending', text: '한 달 60시간 근처라 4대보험 가입 대상인지 확인이 필요해짐' });
    if (prev.allowanceLoss === 0 && cur.allowanceLoss > 0) changes.push({ type: 'loss', text: `구직촉진수당이 줄기 시작함${mark}` });
    if (prev.allowancePaid > 0 && cur.allowancePaid === 0 && !cur.allowanceEnded) changes.push({ type: 'loss', text: `구직촉진수당이 지급되지 않음${mark}` });
    if (!prev.allowanceEnded && cur.allowanceEnded) changes.push({ type: 'loss', text: '취업으로 보아 구직촉진수당 지급이 끝남' });
    for (const id of cur.adverseIds) {
      if (id !== 'jobSeekerAllowance' && !prev.adverseIds.includes(id)) changes.push({ type: 'check', text: `${titleOf(id)}: 연간 기준에 닿음` });
    }
    for (const id of cur.pendingIds) {
      if (!prev.pendingIds.includes(id)) changes.push({ type: 'pending', text: `${titleOf(id)}: 추가 확인이 필요해짐` });
    }
    if (cur.checkCount > prev.checkCount && !changes.some((c) => c.type === 'pending')) changes.push({ type: 'pending', text: '추가 확인 항목이 생김' });
    // 경계 구간을 벗어나 확인 항목이 줄어든 것은 변화로 세지 않는다.
    if (changes.length) changePoints.push({ weeklyHours: cur.weeklyHours, beforeHours: prev.weeklyHours, beforeNet: prev.net, net: cur.net, gross: cur.gross, allowanceLoss: cur.allowanceLoss, changes });
  }

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

  return {
    options,
    changePoints,
    table,
    dip,
    offered,
    offeredOutOfRange: !at(offered),
    trace: { variable: '주당 근무시간', from: minHours, to: top, evaluated: table.length },
  };
}

// ---------------- 고용주에게 보낼 문구 ----------------

export const REQUEST_ACTIONS = {
  expand: '근무 확대 요청',
  adjust: '일정·시간 조정 요청',
  terms: '급여 조건 확인',
  accept: '그대로 수락하며 확인',
};

// 신고를 피하는 것으로 읽힐 수 있는 표현. 문구에 들어가면 안 된다.
export const FORBIDDEN_PHRASES = ['신고 안', '신고하지 않', '현금으로', '계약서 없이', '몰래', '소득이 잡히지', '수당 때문', '지원금 때문', '수급 때문'];

export function forbiddenIn(text) {
  return FORBIDDEN_PHRASES.filter((p) => text.includes(p));
}

/**
 * 사용자가 고른 행동에 맞춰 문구를 조합한다: [행동 문장] + [그 제안의 확인 질문] + [시작일·기간 확인].
 * 지원 기준은 이유로 쓰지 않는다. 시간과 숫자는 받은 값 그대로 넣는다.
 */
export function buildRequestMessage(action, { offeredHours, targetHours, questions = [] }) {
  const lines = ['안녕하세요.'];
  if (action === 'expand') lines.push(`제안해 주신 주 ${offeredHours}시간보다 더 일할 수 있습니다. 주 ${targetHours}시간 정도로 늘릴 수 있을까요?`);
  else if (action === 'adjust') lines.push(`제 사정상 주 ${offeredHours}시간은 어려워서, 주 ${targetHours}시간으로 조정할 수 있을까요?`);
  else if (action === 'terms') lines.push('시작하기 전에 급여 조건을 확인하고 싶습니다.');
  else lines.push(`제안해 주신 주 ${offeredHours}시간 조건으로 일하고 싶습니다. 시작 전에 몇 가지만 확인 부탁드립니다.`);
  for (const q of questions) lines.push(`- ${q}`);
  if (!questions.some((q) => q.includes('언제부터'))) lines.push('근무 시작일과 기간도 알려 주시면 감사하겠습니다.');
  lines.push('감사합니다.');
  return lines.join('\n');
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
      netPerHour: Math.round(r.summary.net / r.pay.monthlyHours),
      workedMonths,
      days: r.pay.days,
      uncountedMonths: r.timeline.uncountedMonths,
      periodNet: r.summary.periodNet,
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
