/** Персоните за бета-теста: различни цели, здраве, психология и ритъм. Отговорите са по id на въпроса. */
export const PERSONAS = [
  { key: 'maria_hashimoto', label: 'Мария, 38 — Хашимото, лекарства, глад за сладко, не закусва', answers: {
    name: 'Мария Бета', gender: 'Жена', age: '38', height: '165', weight: '82', email: 'maria.beta@example.test',
    healthConditions: ['Щитовидна жлеза (Хашимото и др.)'], goal: ['Отслабване'], lossKg: '12',
    medications: 'Да', medicationsDetails: 'Левотироксин 50 мкг сутрин', foodCravings: ['Сладко'], eatingHabits: ['Не закусвам', 'Хапвам сладко между храненията'],
    overeatingFrequency: 'Често', stressLevel: 'Високо', dietHistory: 'Да', sportActivity: 'Ниска (1–2 дни седмично)', chronotype: 'Вечерен' } },
  { key: 'ivan_diabetes', label: 'Иван, 45 — диабет/ИР, яде навън, нисък спорт', answers: {
    name: 'Иван Бета', gender: 'Мъж', age: '45', height: '180', weight: '104', email: 'ivan.beta@example.test',
    healthConditions: ['Диабет / Инсулинова резистентност'], goal: ['Отслабване'], lossKg: '18', medications: 'Не',
    eatingHabits: ['Поръчвам храна или ям навън', 'Храня се предимно вечер'], foodCravings: ['Тестени храни', 'Бургери / дюнери'],
    sportActivity: 'Никаква (0 дни седмично)', dailyActivityLevel: 'Ниско' } },
  { key: 'elena_vegetarian', label: 'Елена, 29 — вегетарианка, стягане, тренира', answers: {
    name: 'Елена Бета', gender: 'Жена', age: '29', height: '170', weight: '63', email: 'elena.beta@example.test',
    healthConditions: ['Нямам'], goal: ['Стягане и оформяне на тялото'], dietPreference: ['Вегетарианска'], medications: 'Не',
    sportActivity: 'Средна (2–4 дни седмично)', foodCravings: ['Не изпитвам такава'], eatingHabits: ['Нито една'] } },
  { key: 'georgi_athlete', label: 'Георги, 24 — висока активност, високопротеинова', answers: {
    name: 'Георги Бета', gender: 'Мъж', age: '24', height: '183', weight: '78', email: 'georgi.beta@example.test',
    healthConditions: ['Нямам'], goal: ['Стягане и оформяне на тялото'], dietPreference: ['Високопротеинова'], medications: 'Не',
    sportActivity: 'Висока (5–7 дни седмично)', dailyActivityLevel: 'Високо', chronotype: 'Сутрешен' } },
  { key: 'anna_menopause', label: 'Анна, 62 — менопауза, сърдечно-съдово', answers: {
    name: 'Анна Бета', gender: 'Жена', age: '62', height: '160', weight: '74', email: 'anna.beta@example.test',
    healthConditions: ['Сърдечно-съдови заболявания', 'Менопауза'], goal: ['Подобряване на здравето'], medications: 'Да', medicationsDetails: 'Бизопролол 5 мг',
    sportActivity: 'Ниска (1–2 дни седмично)', sleepHours: '5–6' } },
  { key: 'petar_stress', label: 'Петър, 35 — стрес, преяждане вечер, без ограничения', answers: {
    name: 'Петър Бета', gender: 'Мъж', age: '35', height: '176', weight: '92', email: 'petar.beta@example.test',
    healthConditions: ['Нямам'], goal: ['Отслабване'], lossKg: '10', dietPreference: ['Нямам предпочитания'], medications: 'Не',
    stressLevel: 'Високо', overeatingFrequency: 'Постоянно', eatingHabits: ['Хапвам пред телевизора', 'Храня се предимно вечер'], chronotype: 'Вечерен' } },
];

const NONE = ['Нямам', 'Нито една', 'Не изпитвам такава', 'Нямам предпочитания', 'Не'];

/** Отговорът на персоната или разумен избор по подразбиране. */
export function answerFor(persona, q) {
  const v = persona.answers[q.id];
  const opts = q.options || [];
  if (q.type === 'radio') {
    if (v && opts.includes(v)) return v;
    return opts.find((o) => o === 'Не') || opts.find((o) => /^Средн|Неутрал|^Понякога|^7–8|1\.5–2/.test(o)) || opts[Math.floor((opts.length - 1) / 2)];
  }
  if (q.type === 'checkbox') {
    if (Array.isArray(v)) { const ok = v.filter((x) => opts.includes(x)); if (ok.length) return ok; }
    const none = opts.find((o) => NONE.includes(o));
    return [none || opts[0]];
  }
  if (q.type === 'number') return v || ({ lossKg: '5', waistCircumference: '90' })[q.id] || '5';
  if (v != null) return String(v);
  return q.type === 'textarea' ? '' : 'Няма';
}
