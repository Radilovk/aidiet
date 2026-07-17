/**
 * KA-TRAINER — админ въпросник в модал (същите въпроси като при клиентите).
 * Компактен изглед на страницата; пълният въпросник се отваря в overlay.
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
let wizard = null;
let modalEl = null;
let statusEl = null;
let previewEl = null;
let onUpdateCb = null;
let lastGender = null;

function $(id) {
  return document.getElementById(id);
}

function dom(key) {
  return $(DOM[key] || key);
}

function stepDone(q) {
  return !validateQuestion(q, formState);
}

function progressSummary() {
  const list = activeQuestions(formState);
  const done = list.filter(stepDone).length;
  const current = wizard?.getStepIndex() ?? 0;
  const q = list[current];
  return { total: list.length, done, currentTitle: q?.title || '' };
}

function updateStatus() {
  if (!statusEl) return;
  const { total, done, currentTitle } = progressSummary();
  const answers = buildAnswers(formState);
  if (answers.gender && done === total) {
    statusEl.innerHTML = `<span class="fcp-q-done"><i class="fas fa-check-circle"></i> Въпросникът е попълнен (${done}/${total})</span>`;
    statusEl.classList.add('fcp-q-complete');
  } else if (answers.gender || done > 0) {
    statusEl.innerHTML = `<span class="fcp-q-partial">${done}/${total} стъпки · ${currentTitle || 'продължи'}</span>`;
    statusEl.classList.remove('fcp-q-complete');
  } else {
    statusEl.innerHTML = '<span class="fcp-q-empty">Въпросникът не е попълнен</span>';
    statusEl.classList.remove('fcp-q-complete');
  }
}

function updatePreview() {
  if (!previewEl) return;
  try {
    const answers = buildAnswers(formState);
    if (answers.gender && answers.age) {
      previewEl.textContent = buildProfileSummary(answers);
      previewEl.classList.remove('fcp-preview-empty');
    } else {
      previewEl.textContent = 'Попълни въпросника за преглед…';
      previewEl.classList.add('fcp-preview-empty');
    }
  } catch {
    previewEl.textContent = '';
  }
}

function updateStepNav() {
  const nav = $(DOM.stepNav);
  if (!nav) return;
  const list = activeQuestions(formState);
  const current = wizard?.getStepIndex() ?? 0;
  nav.innerHTML = '';
  list.forEach((q, idx) => {
    const classes = ['fcp-step'];
    if (idx === current) classes.push('active');
    else if (stepDone(q)) classes.push('done');
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

function buildModal() {
  if (modalEl) return;
  modalEl = el('div', { class: 'fcp-modal hidden', id: 'fcpModal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Клиентски въпросник' },
    el('div', { class: 'fcp-modal-backdrop', onclick: () => closeModal() }),
    el('div', { class: 'fcp-modal-panel' },
      el('div', { class: 'fcp-modal-head' },
        el('h3', { text: 'Клиентски въпросник' }),
        el('button', { type: 'button', class: 'fcp-modal-close', text: '×', onclick: () => closeModal() }),
      ),
      el('div', { class: 'fcp-wizard', id: 'fcpWizardMount' },
        el('div', { class: 'fcp-steps', id: DOM.stepNav }),
        el('div', { class: 'fcp-wizard-head' },
          el('div', { class: 'fcp-progress-track', role: 'progressbar' },
            el('div', { class: 'fcp-progress-fill', id: DOM.progressFill }),
          ),
          el('div', { class: 'fcp-progress-meta' },
            el('span', { id: DOM.stepLabel }),
            el('span', { id: DOM.stepPct }),
          ),
        ),
        el('div', { class: 'fcp-q-card', id: DOM.questionCard }),
        el('p', { class: 'fcp-step-error', id: DOM.stepError, hidden: true }),
        el('div', { class: 'fcp-wizard-nav' },
          el('button', { type: 'button', class: 'fcp-btn-ghost', id: DOM.btnBack }, '← Назад'),
          el('button', { type: 'button', class: 'fcp-btn-primary', id: DOM.btnNext }, 'Напред →'),
        ),
      ),
    ),
  );
  document.body.append(modalEl);

  $(DOM.btnBack).addEventListener('click', () => {
    wizard.prevStep();
    updateStepNav();
    dom('stepError').hidden = true;
  });
  $(DOM.btnNext).addEventListener('click', () => {
    const list = activeQuestions(formState);
    const atEnd = wizard.getStepIndex() >= list.length - 1;
    if (wizard.nextStep()) {
      updateStepNav();
      if (atEnd) closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl && !modalEl.classList.contains('hidden')) closeModal();
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
      updateStepNav();
      updateStatus();
      updatePreview();
      onUpdateCb?.();
    },
    onComplete: () => {
      updateStatus();
      updatePreview();
      onUpdateCb?.();
      closeModal();
    },
    finalButtonText: 'Готово',
  });
}

export function openAdminQuestionnaire() {
  buildModal();
  wizard.renderStep();
  updateStepNav();
  modalEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

export function closeModal() {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  document.body.style.overflow = '';
  updateStatus();
  updatePreview();
  onUpdateCb?.();
}

export function initAdminClientForm({ status, preview, onUpdate } = {}) {
  statusEl = status;
  previewEl = preview;
  onUpdateCb = onUpdate;
  formState = {};
  lastGender = null;
  buildModal();
  initWizard();
  updateStatus();
  updatePreview();
}

export function getAdminFormState() {
  return JSON.parse(JSON.stringify(formState));
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

export function loadAdminClientRecord({ clientFormState, clientAnswers } = {}) {
  if (clientFormState && typeof clientFormState === 'object') {
    formState = clientFormState;
  } else if (clientAnswers && typeof clientAnswers === 'object') {
    formState = answersToFormState(clientAnswers);
  } else {
    formState = {};
  }
  lastGender = formState.basics?.gender || null;
  if (wizard) {
    wizard.reset();
    wizard.renderStep();
    updateStepNav();
  }
  updateStatus();
  updatePreview();
}

export function resetAdminClientForm() {
  formState = {};
  lastGender = null;
  if (wizard) {
    wizard.reset();
    wizard.renderStep();
    updateStepNav();
  }
  updateStatus();
  updatePreview();
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
