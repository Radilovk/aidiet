import { normalizeText } from './normalize.js';

function line(label, value) {
  return value ? `${label}: ${value}` : '';
}

/** Компактен текстов профил от структурирани answers (въпросник / админ бланка). */
export function buildProfileSummary(a) {
  const parts = [];
  parts.push(`${a.gender || '?'}, ${a.age || '?'} г., ${a.heightCm || '?'} см, ${a.weightKg || '?'} кг`);

  const health = [...(a.health || []), ...(a.healthFemale || [])].filter((h) => !normalizeText(h).includes('няма'));
  if (a.healthMeds) health.push(`медикаменти: ${a.healthMeds}`);
  if (a.healthOther) health.push(a.healthOther);
  parts.push(line('Здраве', health.join('; ') || 'без установени заболявания'));

  if (a.breastImplants?.implants) {
    const months = a.breastImplants.implantMonths ? `, ${a.breastImplants.implantMonths} мес. след операция` : '';
    parts.push(line('Гръдни импланти', `${a.breastImplants.implants}${months}`));
  }

  const limits = (a.limitations || []).filter((l) => !normalizeText(l).includes('нямам'));
  parts.push(line('Опорно-двигателни ограничения (ЗАДЪЛЖИТЕЛНО СЪОБРАЗИ)', limits.join('; ')));

  if (a.weightChange && a.weightChange.type && a.weightChange.type !== 'stable') {
    const dir = a.weightChange.type === 'gain' ? 'качил(а)' : 'свалил(а)';
    parts.push(`Тегло последните 6 мес: ${dir} ${a.weightChange.amountKg || '?'} кг (${a.weightChange.reason || 'без посочена причина'})`);
  }

  parts.push(line('Сън', a.sleep));
  parts.push(line('Стрес (1-10)', a.stress));
  parts.push(line('Дневна активност', a.dailyActivity));
  if (a.sportActivity) {
    parts.push(line('Спортна активност', a.sportActivity.status + (a.sportActivity.current ? ` — ${a.sportActivity.current}` : '')));
  }
  parts.push(line('Тренировъчен опит', a.experience));
  if (a.nutrition) {
    parts.push(line('Хранене', `${a.nutrition.type || '?'}${a.nutrition.custom ? ` (${a.nutrition.custom})` : ''}, ${a.nutrition.mealsPerDay || '?'} хранения/ден`));
  }
  if (a.goal) {
    const goalMain = normalizeText(a.goal.main);
    const goalText = goalMain === 'друго' ? a.goal.other : a.goal.main;
    parts.push(line('ЦЕЛ', `${goalText || '?'}${a.goal.deadline ? `, срок: ${a.goal.deadline}` : ', без краен срок'}`));
  }
  parts.push(line('Оборудване', [...(a.equipment || []), a.equipmentOther].filter(Boolean).join(', ')));
  if (a.preferences) {
    const p = a.preferences;
    parts.push(line('Предпочитания', [
      (p.types || []).join('/'),
      p.freq ? `${p.freq} трен./седм.` : '',
      p.duration || '',
      p.timeOfDay ? `време: ${p.timeOfDay}` : '',
    ].filter(Boolean).join(', ')));
    parts.push(line('НЕ ЖЕЛАЕ движения', p.avoid));
  }
  parts.push(line('Допълнително от клиента', a.extraInfo));

  return parts.filter(Boolean).join('\n');
}
