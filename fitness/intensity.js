/**
 * RPE скала и детерминистична адаптация на натоварването (0 AI заявки).
 */

export const RPE_DEFINITIONS = {
  10: { label: 'Максимум', tip: 'Не можеш да направиш и едно повторение повече.' },
  9: { label: 'Много трудно', tip: 'Можеш само още 1 повторение правилно изпълнено.' },
  8: { label: 'Трудно', tip: 'Можеш още около 2 повторения.' },
  7: { label: 'Умерено трудно', tip: 'Можеш още 3 повторения.' },
  6: { label: 'Леко', tip: 'Тежестта се движи бързо. Можеш да продължиш още 4 повторения.' },
  5: { label: 'Загрявка', tip: 'Усеща се леко. Можеш още 5 повторения.' },
};

const RPE_LOW = { label: 'Много леко', tip: 'Незначителна трудност.' };

export function parseRpeValues(rpeStr) {
  const nums = String(rpeStr || '').match(/\d+(?:\.\d+)?/g);
  if (!nums?.length) return null;
  return nums.map((n) => Math.round(Number(n)));
}

function formatRpeRange(low, high) {
  return low === high ? String(low) : `${low}–${high}`;
}

function clampRpe(n) {
  return Math.max(1, Math.min(10, n));
}

function rpeDefinition(n) {
  return n <= 4 ? RPE_LOW : RPE_DEFINITIONS[n];
}

export function adjustRpeBySteps(rpeStr, delta) {
  const nums = parseRpeValues(rpeStr);
  if (!nums) return rpeStr;
  if (nums.length === 1) return String(clampRpe(nums[0] + delta));
  const low = clampRpe(nums[0] + delta);
  const high = clampRpe(nums[nums.length - 1] + delta);
  return formatRpeRange(Math.min(low, high), Math.max(low, high));
}

export function rpeInfoForValue(rpeStr) {
  const nums = parseRpeValues(rpeStr);
  if (!nums) return null;

  const low = Math.min(...nums);
  const high = Math.max(...nums);
  const levels = [];
  for (let n = low; n <= high; n += 1) levels.push(n);

  const lines = levels.map((n) => {
    const def = rpeDefinition(n);
    return `RPE ${n} – ${def.label}: ${def.tip}`;
  });

  return {
    title: levels.length === 1 ? `RPE ${levels[0]}` : `RPE ${formatRpeRange(low, high)}`,
    text: lines.join(' '),
  };
}

export function effortLabelFromRpe(rpeStr) {
  const nums = parseRpeValues(rpeStr);
  if (!nums) return null;
  const avg = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  return rpeDefinition(clampRpe(avg)).label;
}

function dayKind(day = {}) {
  const type = String(day.type || 'strength').toLowerCase();
  if (type === 'strength') return 'anaerobic';
  if (type === 'hiit') return 'interval';
  if (type === 'cardio') return 'metabolic';
  return 'other';
}

/**
 * level: -1 = Лесно, 0 = Стандарт, 1 = Трудно
 */
export function applyIntensity(ex, level, day = {}) {
  if (!level) return { ...ex, intensityNote: '' };

  const kind = dayKind(day);
  const result = { ...ex };
  const notes = [];

  if (level < 0) {
    if (ex.rpe) {
      result.rpe = adjustRpeBySteps(ex.rpe, -1);
      notes.push(`намали тежестта/интензитета до RPE ${result.rpe}`);
    }
    if (kind === 'metabolic' || kind === 'interval') {
      result.restSeconds = Math.min(240, ex.restSeconds + 20);
      notes.push(`удължи почивката до ${result.restSeconds} сек`);
    }
    return {
      ...result,
      intensityNote: `Лесно: ${notes.join('; ')}. Фокус върху чиста техника.`,
    };
  }

  if (kind === 'anaerobic') {
    if (ex.rpe) {
      result.rpe = adjustRpeBySteps(ex.rpe, 1);
      notes.push(`увеличи тежестта до RPE ${result.rpe}`);
    }
    if (ex.sets < 8) {
      result.sets = ex.sets + 1;
      notes.push('добави 1 серия');
    }
    return {
      ...result,
      intensityNote: `Трудно: ${notes.join('; ')}. Запази пълната почивка между сериите (${ex.restSeconds} сек) — при по-тежки тежести не я съкращавай.`,
    };
  }

  if (kind === 'metabolic') {
    result.restSeconds = Math.max(30, ex.restSeconds - 15);
    notes.push(`съкрати почивката до ${result.restSeconds} сек`);
    return {
      ...result,
      intensityNote: `Трудно: ${notes.join('; ')}. Задръж същия темп/RPE — повече работа в по-малко време.`,
    };
  }

  if (kind === 'interval') {
    if (ex.rpe) {
      result.rpe = adjustRpeBySteps(ex.rpe, 1);
      notes.push(`вдигни интензитета до RPE ${result.rpe}`);
    }
    return {
      ...result,
      intensityNote: `Трудно: ${notes.join('; ')}. Не съкращавай почивката между интервалите.`,
    };
  }

  if (ex.rpe) {
    result.rpe = adjustRpeBySteps(ex.rpe, 1);
    notes.push(`RPE ${result.rpe}`);
  }
  return {
    ...result,
    intensityNote: `Трудно: ${notes.join('; ')}.`,
  };
}
