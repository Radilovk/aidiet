/**
 * KA-TRAINER — клиентска логика.
 *
 * Икономичен дизайн (0 излишни заявки):
 *   - Планът се пази в localStorage → повторно отваряне не вика бекенда.
 *   - Смяна на упражнение → алтернативите са прекомпютнати в плана (0 заявки).
 *   - Олекотяване/утежняване → детерминистични правила тук (0 заявки).
 *   - Чат историята живее в localStorage; към бекенда пътуват само
 *     последните няколко реплики + planId.
 */

import { QUESTIONS, activeQuestions, visibleOptions, validateQuestion, buildAnswers } from './questions.js';
import { localizeExerciseDisplayName, localizeEquipment, localizeTarget, sanitizeBgText } from './exercise-labels-bg.js';
import { registerServiceWorker } from './common.js';
import { bindPwaInstallCard } from './pwa-install.js';
import { applyIntensity, effortLabelFromRpe, rpeInfoForValue } from './intensity.js';
import { createWizardController, el } from './wizard-ui.js';

// ============================================================
// Конфигурация и локално хранилище
// ============================================================

const DEFAULT_WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
const FALLBACK_WORKER_URL = 'https://aidiet-fitness.radilov-k.workers.dev';

const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`fitplan.${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`fitplan.${key}`, JSON.stringify(value)); } catch { /* quota */ }
  },
  remove(key) {
    try { localStorage.removeItem(`fitplan.${key}`); } catch { /* noop */ }
  },
};

function workerUrl() {
  const param = new URLSearchParams(location.search).get('api');
  if (param) store.set('workerUrl', param.replace(/\/+$/, ''));
  return store.get('workerUrl') || DEFAULT_WORKER_URL;
}

/**
 * API fetch с автоматичен fallback между основния NutriPlan worker и
 * отделния KA-TRAINER worker.
 *
 * ВАЖНО за икономичността: преминаваме към резервния worker САМО при
 * мрежова грешка или 404/405 (маршрутът не е монтиран там). Всеки друг
 * отговор (429 rate limit, 400 валидация, 502 AI грешка) е реален отговор
 * от бекенда — повторното изпращане към втория worker би дублирало AI
 * заявки и разходи.
 */
async function apiFetch(path, options = {}) {
  const primary = workerUrl();
  const secondary = primary === DEFAULT_WORKER_URL ? FALLBACK_WORKER_URL : DEFAULT_WORKER_URL;
  const bases = primary === secondary ? [primary] : [primary, secondary];

  let lastError;
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    try {
      const res = await fetch(`${base}${path}`, options);
      const routeMissing = res.status === 404 || res.status === 405;
      if (routeMissing && i < bases.length - 1) continue;
      return res;
    } catch (e) {
      lastError = e;
      if (e.name === 'AbortError') throw e; // потребителски timeout — не опитвай втори бекенд
      if (i < bases.length - 1) continue;
      throw e;
    }
  }
  throw lastError || new Error('Сървърът не е достъпен');
}

// ============================================================
// Състояние
// ============================================================

let wizardState = store.get('wizard', {});
let planRecord = store.get('plan', null);      // { planId, plan, coachContext, createdAt }
let swaps = store.get('swaps', {});            // { "day-ex": altIndex } ; -1 = оригинал
let intensity = store.get('intensity', 0);     // -1 | 0 | 1
let chatHistory = store.get('chat', []);       // [{role, text}]
let activeDay = 0;
let openAltPanel = null;                       // "day-ex" на отворен панел с алтернативи

// ============================================================
// DOM помощни
// ============================================================

const $ = (id) => document.getElementById(id);

const wizard = createWizardController({
  getEl: $,
  questions: QUESTIONS,
  getQuestions: () => activeQuestions(wizardState),
  visibleOptions,
  validateQuestion,
  getState: () => wizardState,
  onPersist: saveWizard,
  onComplete: generatePlan,
  finalButtonText: 'Създай плана ⚡',
});

const renderStep = () => wizard.renderStep();
const nextStep = () => { if (wizard.nextStep()) armBackSentinel(); };
const prevStep = () => wizard.prevStep();

const METRIC_INFO = {
  tempo: {
    title: 'Темпо',
    text: 'Формат долу–пауза–горе (напр. 2-0-2): секунди за долната фаза, пауза долу, секунди за горната. Бавният контрол намалява риска от контузия.',
  },
};

let openMetricTip = null;

function closeMetricTip() {
  if (openMetricTip) {
    openMetricTip.remove();
    openMetricTip = null;
  }
}

function renderMetricChip(label, infoOrKey, extraClass = '') {
  const info = typeof infoOrKey === 'object' && infoOrKey
    ? infoOrKey
    : METRIC_INFO[infoOrKey];
  const chip = el('span', { class: `ex-chip ex-chip-metric${extraClass ? ` ${extraClass}` : ''}` }, label);
  if (info) {
    const btn = el('button', {
      type: 'button',
      class: 'ex-chip-info',
      'aria-label': `Информация: ${info.title}`,
      onclick: (e) => {
        e.stopPropagation();
        const existing = chip.querySelector('.ex-chip-tip');
        if (existing) {
          existing.remove();
          if (openMetricTip === existing) openMetricTip = null;
          return;
        }
        closeMetricTip();
        const tip = el('div', { class: 'ex-chip-tip', role: 'tooltip' },
          el('strong', { text: info.title }),
          el('p', { text: info.text }),
        );
        chip.append(tip);
        openMetricTip = tip;
      },
    }, 'i');
    chip.append(btn);
  }
  return chip;
}

const VIEWS = ['home', 'wizard', 'loading', 'plan', 'error'];

function hasCachedPlan() {
  return Boolean(planRecord?.plan?.days?.length);
}

function formatPlanDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return ''; }
}

function wizardHasProgress() {
  return Object.keys(wizardState || {}).length > 0;
}

let refreshPwaInstall = null;

function renderHome() {
  const hasPlan = hasCachedPlan();
  const card = $('homePlanCard');
  card.classList.toggle('hidden', !hasPlan);
  $('btnMyProgram').classList.toggle('hidden', !hasPlan);

  if (hasPlan) {
    $('homePlanTitle').textContent = planRecord.plan.title || 'Твоят седмичен план';
    const date = formatPlanDate(planRecord.createdAt);
    $('homePlanMeta').textContent = date ? `Създаден на ${date}` : 'Запазена на това устройство';
  }

  const draft = wizardHasProgress() && !hasPlan;
  $('btnContinueWizard').classList.toggle('hidden', !draft);
  $('btnStartWizard').textContent = hasPlan ? 'Създай нов план' : 'Започни въпросника';
  updateGeneratingUi();
  void refreshPwaInstall?.();
}

function openCachedProgram() {
  if (!hasCachedPlan()) {
    renderHome();
    showView('home');
    return;
  }
  void openCachedProgramAsync();
}

async function openCachedProgramAsync() {
  activeDay = firstTrainingDay(planRecord.plan);
  const refreshed = await refreshPlanExerciseMedia(planRecord.plan);
  if (refreshed && refreshed !== planRecord.plan) {
    planRecord = { ...planRecord, plan: refreshed };
    store.set('plan', planRecord);
  }
  renderPlan();
  showView('plan');
}

async function refreshPlanExerciseMedia(plan) {
  try {
    const res = await apiFetch('/api/plan/refresh-exercises', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && data.plan) return data.plan;
  } catch {
    /* офлайн — показваме кеширания план */
  }
  return plan;
}

function showView(name) {
  const prev = document.body.dataset.view;
  for (const v of VIEWS) $(`view-${v}`).classList.toggle('hidden', v !== name);
  $('btnNewPlan').classList.toggle('hidden', name !== 'plan');
  $('btnMyProgram').classList.toggle('hidden', !hasCachedPlan() || name === 'plan');
  $('chatFab').classList.toggle('hidden', name !== 'plan');
  if (name !== 'plan') closeChat();
  if (prev === 'loading' && name !== 'loading') stopLoadingMessages();
  if (name === 'loading' && planGenerationJob) startLoadingMessages();
  updateGeneratingUi();
  document.body.dataset.view = name;
  // App-like: навигация напред (след първоначалното зареждане) активира
  // back-sentinel-а, за да работи системният бутон "назад".
  if (prev && prev !== name && name !== 'home') armBackSentinel();
  window.scrollTo(0, 0);
}

// ============================================================
// App-like навигация: системният "назад" (Android бутон/жест, iOS swipe)
// затваря наслагвания и връща предишния екран, вместо да изхвърля
// потребителя от приложението.
//
// Модел "single sentinel": в историята стои най-много ЕДИН наш запис.
// Всяко натискане на "назад" го консумира, отвива едно ниво вътрешно
// състояние (lightbox → чат → стъпка на въпросника → екран → начало)
// и записът се зарежда отново само ако има още нива. Така никога не
// трупаме записи и потребителят винаги може да излезе от приложението.
// ============================================================

let sentinelArmed = false;
let popNavigating = false; // true, докато обработваме popstate

function armBackSentinel() {
  if (sentinelArmed || popNavigating) return;
  try {
    history.pushState({ fitplan: true }, '');
    sentinelArmed = true;
  } catch { /* напр. sandbox iframe */ }
}

function hasInternalBackState() {
  if (!$('lightbox').classList.contains('hidden')) return true;
  if (!$('chatPanel').classList.contains('hidden')) return true;
  const view = document.body.dataset.view;
  if (view === 'wizard' && wizard.getStepIndex() > 0) return true;
  return Boolean(view && view !== 'home');
}

function handlePopState() {
  sentinelArmed = false;
  popNavigating = true;
  try {
    if (!$('lightbox').classList.contains('hidden')) {
      closeLightbox();
    } else if (!$('chatPanel').classList.contains('hidden')) {
      closeChat();
    } else {
      const view = document.body.dataset.view;
      if (view === 'wizard' && wizard.getStepIndex() > 0) {
        wizard.setStepIndex(wizard.getStepIndex() - 1);
        wizard.renderStep();
      } else if (view && view !== 'home') {
        renderHome();
        showView('home');
      }
      // на начален екран: нищо — следващото "назад" излиза от приложението
    }
  } finally {
    popNavigating = false;
  }
  if (hasInternalBackState()) {
    try {
      history.pushState({ fitplan: true }, '');
      sentinelArmed = true;
    } catch { /* noop */ }
  }
}

// ============================================================
// ВЪПРОСНИК
// ============================================================

function saveWizard() { store.set('wizard', wizardState); }

// ============================================================
// ГЕНЕРАЦИЯ НА ПЛАН (единствената "тежка" AI заявка)
// ============================================================

const LOADING_MESSAGES = [
  'Анализирам профила ти…',
  'Съобразявам здравословния статус и ограниченията…',
  'Подбирам упражнения от база с 1300+ движения…',
  'Структурирам седмичното натоварване…',
  'Добавям загрявки, разпускания и насоки…',
  'Още момент — финални щрихи…',
];
let loadingTimer = null;
let planGenerationJob = null;

function startLoadingMessages() {
  let i = 0;
  const statusEl = $('loadingStatus');
  statusEl.textContent = LOADING_MESSAGES[0];
  loadingTimer = setInterval(() => {
    i = Math.min(i + 1, LOADING_MESSAGES.length - 1);
    statusEl.style.opacity = '0';
    setTimeout(() => { statusEl.textContent = LOADING_MESSAGES[i]; statusEl.style.opacity = '1'; }, 250);
  }, 4000);
}

function stopLoadingMessages() {
  clearInterval(loadingTimer);
  loadingTimer = null;
}

async function runPlanGeneration(answers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150000);

  try {
    const res = await apiFetch('/api/plan/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
      signal: controller.signal,
      keepalive: true,
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.message || `Грешка от сървъра (${res.status})`);
    }

    planRecord = {
      planId: data.planId,
      plan: data.plan,
      coachContext: data.coachContext || '',
      createdAt: new Date().toISOString(),
    };
    swaps = {};
    intensity = 0;
    chatHistory = [];
    activeDay = firstTrainingDay(data.plan);
    store.set('plan', planRecord);
    store.set('swaps', swaps);
    store.set('intensity', intensity);
    store.set('chat', chatHistory);

    renderPlan();
    showView('plan');
    void refreshPwaInstall?.();
  } catch (e) {
    const message = e.name === 'AbortError'
      ? 'Заявката отне твърде дълго. Провери връзката и опитай отново.'
      : e.message;
    $('errorMessage').textContent = message;
    showView('error');
  } finally {
    clearTimeout(timeout);
    stopLoadingMessages();
    store.remove('generating');
    planGenerationJob = null;
    updateGeneratingUi();
  }
}

function updateGeneratingUi() {
  const note = $('homeGeneratingNote');
  if (note) note.classList.toggle('hidden', !planGenerationJob);
}

function generatePlan() {
  if (planGenerationJob) {
    showView('loading');
    return planGenerationJob;
  }

  const answers = buildAnswers(wizardState);
  store.set('generating', { startedAt: Date.now(), answers });
  showView('loading');
  startLoadingMessages();
  armBackSentinel();
  updateGeneratingUi();
  planGenerationJob = runPlanGeneration(answers);
  return planGenerationJob;
}

function resumePendingGeneration() {
  const pending = store.get('generating');
  if (!pending?.answers || planGenerationJob || hasCachedPlan()) return false;
  showView('loading');
  startLoadingMessages();
  updateGeneratingUi();
  planGenerationJob = runPlanGeneration(pending.answers);
  return true;
}

function firstTrainingDay(plan) {
  const idx = (plan.days || []).findIndex((d) => d.type !== 'rest');
  return idx >= 0 ? idx : 0;
}

// ============================================================
// АДАПТАЦИЯ: детерминистични правила (0 заявки към бекенда)
// ============================================================

/** Текущото упражнение за слот, със замяна и ниво на натоварване. */
function effectiveExercise(dayIdx, exIdx) {
  const base = planRecord.plan.days[dayIdx].exercises[exIdx];
  const day = planRecord.plan.days[dayIdx];
  const swapKey = `${dayIdx}-${exIdx}`;
  const altIdx = swaps[swapKey];
  const adjusted = applyIntensity(base, intensity, day);

  if (altIdx !== undefined && altIdx >= 0 && base.alternatives?.[altIdx]) {
    const alt = base.alternatives[altIdx];
    return {
      ...adjusted,
      displayName: alt.displayName || localizeExerciseDisplayName(alt.name, '', alt.equipment),
      canonicalName: alt.name,
      match: alt,
      notes: '', // бележката на оригинала не важи за алтернативата
      tempo: '',
      isSwapped: true,
      originalName: base.displayName,
    };
  }
  return { ...adjusted, isSwapped: false };
}

// ============================================================
// РЕНДЕРИРАНЕ НА ПЛАНА
// ============================================================

const DAY_SHORT = { 0: 'Пон', 1: 'Вто', 2: 'Сря', 3: 'Чет', 4: 'Пет', 5: 'Съб', 6: 'Нед' };
const TYPE_LABELS = {
  strength: 'Силова', cardio: 'Кардио', hiit: 'HIIT',
  mobility: 'Мобилност', rest: 'Почивка', 'active-recovery': 'Активно възст.',
};

function renderPlan() {
  const { plan } = planRecord;

  $('planTitle').textContent = sanitizeBgText(plan.title);
  $('planSummary').textContent = sanitizeBgText(plan.summary);
  $('planSplit').textContent = plan.weeklySplit ? `Структура: ${sanitizeBgText(plan.weeklySplit)}` : '';

  const safety = $('planSafety');
  safety.innerHTML = '';
  if (plan.safetyNotes?.length) {
    safety.append(el('strong', { text: '⚠ Важно за твоята безопасност' }));
    safety.append(el('ul', {}, plan.safetyNotes.map((n) => el('li', { text: n }))));
    safety.classList.remove('hidden');
  } else {
    safety.classList.add('hidden');
  }

  // сегмент за натоварване
  for (const btn of $('intensitySeg').querySelectorAll('button')) {
    btn.classList.toggle('active', Number(btn.dataset.level) === intensity);
  }

  renderDayPills();
  renderDay();
  renderGuidelines();
}

function renderDayPills() {
  const { plan } = planRecord;
  const pills = $('dayPills');
  pills.innerHTML = '';
  plan.days.forEach((d, i) => {
    const pill = el('button', {
      type: 'button',
      class: `day-pill${i === activeDay ? ' active' : ''}${d.type === 'rest' ? ' rest' : ''}`,
      onclick: () => { activeDay = i; openAltPanel = null; renderDayPills(); renderDay(); },
    },
      el('span', { text: DAY_SHORT[i] ?? d.day.slice(0, 3) }),
      el('small', { text: d.type === 'rest' ? 'почивка' : (d.focus || TYPE_LABELS[d.type] || '') }),
    );
    pills.append(pill);
  });
}

function renderDay() {
  const day = planRecord.plan.days[activeDay];
  const wrap = $('dayContent');
  wrap.innerHTML = '';

  const cardEl = el('div', { class: 'day-card' });
  const badges = el('div', { class: 'day-badges' },
    el('span', { class: `badge type-${day.type}`, text: TYPE_LABELS[day.type] || day.type }),
  );
  if (day.durationMin) badges.append(el('span', { class: 'badge', text: `~${day.durationMin} мин` }));

  cardEl.append(el('div', { class: 'day-card-head' }, el('h2', { text: day.day }), badges));
  if (day.focus) cardEl.append(el('p', { class: 'day-focus', text: day.focus }));

  if (day.type === 'rest' || !day.exercises.length) {
    cardEl.append(el('div', { class: 'rest-day' },
      el('span', { class: 'rest-emoji', text: '🌿' }),
      el('p', { text: day.focus || 'Ден за възстановяване. Лека разходка, разтягане и добър сън.' }),
    ));
    wrap.append(cardEl);
    return;
  }

  if (day.warmup?.length) {
    cardEl.append(el('div', { class: 'mini-section' },
      el('h4', { text: '🔥 Загрявка' }),
      el('ol', {}, day.warmup.map((s) => el('li', { text: s }))),
    ));
  }

  const list = el('div', { class: 'ex-list' });
  day.exercises.forEach((_, exIdx) => list.append(renderExerciseCard(activeDay, exIdx)));
  cardEl.append(el('div', { class: 'mini-section' }, el('h4', { text: '🏋 Основна част' }), list));

  if (day.cooldown?.length) {
    cardEl.append(el('div', { class: 'mini-section' },
      el('h4', { text: '🧘 Разпускане' }),
      el('ol', {}, day.cooldown.map((s) => el('li', { text: s }))),
    ));
  }

  wrap.append(cardEl);
}

function exerciseDisplayName(ex) {
  return ex.match?.displayName
    || ex.displayName
    || localizeExerciseDisplayName(ex.canonicalName, ex.displayName, ex.equipmentHint);
}

function renderExerciseCard(dayIdx, exIdx) {
  const ex = effectiveExercise(dayIdx, exIdx);
  const base = planRecord.plan.days[dayIdx].exercises[exIdx];
  const swapKey = `${dayIdx}-${exIdx}`;
  const media = ex.match;
  const displayName = exerciseDisplayName(ex);

  const cardEl = el('div', { class: 'ex-card' });

  // thumbnail (статична снимка; GIF-ът се зарежда чак в lightbox-а — пести трафик)
  if (media?.imageUrl || media?.gifUrl) {
    const img = el('img', {
      class: 'ex-thumb',
      src: media.imageUrl || media.gifUrl,
      alt: displayName,
      loading: 'lazy',
      onclick: () => openLightbox(ex),
      onerror: (e) => { e.target.replaceWith(el('div', { class: 'ex-thumb-placeholder', text: '🏋' })); },
    });
    cardEl.append(img);
  } else {
    cardEl.append(el('div', { class: 'ex-thumb-placeholder', text: '🏋' }));
  }

  const main = el('div', { class: 'ex-main' });
  main.append(el('div', { class: 'ex-name', text: displayName }));
  if (ex.isSwapped) {
    main.append(el('div', { class: 'ex-swapped-tag', text: `⇄ заменено (ориг.: ${ex.originalName})` }));
  }

  const chips = el('div', { class: 'ex-chips' });
  chips.append(el('span', { class: 'ex-chip', html: `<b>${ex.sets}</b> × ${escapeHtml(ex.reps)}` }));
  chips.append(el('span', { class: 'ex-chip', text: `почивка ${ex.restSeconds} сек` }));
  if (ex.rpe) {
    const effort = effortLabelFromRpe(ex.rpe);
    const rpeInfo = rpeInfoForValue(ex.rpe);
    if (effort && rpeInfo) {
      chips.append(renderMetricChip(effort, { title: effort, text: rpeInfo.text }, 'effort-chip'));
    }
    chips.append(renderMetricChip(`RPE ${ex.rpe}`, rpeInfo));
  }
  if (ex.tempo) chips.append(renderMetricChip(`темпо ${ex.tempo}`, 'tempo'));
  main.append(chips);

  if (ex.notes) main.append(el('p', { class: 'ex-notes', text: ex.notes }));
  if (ex.intensityNote) main.append(el('p', { class: 'ex-intensity-note', text: ex.intensityNote }));

  const actions = el('div', { class: 'ex-actions' });
  if (media) {
    actions.append(el('button', { class: 'ex-btn', type: 'button', text: '▶ Демонстрация', onclick: () => openLightbox(ex) }));
  }
  if (base.alternatives?.length) {
    actions.append(el('button', {
      class: 'ex-btn', type: 'button',
      text: openAltPanel === swapKey ? '✕ Скрий алтернативите' : '⇄ Замени',
      onclick: () => { openAltPanel = openAltPanel === swapKey ? null : swapKey; renderDay(); },
    }));
  }
  main.append(actions);
  cardEl.append(main);

  if (openAltPanel === swapKey && base.alternatives?.length) {
    cardEl.append(renderAltPanel(dayIdx, exIdx));
  }
  return cardEl;
}

function renderAltPanel(dayIdx, exIdx) {
  const base = planRecord.plan.days[dayIdx].exercises[exIdx];
  const swapKey = `${dayIdx}-${exIdx}`;
  const current = swaps[swapKey];

  const panel = el('div', { class: 'alt-panel' }, el('h5', { text: 'Избери вариант за същата мускулна група' }));
  const options = el('div', { class: 'alt-options' });

  const makeOption = (label, sub, imgUrl, isCurrent, onPick) => {
    const btn = el('button', { type: 'button', class: `alt-option${isCurrent ? ' current' : ''}`, onclick: onPick });
    if (imgUrl) btn.append(el('img', { src: imgUrl, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }));
    btn.append(el('span', {},
      el('div', { class: 'alt-name', text: label + (isCurrent ? ' ✓' : '') }),
      sub ? el('div', { class: 'alt-eq', text: sub }) : null,
    ));
    return btn;
  };

  options.append(makeOption(
    base.displayName, 'оригинал от плана',
    base.match?.imageUrl, current === undefined || current === -1,
    () => { delete swaps[swapKey]; store.set('swaps', swaps); openAltPanel = null; renderDay(); },
  ));

  base.alternatives.forEach((alt, i) => {
    const label = alt.displayName || localizeExerciseDisplayName(alt.name, '', alt.equipment);
    options.append(makeOption(
      label, alt.equipment ? `оборудване: ${localizeEquipment(alt.equipment)}` : '',
      alt.imageUrl, current === i,
      () => { swaps[swapKey] = i; store.set('swaps', swaps); openAltPanel = null; renderDay(); },
    ));
  });

  panel.append(options);
  return panel;
}

function renderGuidelines() {
  const g = planRecord.plan.guidelines || {};
  const wrap = $('guidelines');
  wrap.innerHTML = '';
  const items = [
    ['📈 Как да прогресираш', g.progression],
    ['😴 Възстановяване', g.recovery],
    ['🍽 Хранене (общи насоки)', g.nutrition],
    ['⚖ Кога да олекотиш или утежниш', sanitizeBgText(g.adaptation)],
  ];
  for (const [title, text] of items) {
    if (!text) continue;
    wrap.append(el('details', { class: 'guide-item' },
      el('summary', { text: title }),
      el('p', { text: sanitizeBgText(text) }),
    ));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// LIGHTBOX (GIF демонстрация)
// ============================================================

function openLightbox(ex) {
  const media = ex.match;
  if (!media) return;
  const displayName = exerciseDisplayName(ex);
  $('lightboxImg').src = media.gifUrl || media.imageUrl;
  $('lightboxImg').alt = displayName;
  $('lightboxTitle').textContent = displayName;
  const meta = [
    media.target && `цел: ${localizeTarget(media.target)}`,
    media.equipment && `оборудване: ${localizeEquipment(media.equipment)}`,
  ].filter(Boolean);
  $('lightboxMeta').textContent = meta.join(' · ');
  $('lightboxInstructions').textContent = media.instructions || '';
  $('lightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  armBackSentinel();
}

function closeLightbox() {
  if ($('lightbox').classList.contains('hidden')) return;
  $('lightbox').classList.add('hidden');
  $('lightboxImg').src = '';
  document.body.style.overflow = '';
}

// ============================================================
// AI ТРЕНЬОР (чат)
// ============================================================

let chatBusy = false;

function openChat() {
  $('chatPanel').classList.remove('hidden');
  $('chatFab').classList.add('hidden');
  renderChat();
  $('chatInput').focus();
  armBackSentinel();
}

function closeChat() {
  const panel = $('chatPanel');
  if (panel.classList.contains('hidden')) return;
  panel.classList.add('hidden');
  if (!$('view-plan').classList.contains('hidden')) $('chatFab').classList.remove('hidden');
}

function resetChat() {
  if (chatBusy) return;
  if (chatHistory.length && !confirm('Започни нов разговор? Предишните съобщения ще бъдат изтрити.')) return;
  chatHistory = [];
  store.set('chat', chatHistory);
  renderChat();
  $('chatInput').focus();
}

function renderChat() {
  const box = $('chatMessages');
  box.innerHTML = '';
  if (!chatHistory.length) {
    box.append(el('div', { class: 'msg assistant', text: 'Здравей! 👋 Аз съм твоят AI треньор. Питай ме за техника, загрявка, болки в мускулите, мотивация или как да адаптираш плана си.' }));
  }
  for (const m of chatHistory) {
    box.append(el('div', { class: `msg ${m.role}`, text: m.text }));
  }
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage(text) {
  if (chatBusy || !text.trim()) return;
  chatBusy = true;
  $('chatInput').value = '';
  document.querySelector('.chat-send').disabled = true;

  chatHistory.push({ role: 'user', text: text.trim() });
  store.set('chat', chatHistory);
  renderChat();

  const box = $('chatMessages');
  const typing = el('div', { class: 'msg assistant typing' }, el('i'), el('i'), el('i'));
  box.append(typing);
  box.scrollTop = box.scrollHeight;

  try {
    const res = await apiFetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId: planRecord?.planId || '',
        message: text.trim().slice(0, 600),
        history: chatHistory.slice(-7, -1), // последните реплики без текущата
        contextFallback: planRecord?.coachContext || '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'AI треньорът не отговори.');

    chatHistory.push({ role: 'assistant', text: data.reply });
    if (typeof data.messagesRemaining === 'number') {
      $('chatRemaining').textContent = `Оставащи съобщения днес: ${data.messagesRemaining}`;
    }
  } catch (e) {
    chatHistory.push({ role: 'assistant', text: `⚠ ${e.message}` });
  } finally {
    store.set('chat', chatHistory);
    chatBusy = false;
    document.querySelector('.chat-send').disabled = false;
    renderChat();
  }
}

// ============================================================
// Инициализация
// ============================================================

async function loadSharedPlan(planId) {
  showView('loading');
  $('loadingTitle').textContent = 'Зареждам плана…';
  try {
    const res = await apiFetch(`/api/plan/${encodeURIComponent(planId)}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Планът не е намерен.');
    planRecord = { planId, plan: data.plan, coachContext: data.coachContext || '', createdAt: data.createdAt };
    swaps = {}; intensity = 0; chatHistory = [];
    store.set('plan', planRecord);
    store.set('swaps', swaps);
    store.set('intensity', intensity);
    store.set('chat', chatHistory);
    activeDay = firstTrainingDay(data.plan);
    renderPlan();
    showView('plan');
    void refreshPwaInstall?.();
  } catch (e) {
    $('errorMessage').textContent = e.message;
    showView('error');
  }
}

function init() {
  const resumed = resumePendingGeneration();

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ex-chip-metric')) closeMetricTip();
  });

  // навигация на визарда
  $('btnNext').addEventListener('click', nextStep);
  $('btnBack').addEventListener('click', prevStep);

  $('btnOpenProgram').addEventListener('click', openCachedProgram);
  $('btnMyProgram').addEventListener('click', openCachedProgram);
  $('homePlanCard').addEventListener('click', (e) => {
    if (e.target.closest('#btnOpenProgram')) return;
    openCachedProgram();
  });

  const logo = document.querySelector('.app-header .logo');
  if (logo) {
    logo.addEventListener('click', (e) => {
      if (!hasCachedPlan()) return;
      e.preventDefault();
      renderHome();
      showView('home');
    });
  }
  $('btnStartWizard').addEventListener('click', () => {
    if (hasCachedPlan() && !confirm('Ще започнеш нов въпросник. Текущата програма остава запазена, докато не генерираш нова. Продължаваш ли?')) return;
    wizard.reset();
    wizard.renderStep();
    showView('wizard');
  });
  $('btnContinueWizard').addEventListener('click', () => {
    renderStep();
    showView('wizard');
  });

  // нов план (пази старите отговори за редакция)
  $('btnNewPlan').addEventListener('click', () => {
    if (!confirm('Ще започнеш нов въпросник (старите ти отговори са запазени за редакция). Продължаваш ли?')) return;
    wizard.reset();
    wizard.renderStep();
    showView('wizard');
  });

  // грешка → retry
  $('btnRetry').addEventListener('click', generatePlan);
  $('btnBackToWizard').addEventListener('click', () => { renderStep(); showView('wizard'); });

  // натоварване
  $('intensitySeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-level]');
    if (!btn) return;
    intensity = Number(btn.dataset.level);
    store.set('intensity', intensity);
    renderPlan();
  });

  // чат
  $('chatFab').addEventListener('click', openChat);
  $('chatNew').addEventListener('click', resetChat);
  $('chatClose').addEventListener('click', () => closeChat());
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChatMessage($('chatInput').value);
  });

  // lightbox: ✕ / клик извън / Escape
  $('lightboxClose').addEventListener('click', () => closeLightbox());
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('lightbox').classList.contains('hidden')) closeLightbox();
      else if (!$('chatPanel').classList.contains('hidden')) closeChat();
    }
  });

  // системен бутон "назад" (app-like)
  window.addEventListener('popstate', handlePopState);

  // начален екран
  if (!resumed) {
  const params = new URLSearchParams(location.search);
  const sharedPlanId = params.get('plan');
  const forceNew = params.has('new');
  const forceOpen = params.has('open');

  if (sharedPlanId && sharedPlanId !== planRecord?.planId) {
    loadSharedPlan(sharedPlanId);
  } else if (forceOpen && hasCachedPlan()) {
    openCachedProgram();
  } else if (forceNew || !hasCachedPlan()) {
    if (wizardHasProgress() && !forceNew) {
      renderHome();
      showView('home');
    } else {
      renderStep();
      showView('wizard');
    }
  } else {
    renderHome();
    showView('home');
  }
  }

  registerServiceWorker();
  refreshPwaInstall = bindPwaInstallCard($('pwaInstallCard'), { hasPlan: hasCachedPlan });
  void refreshPwaInstall?.();

  // Първи кадър е готов → маркирай като заредено (пуска entrance анимациите
  // за следващите навигации) и махни splash-а плавно.
  requestAnimationFrame(() => {
    document.body.classList.add('booted');
    const boot = $('boot');
    if (boot) {
      boot.classList.add('hide');
      setTimeout(() => boot.remove(), 400);
    }
  });
}

init();
