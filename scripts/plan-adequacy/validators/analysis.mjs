import {
  KEY_PROBLEM_SEVERITY_RANGES,
  MIN_HEALTH_SCORE,
  MAX_HEALTH_SCORE,
} from '../constants.mjs';
import { minFatGrams, minCaloriesForGender } from '../fixtures/profiles.mjs';

function num(v) {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const m = v.match(/\d+/);
    return m ? parseInt(m[0], 10) : NaN;
  }
  return NaN;
}

export function validateAnalysis(analysis, profile = {}) {
  const issues = [];
  if (!analysis) return ['analysis липсва'];

  const fc = num(analysis.Final_Calories) || num(analysis.correctedMetabolism?.realTDEE);
  if (!fc || fc < 800 || fc > 5000) issues.push(`Final_Calories нереалистични: ${fc}`);

  const minCal = minCaloriesForGender(profile.gender || 'Жена');
  if (fc && fc < minCal) issues.push(`Final_Calories ${fc} под минимум ${minCal}`);

  const ratios = analysis.macroRatios;
  const grams = analysis.macroGrams;
  if (!ratios || !grams) {
    issues.push('липсват macroRatios или macroGrams');
  } else {
    const rp = num(ratios.protein);
    const rc = num(ratios.carbs);
    const rf = num(ratios.fats);
    const sum = rp + rc + rf;
    if (Math.abs(sum - 100) > 3) issues.push(`macroRatios не сумират ~100: ${sum}`);

    const pg = num(grams.protein);
    const cg = num(grams.carbs);
    const fg = num(grams.fats);
    const macroKcal = pg * 4 + cg * 4 + fg * 9;
    if (fc && Math.abs(macroKcal - fc) > 25) {
      issues.push(`macroGrams (${macroKcal} kcal) не съответстват на Final_Calories (${fc})`);
    }

    const minFat = minFatGrams(profile.weight || 70);
    if (fg < minFat) issues.push(`fats_g ${fg}g под минимум ${minFat}g`);

    if (typeof ratios.protein === 'string' || typeof grams.protein === 'string') {
      issues.push('macro стойности са string вместо число');
    }
  }

  const hs = analysis.currentHealthStatus;
  if (!hs || typeof hs.score !== 'number') {
    issues.push('currentHealthStatus.score липсва');
  } else {
    if (hs.score < MIN_HEALTH_SCORE || hs.score > MAX_HEALTH_SCORE) {
      issues.push(`health score извън ${MIN_HEALTH_SCORE}-${MAX_HEALTH_SCORE}: ${hs.score}`);
    }
    if (!hs.description || hs.description.length < 40) {
      issues.push('currentHealthStatus.description твърде кратко/липсва');
    }
    if (hs.score < 35 && !/подобр|внимание|риск|слаб/i.test(hs.description)) {
      issues.push('description не отразява ниския health score');
    }
    if (!Array.isArray(hs.keyIssues) || hs.keyIssues.length < 1) {
      issues.push('currentHealthStatus.keyIssues липсват');
    }
  }

  const problems = analysis.keyProblems;
  if (!Array.isArray(problems) || problems.length < 3) {
    issues.push(`keyProblems: очаквани 3–6, има ${problems?.length || 0}`);
  } else {
    for (const p of problems) {
      if (p.severity === 'Normal') issues.push(`keyProblem "${p.title}" с Normal severity`);
      const range = KEY_PROBLEM_SEVERITY_RANGES[p.severity];
      const sv = num(p.severityValue);
      if (range && (sv < range[0] || sv > range[1])) {
        issues.push(`"${p.title}": severityValue ${sv} извън ${p.severity} (${range.join('-')})`);
      }
      if (!p.impact || !p.description) issues.push(`keyProblem "${p.title}" липсва description/impact`);
    }
  }

  return issues;
}
