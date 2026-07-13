/**
 * FitPlan AI — клиентска логика.
 *
 * Икономичен дизайн (0 излишни заявки):
 *   - Планът се пази в localStorage → повторно отваряне не вика бекенда.
 *   - Смяна на упражнение → алтернативите са прекомпютнати в плана (0 заявки).
 *   - Олекотяване/утежняване → детерминистични правила тук (0 заявки).
 *   - Чат историята живее в localStorage; към бекенда пътуват само
 *     последните няколко реплики + planId.
 */

import { QUESTIONS, visibleOptions, validateQuestion, buildAnswers } from './questions.js';
import { localizeExerciseDisplayName, sanitizeBgText } from './exercise-labels-bg.js';

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

/** API fetch with automatic fallback between main NutriPlan worker and dedicated FitPlan worker. */
async function apiFetch(path, options = {}) {
  const primary = workerUrl();
  const secondary = primary === DEFAULT_WORKER_URL ? FALLBACK_WORKER_URL : DEFAULT_WORKER_URL;
  const bases = primary === secondary ? [primary] : [primary, secondary];

  let lastError;
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    try {
      const res = await fetch(`${base}${path}`, options);
      if (res.status === 404 && i < bases.length - 1) continue;
      if (res.ok || i === bases.length - 1) return res;
    } catch (e) {
      lastError = e;
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
let stepIndex = 0;
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

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // само за доверени, статични низове
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
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
}

function openCachedProgram() {
  if (!hasCachedPlan()) {
    renderHome();
    showView('home');
    return;
  }
  activeDay = firstTrainingDay(planRecord.plan);
  renderPlan();
  showView('plan');
}

function showView(name) {
  for (const v of VIEWS) $(`view-${v}`).classList.toggle('hidden', v !== name);
  $('btnNewPlan').classList.toggle('hidden', name !== 'plan');
  $('btnMyProgram').classList.toggle('hidden', !hasCachedPlan() || name === 'plan');
  $('chatFab').classList.toggle('hidden', name !== 'plan');
  if (name !== 'plan') closeChat();
  document.body.dataset.view = name;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

// ============================================================
// ВЪПРОСНИК
// ============================================================

function saveWizard() { store.set('wizard', wizardState); }

function renderStep() {
  const q = QUESTIONS[stepIndex];
  const card = $('questionCard');
  card.innerHTML = '';
  $('stepError').hidden = true;

  const pct = Math.round(((stepIndex + 1) / QUESTIONS.length) * 100);
  $('progressFill').style.width = `${pct}%`;
  $('stepLabel').textContent = `Въпрос ${q.num} от ${QUESTIONS.length}`;
  $('stepPct').textContent = `${pct}%`;
  $('btnBack').style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
  $('btnNext').textContent = stepIndex === QUESTIONS.length - 1 ? 'Създай плана ⚡' : 'Напред →';

  card.append(el('h2', { class: 'q-title', text: q.title }));
  if (q.subtitle) card.append(el('p', { class: 'q-subtitle', text: q.subtitle }));

  const body = el('div', { class: 'q-body' });
  card.append(body);

  if (q.type === 'fields') renderFields(q, body);
  else if (q.type === 'multi') renderMulti(q, body);
  else if (q.type === 'single') renderSingle(q, body);
  else if (q.type === 'scale') renderScale(q, body);
  else if (q.type === 'text') renderTextArea(q, body);

  // re-animate
  card.style.animation = 'none';
  void card.offsetHeight;
  card.style.animation = '';
}

function renderFields(q, container) {
  const state = wizardState[q.id] || (wizardState[q.id] = {});

  const renderAll = () => {
    container.innerHTML = '';
    for (const f of q.fields) {
      if (f.showIf && state[f.showIf.key] !== f.showIf.equals) continue;
      const field = el('div', { class: 'field' });
      field.append(el('label', { class: 'field-label', text: f.label }));

      if (f.type === 'choice') {
        const group = el('div', { class: 'choice-group' });
        for (const opt of f.options) {
          group.append(el('button', {
            type: 'button',
            class: `choice-btn${state[f.key] === opt ? ' active' : ''}`,
            text: opt,
            onclick: () => { state[f.key] = opt; saveWizard(); renderAll(); },
          }));
        }
        field.append(group);
      } else if (f.type === 'chips') {
        const group = el('div', { class: 'chips-group' });
        const selected = new Set(state[f.key] || []);
        for (const opt of f.options) {
          group.append(el('button', {
            type: 'button',
            class: `chip-btn${selected.has(opt) ? ' active' : ''}`,
            text: opt,
            onclick: () => {
              selected.has(opt) ? selected.delete(opt) : selected.add(opt);
              state[f.key] = [...selected];
              saveWizard(); renderAll();
            },
          }));
        }
        field.append(group);
      } else if (f.type === 'number') {
        const input = el('input', {
          type: 'number', inputmode: 'numeric', min: f.min, max: f.max,
          value: state[f.key] ?? '',
          oninput: (e) => { state[f.key] = e.target.value; saveWizard(); },
        });
        const wrap = el('div', { class: 'num-wrap' }, input);
        if (f.suffix) wrap.append(el('span', { class: 'num-suffix', text: f.suffix }));
        field.append(wrap);
      } else { // text
        field.append(el('input', {
          type: 'text', placeholder: f.placeholder || '',
          value: state[f.key] ?? '',
          oninput: (e) => { state[f.key] = e.target.value; saveWizard(); },
        }));
      }
      container.append(field);
    }
  };
  renderAll();
}

function optionInputs(option) {
  return option.inputs || (option.input ? [option.input] : []);
}

function renderMulti(q, container) {
  const state = wizardState[q.id] || (wizardState[q.id] = { selected: [], inputs: {} });
  const options = visibleOptions(q, wizardState);

  const renderAll = () => {
    container.innerHTML = '';
    const list = el('div', { class: 'opt-list' });
    const selected = new Set(state.selected);

    for (const opt of options) {
      const isActive = selected.has(opt.value);
      const cardEl = el('div', { class: `opt-card${isActive ? ' active' : ''}`, role: 'checkbox', 'aria-checked': String(isActive), tabindex: '0' });
      const row = el('div', { class: 'opt-row' },
        el('span', { class: 'opt-mark', text: isActive ? '✓' : '' }),
        el('span', { class: 'opt-text', text: opt.value }),
      );
      cardEl.append(row);

      if (isActive && optionInputs(opt).length) {
        const inputsWrap = el('div', { class: 'opt-inputs' });
        for (const inp of optionInputs(opt)) {
          inputsWrap.append(el('input', {
            type: inp.type === 'number' ? 'number' : 'text',
            placeholder: inp.placeholder || '',
            value: state.inputs[inp.key] ?? '',
            onclick: (e) => e.stopPropagation(),
            oninput: (e) => { state.inputs[inp.key] = e.target.value; saveWizard(); },
          }));
        }
        cardEl.append(inputsWrap);
      }

      const toggle = () => {
        if (selected.has(opt.value)) selected.delete(opt.value);
        else {
          if (opt.exclusive) selected.clear();
          else for (const o of options) if (o.exclusive) selected.delete(o.value);
          selected.add(opt.value);
        }
        state.selected = [...selected];
        saveWizard(); renderAll();
      };
      cardEl.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') toggle(); });
      cardEl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
      list.append(cardEl);
    }
    container.append(list);
  };
  renderAll();
}

function renderSingle(q, container) {
  const state = wizardState[q.id] || (wizardState[q.id] = { selected: null, inputs: {} });

  const renderAll = () => {
    container.innerHTML = '';
    const list = el('div', { class: 'opt-list' });
    for (const opt of q.options) {
      const isActive = state.selected === opt.value;
      const cardEl = el('div', { class: `opt-card radio${isActive ? ' active' : ''}`, role: 'radio', 'aria-checked': String(isActive), tabindex: '0' });
      cardEl.append(el('div', { class: 'opt-row' },
        el('span', { class: 'opt-mark', text: isActive ? '●' : '' }),
        el('span', { class: 'opt-text', text: opt.value }),
      ));

      if (isActive && optionInputs(opt).length) {
        const inputsWrap = el('div', { class: 'opt-inputs' });
        for (const inp of optionInputs(opt)) {
          inputsWrap.append(el('input', {
            type: inp.type === 'number' ? 'number' : 'text',
            placeholder: inp.placeholder || '',
            value: state.inputs[inp.key] ?? '',
            onclick: (e) => e.stopPropagation(),
            oninput: (e) => { state.inputs[inp.key] = e.target.value; saveWizard(); },
          }));
        }
        cardEl.append(inputsWrap);
      }

      const select = () => { state.selected = opt.value; saveWizard(); renderAll(); };
      cardEl.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') select(); });
      cardEl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); select(); } });
      list.append(cardEl);
    }
    container.append(list);
  };
  renderAll();
}

function renderScale(q, container) {
  const current = wizardState[q.id] ?? 5;
  wizardState[q.id] = current;
  saveWizard();

  const valueEl = el('div', { class: 'scale-value', text: String(current) });
  const range = el('input', {
    type: 'range', min: q.min, max: q.max, value: current,
    oninput: (e) => {
      wizardState[q.id] = Number(e.target.value);
      valueEl.textContent = e.target.value;
      saveWizard();
    },
  });
  container.append(el('div', { class: 'scale-wrap' },
    valueEl, range,
    el('div', { class: 'scale-labels' },
      el('span', { text: `${q.min} — спокойно` }),
      el('span', { text: `${q.max} — на предела` }),
    ),
  ));
}

function renderTextArea(q, container) {
  container.append(el('textarea', {
    placeholder: q.placeholder || '',
    maxlength: '1500',
    oninput: (e) => { wizardState[q.id] = e.target.value; saveWizard(); },
  }, wizardState[q.id] || ''));
}

function nextStep() {
  const q = QUESTIONS[stepIndex];
  const error = validateQuestion(q, wizardState);
  if (error) {
    const errEl = $('stepError');
    errEl.textContent = error;
    errEl.hidden = false;
    errEl.style.animation = 'none';
    void errEl.offsetHeight;
    errEl.style.animation = '';
    return;
  }
  if (stepIndex < QUESTIONS.length - 1) {
    stepIndex++;
    renderStep();
  } else {
    generatePlan();
  }
}

function prevStep() {
  if (stepIndex > 0) { stepIndex--; renderStep(); }
}

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

async function generatePlan() {
  showView('loading');
  startLoadingMessages();

  const answers = buildAnswers(wizardState);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150000);

  try {
    const res = await apiFetch('/api/plan/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
      signal: controller.signal,
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
  } catch (e) {
    const message = e.name === 'AbortError'
      ? 'Заявката отне твърде дълго. Провери връзката и опитай отново.'
      : e.message;
    $('errorMessage').textContent = message;
    showView('error');
  } finally {
    clearTimeout(timeout);
    stopLoadingMessages();
  }
}

function firstTrainingDay(plan) {
  const idx = (plan.days || []).findIndex((d) => d.type !== 'rest');
  return idx >= 0 ? idx : 0;
}

// ============================================================
// АДАПТАЦИЯ: детерминистични правила (0 заявки към бекенда)
// ============================================================

export function applyIntensity(ex, level) {
  if (!level) return { ...ex, intensityNote: '' };
  if (level < 0) {
    return {
      ...ex,
      sets: Math.max(2, ex.sets - 1),
      restSeconds: Math.min(240, ex.restSeconds + 30),
      intensityNote: 'Олекотено: по-леки тежести (RPE 6–7), фокус върху чиста техника.',
    };
  }
  return {
    ...ex,
    sets: Math.min(8, ex.sets + 1),
    restSeconds: Math.max(45, ex.restSeconds - 15),
    intensityNote: 'Интензивно: повиши тежестта (RPE 8–9), запази контрол в негативната фаза.',
  };
}

/** Текущото упражнение за слот, със замяна и ниво на натоварване. */
function effectiveExercise(dayIdx, exIdx) {
  const base = planRecord.plan.days[dayIdx].exercises[exIdx];
  const swapKey = `${dayIdx}-${exIdx}`;
  const altIdx = swaps[swapKey];
  const adjusted = applyIntensity(base, intensity);

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

function renderExerciseCard(dayIdx, exIdx) {
  const ex = effectiveExercise(dayIdx, exIdx);
  const base = planRecord.plan.days[dayIdx].exercises[exIdx];
  const swapKey = `${dayIdx}-${exIdx}`;
  const media = ex.match;

  const cardEl = el('div', { class: 'ex-card' });

  // thumbnail (статична снимка; GIF-ът се зарежда чак в lightbox-а — пести трафик)
  if (media?.imageUrl || media?.gifUrl) {
    const img = el('img', {
      class: 'ex-thumb',
      src: media.imageUrl || media.gifUrl,
      alt: ex.displayName,
      loading: 'lazy',
      onclick: () => openLightbox(ex),
      onerror: (e) => { e.target.replaceWith(el('div', { class: 'ex-thumb-placeholder', text: '🏋' })); },
    });
    cardEl.append(img);
  } else {
    cardEl.append(el('div', { class: 'ex-thumb-placeholder', text: '🏋' }));
  }

  const main = el('div', { class: 'ex-main' });
  main.append(el('div', { class: 'ex-name', text: localizeExerciseDisplayName(ex.canonicalName, ex.displayName, ex.equipmentHint) }));
  if (media && media.name !== ex.displayName) {
    main.append(el('div', { class: 'ex-name-en', text: media.name }));
  }
  if (ex.isSwapped) {
    main.append(el('div', { class: 'ex-swapped-tag', text: `⇄ заменено (ориг.: ${ex.originalName})` }));
  }

  const chips = el('div', { class: 'ex-chips' });
  chips.append(el('span', { class: 'ex-chip', html: `<b>${ex.sets}</b> × ${escapeHtml(ex.reps)}` }));
  chips.append(el('span', { class: 'ex-chip', text: `почивка ${ex.restSeconds} сек` }));
  if (ex.rpe) chips.append(el('span', { class: 'ex-chip', text: `RPE ${ex.rpe}` }));
  if (ex.tempo) chips.append(el('span', { class: 'ex-chip', text: `темпо ${ex.tempo}` }));
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
    options.append(makeOption(
      alt.name, alt.equipment ? `оборудване: ${alt.equipment}` : '',
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
  $('lightboxImg').src = media.gifUrl || media.imageUrl;
  $('lightboxImg').alt = ex.displayName;
  $('lightboxTitle').textContent = localizeExerciseDisplayName(ex.canonicalName, ex.displayName, ex.equipmentHint);
  $('lightboxMeta').textContent = [media.name, media.target && `цел: ${media.target}`, media.equipment && `оборудване: ${media.equipment}`]
    .filter(Boolean).join(' · ');
  $('lightboxInstructions').textContent = media.instructions || '';
  $('lightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
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
}

function closeChat() {
  $('chatPanel').classList.add('hidden');
  if (!$('view-plan').classList.contains('hidden')) $('chatFab').classList.remove('hidden');
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
  } catch (e) {
    $('errorMessage').textContent = e.message;
    showView('error');
  }
}

function init() {
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
    stepIndex = 0;
    renderStep();
    showView('wizard');
  });
  $('btnContinueWizard').addEventListener('click', () => {
    renderStep();
    showView('wizard');
  });

  // нов план (пази старите отговори за редакция)
  $('btnNewPlan').addEventListener('click', () => {
    if (!confirm('Ще започнеш нов въпросник (старите ти отговори са запазени за редакция). Продължаваш ли?')) return;
    stepIndex = 0;
    renderStep();
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
  $('chatClose').addEventListener('click', closeChat);
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChatMessage($('chatInput').value);
  });

  // lightbox: ✕ / клик извън / Escape
  $('lightboxClose').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('lightbox').classList.contains('hidden')) closeLightbox();
      else if (!$('chatPanel').classList.contains('hidden')) closeChat();
    }
  });

  // начален екран
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

  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const swUrl = new URL('./fitplan-sw.js', import.meta.url);
  navigator.serviceWorker.register(swUrl.href, { scope: '/fitness/' }).catch(() => {});
}

init();
