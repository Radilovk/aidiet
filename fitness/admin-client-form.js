/**
 * KA-TRAINER — админ въпросник за клиентски програми.
 * Стъпков визард (същият UI като клиентския), компактен за админ панела.
 */
import { activeQuestions, buildAnswers, validateQuestion, visibleOptions } from './questions.js';
import { buildProfileSummary } from './profile-summary.js';
import { createWizardController, el } from './wizard-ui.js';

const DOM = {
  questionCard: 'fcpQuestionCard',
  progressFill: 'fcpProgressFill',
  stepLabel: 'fcpStepLabel',
  stepPct: 'fcpStepPct',
  stepError: 'fcpStepError',
  btnBack: 'fcpBtnBack',
  btnNext: 'fcpBtnNext',
  stepNav: 'fcpStepNav',
};

let formState = {};
let containerEl = null;
let previewEl = null;
let legacyEl = null;
let wizard = null;
let lastGender = null;

function $(id) {
  return document.getElementById(id);
}

function dom(key) {
  return $(DOM[key] || key);
}

function updatePreview() {
  if (!previewEl) return;
  try {
    const answers = buildAnswers(formState);
    if (answers.gender && answers.age) {
      previewEl.textContent = buildProfileSummary(answers);
      previewEl.classList.remove('fcp-preview-empty');
    } else {
      previewEl.textContent = 'Попълни основните данни за преглед…';
      previewEl.classList.add('fcp-preview-empty');
    }
  } catch {
    previewEl.textContent = '';
  }
}

function stepDone(q) {
  return !validateQuestion(q, formState);
}

function updateStepNav() {
  const nav = $(DOM.stepNav);
  if (!nav) return;
  const list = activeQuestions(formState);
  const current = wizard?.getStepIndex() ?? 0;
  nav.innerHTML = '';

  list.forEach((q, idx) => {
    const done = stepDone(q);
    const classes = ['fcp-step'];
    if (idx === current) classes.push('active');
    else if (done) classes.push('done');
    nav.append(el('button', {
      type: 'button',
      class: classes.join(' '),
      title: q.title,
      text: String(q.num),
      onclick: () => {
        wizard.setStepIndex(idx);
        wizard.renderStep();
        updateStepNav();
        dom('stepError').hidden = true;
      },
    }));
  });
}

function buildShell(container) {
  container.innerHTML = '';
  container.className = 'fcp-wizard';

  const stepNav = el('div', { class: 'fcp-steps', id: DOM.stepNav });
  const head = el('div', { class: 'fcp-wizard-head' },
    el('div', { class: 'fcp-progress-track', role: 'progressbar' },
      el('div', { class: 'fcp-progress-fill', id: DOM.progressFill }),
    ),
    el('div', { class: 'fcp-progress-meta' },
      el('span', { id: DOM.stepLabel }),
      el('span', { id: DOM.stepPct }),
    ),
  );
  const card = el('div', { class: 'fcp-q-card', id: DOM.questionCard });
  const err = el('p', { class: 'fcp-step-error', id: DOM.stepError, hidden: true });
  const nav = el('div', { class: 'fcp-wizard-nav' },
    el('button', { type: 'button', class: 'fcp-btn-ghost', id: DOM.btnBack }, '← Назад'),
    el('button', { type: 'button', class: 'fcp-btn-primary', id: DOM.btnNext }, 'Напред →'),
  );

  container.append(stepNav, head, card, err, nav);

  $(DOM.btnBack).addEventListener('click', () => {
    wizard.prevStep();
    updateStepNav();
    dom('stepError').hidden = true;
  });
  $(DOM.btnNext).addEventListener('click', () => {
    if (wizard.nextStep()) updateStepNav();
  });
}

function initWizard() {
  wizard = createWizardController({
    getEl: dom,
    getQuestions: () => activeQuestions(formState),
    visibleOptions,
    validateQuestion,
    getState: () => formState,
    onPersist: () => {
      const g = formState.basics?.gender;
      if (g !== lastGender) {
        lastGender = g;
        wizard.renderStep();
      }
      updatePreview();
      updateStepNav();
    },
    onComplete: () => updatePreview(),
    finalButtonText: 'Готово',
  });
  wizard.renderStep();
  updateStepNav();
  updatePreview();
}

/** Инициализира формата в контейнера. */
export function initAdminClientForm({ container, preview, legacyNotice }) {
  containerEl = container;
  previewEl = preview;
  legacyEl = legacyNotice;
  formState = {};
  buildShell(container);
  lastGender = null;
  initWizard();
}

export function getAdminFormState() {
  return JSON.parse(JSON.stringify(formState));
}

export function setAdminFormData({ clientAnswers, clientProfile } = {}) {
  if (clientAnswers && typeof clientAnswers === 'object') {
    formState = answersToFormState(clientAnswers);
    if (legacyEl) legacyEl.classList.add('hidden');
  } else if (clientProfile?.trim()) {
    formState = {};
    if (legacyEl) {
      legacyEl.classList.remove('hidden');
      legacyEl.textContent = 'Стар запис със свободен текст. Попълни въпросника и запази отново.';
    }
  } else {
    formState = {};
    if (legacyEl) legacyEl.classList.add('hidden');
  }
  if (wizard) {
    wizard.reset();
    wizard.renderStep();
    updateStepNav();
    updatePreview();
  }
}

function answersToFormState(a) {
  const s = {};
  s.basics = {
    gender: a.gender || '',
    age: a.age ?? '',
    heightCm: a.heightCm ?? '',
    weightKg: a.weightKg ?? '',
  };

  const healthSel = [];
  const healthInputs = { healthMeds: a.healthMeds || '', healthOther: a.healthOther || '' };
  for (const item of a.health || []) {
    if (item.startsWith('медикаменти:')) healthInputs.healthMeds = item.replace(/^медикаменти:\s*/, '');
    else if (!['Приемам медикаменти редовно', 'Друго'].includes(item)) healthSel.push(item);
    else healthSel.push(item);
  }
  if (a.healthMeds && !healthSel.includes('Приемам медикаменти редовно')) {
    healthSel.push('Приемам медикаменти редовно');
  }
  s.health = { selected: healthSel, inputs: healthInputs };

  if (a.healthFemale?.length) {
    const label = a.healthFemale[0];
    if (label.includes('Бременна')) {
      s.womenContext = { selected: 'Бременна', inputs: { pregnancyTrimester: label.split(':').pop()?.trim() || '' } };
    } else if (label.includes('Кърмене')) {
      s.womenContext = { selected: 'Кърмя в момента', inputs: { breastfeedingMonths: label.match(/\d+/)?.[0] || '' } };
    } else if (label.includes('Следродилен')) {
      s.womenContext = { selected: 'Скоро след раждане (до 6 месеца)', inputs: { postpartumMonths: label.match(/\d+/)?.[0] || '' } };
    } else if (label.includes('Менопауза')) {
      s.womenContext = { selected: 'Менопауза / перименопауза', inputs: {} };
    } else {
      s.womenContext = { selected: 'Други хормонални особености', inputs: { womenOther: label } };
    }
  }

  const limSel = [];
  const limInputs = {};
  for (const item of a.limitations || []) {
    const [base, detail] = item.split(':').map((x) => x.trim());
    const keyMap = {
      'Диагностициран проблем': 'limitDiagnosed',
      'Болка при конкретно движение без официална диагноза': 'limitPainMove',
      'Прекаран хирургичен опорно-двигателен проблем': 'limitSurgery',
      'Друго': 'limitOther',
    };
    limSel.push(base);
    if (detail && keyMap[base]) limInputs[keyMap[base]] = detail;
  }
  s.limitations = { selected: limSel, inputs: limInputs };

  const wcInputs = {};
  let wcSel = 'Не, теглото ми е стабилно';
  if (a.weightChange?.type === 'gain') {
    wcSel = 'Да, качих килограми';
    wcInputs.gainKg = a.weightChange.amountKg ?? '';
    wcInputs.gainReason = a.weightChange.reason || '';
  } else if (a.weightChange?.type === 'loss') {
    wcSel = 'Да, свалих килограми';
    wcInputs.lossKg = a.weightChange.amountKg ?? '';
    wcInputs.lossReason = a.weightChange.reason || '';
  }
  s.weightChange = { selected: wcSel, inputs: wcInputs };

  s.sleep = { selected: a.sleep || '' };
  s.stress = a.stress ?? 5;
  s.dailyActivity = { selected: a.dailyActivity || '' };
  s.sportActivity = { selected: a.sportActivity?.status || '', inputs: { sportCurrent: a.sportActivity?.current || '' } };
  s.experience = { selected: a.experience || '' };
  s.nutrition = { type: a.nutrition?.type || '', custom: a.nutrition?.custom || '', mealsPerDay: a.nutrition?.mealsPerDay ?? '' };
  s.goal = {
    main: a.goal?.main || '',
    other: a.goal?.other || '',
    timeframe: a.goal?.deadline ? 'Конкретна дата' : 'Без краен срок',
    deadline: a.goal?.deadline || '',
  };
  s.equipment = { selected: [...(a.equipment || [])], inputs: { equipmentOther: a.equipmentOther || '' } };
  s.preferences = { ...(a.preferences || {}), types: a.preferences?.types || [] };
  s.extraInfo = a.extraInfo || '';
  return s;
}

export function validateAdminClientForm() {
  for (const q of activeQuestions(formState)) {
    const err = validateQuestion(q, formState);
    if (err) return `${q.num}. ${q.title}: ${err}`;
  }
  return null;
}

export function buildAdminClientPayload() {
  const clientAnswers = buildAnswers(formState);
  return {
    clientAnswers,
    clientFormState: getAdminFormState(),
    clientProfile: buildProfileSummary(clientAnswers),
  };
}

export function loadAdminClientRecord({ clientFormState, clientAnswers, clientProfile } = {}) {
  if (clientFormState && typeof clientFormState === 'object') {
    formState = clientFormState;
    if (legacyEl) legacyEl.classList.add('hidden');
  } else {
    setAdminFormData({ clientAnswers, clientProfile });
    return;
  }
  if (wizard) {
    wizard.reset();
    wizard.renderStep();
    updateStepNav();
    updatePreview();
  }
}

export function resetAdminClientForm() {
  formState = {};
  if (legacyEl) legacyEl.classList.add('hidden');
  if (wizard) {
    wizard.reset();
    wizard.renderStep();
    updateStepNav();
    updatePreview();
  }
}
