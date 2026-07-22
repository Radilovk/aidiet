import { minFatGrams } from './profiles.mjs';

/** Realistic analysis fixture (based on production-like output) */
export function buildGoldenAnalysis(profile) {
  const weight = parseFloat(profile.weight) || 70;
  const tdee = profile.gender === 'Мъж' ? 2200 : 1900;
  const finalCalories = profile.goal === 'Мускулна маса' ? tdee + 300 : Math.round(tdee * 0.8);
  const minFat = minFatGrams(weight);
  const ratios = profile.goal === 'Мускулна маса'
    ? { protein: 30, carbs: 45, fats: 25 }
    : { protein: 30, carbs: 35, fats: 35 };
  const proteinG = Math.round(finalCalories * ratios.protein / 100 / 4);
  let fatsG = Math.round(finalCalories * ratios.fats / 100 / 9);
  if (fatsG < minFat) fatsG = minFat;
  const carbsG = Math.round((finalCalories - proteinG * 4 - fatsG * 9) / 4);
  const honestHealth = profile.stressLevel?.includes('Много') ? 58 : 68;
  const healthScore = Math.round(honestHealth * 0.9);

  return {
    bmi: Math.round((weight / ((parseFloat(profile.height) / 100) ** 2)) * 10) / 10,
    bmiCategory: 'Наднормено',
    bmr: profile.gender === 'Мъж' ? 1750 : 1450,
    tdee,
    Final_Calories: finalCalories,
    macroRatios: ratios,
    macroGrams: { protein: proteinG, carbs: carbsG, fats: fatsG },
    correctedMetabolism: {
      realBMR: profile.gender === 'Мъж' ? 1750 : 1450,
      realTDEE: finalCalories,
      clinicalAdjustmentPercent: 0,
      metabolicAdjustmentPercent: -3,
      goalAdjustmentPercent: -15,
      correction: 'Корекция по проценти спрямо клинични/метаболитни/целеви критерии.',
      correctionPercent: '-18%',
    },
    psychologicalProfile: `Анализ за ${profile.name} с фокус върху ${profile.goal}.`,
    keyProblems: [
      {
        title: 'Недостатъчен сън',
        description: 'Спите под оптималния минимум, което повишава кортизола и затруднява целта.',
        severity: 'Risky',
        severityValue: 72,
        category: 'Sleep',
        impact: 'Забавя отслабването и влияе на енергията.',
      },
      {
        title: 'Стрес',
        description: 'Хроничният стрес насърчава емоционално хранене.',
        severity: 'Borderline',
        severityValue: 55,
        category: 'Stress',
        impact: 'Увеличава риска от преяждане.',
      },
      {
        title: 'Ниска активност',
        description: 'Ограничената физическа активност намалява дневния калориен разход.',
        severity: 'Borderline',
        severityValue: 52,
        category: 'Activity',
        impact: 'Затруднява постигането на дефицит.',
      },
    ],
    currentHealthStatus: {
      score: healthScore,
      description: `Здравният ви профил е ${healthScore}% — има области за подобрение (сън, стрес), но основата позволява напредък към ${profile.goal.toLowerCase()}.`,
      keyIssues: ['Недостатъчен сън', 'Стрес'],
    },
    successChance: 45,
    healthRisks: ['Метаболитен стрес', 'Емоционално хранене', 'Недостатъчна активност'],
    nutritionalNeeds: ['Повече протеин', 'Повече фибри', 'Редовна хидратация'],
  };
}

export const BAD_ANALYSIS = {
  lowMacros: {
    Final_Calories: 1600,
    macroRatios: { protein: 10, carbs: 80, fats: 10 },
    macroGrams: { protein: 40, carbs: 320, fats: 18 },
    currentHealthStatus: { score: 12, description: 'Общо състояние.', keyIssues: [] },
    keyProblems: [{ title: 'X', severity: 'Risky', severityValue: 25, category: 'Stress', description: 'd', impact: 'i' }],
  },
  genericHealth: {
    Final_Calories: 1500,
    macroRatios: { protein: 30, carbs: 40, fats: 30 },
    macroGrams: { protein: 113, carbs: 150, fats: 50 },
    currentHealthStatus: { score: 22, description: 'Имате нужда от подобрение.', keyIssues: ['проблем'] },
    keyProblems: [{ title: 'Y', severity: 'Critical', severityValue: 30, category: 'Medical', description: 'd', impact: 'i' }],
  },
};
