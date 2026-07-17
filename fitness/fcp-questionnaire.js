/**
 * KA-TRAINER — админ въпросник (модал). API е в admin.html inline.
 */
import {
  activeQuestions, buildAnswers,
  validateQuestion, visibleOptions,
} from './questions.js?v=2';
import { buildProfileSummary } from './profile-summary.js?v=2';
import { createWizardController, el } from './wizard-ui.js?v=2';

const IDS = {
  questionCard: 'fcpQuestionCard',
  progressFill: 'fcpProgressFill',
  stepLabel: 'fcpStepLabel',
  stepPct: 'fcpStepPct',
  stepError: 'fcpStepError',
  btnBack: 'fcpBtnBack',
  btnNext: 'fcpBtnNext',
  stepNav: 'fcpStepNav',
};

let state = {};
let wizard = null;
let modal = null;
let lastGender = null;

const $ = (id) => document.getElementById(id);
const getEl = (key) => document.getElementById(IDS[key] || key);

function stepOk(q) {
  return !validateQuestion(q, state);
}

function syncUi() {
  const list = activeQuestions(state);
  const done = list.filter(stepOk).length;
  const total = list.length;
  const answers = buildAnswers(state);
  const statusEl = $('fcpQuestionnaireStatus');
  const previewEl = $('fcpProfilePreview');

  if (statusEl) {
    if (answers.gender && done === total) {
      statusEl.innerHTML = `<span class="fcp-q-complete"><i class="fas fa-check-circle"></i> Попълнен (${done}/${total})</span>`;
    } else if (done > 0) {
      const cur = wizard ? list[wizard.getStepIndex()] : null;
      statusEl.textContent = `${done}/${total} · ${cur?.title || ''}`;
    } else {
      statusEl.textContent = 'Не е попълнен';
    }
  }

  if (previewEl) {
    if (answers.gender && answers.age) {
      previewEl.textContent = buildProfileSummary(answers);
      previewEl.classList.remove('fcp-preview-empty');
    } else {
      previewEl.textContent = 'Попълни въпросника…';
      previewEl.classList.add('fcp-preview-empty');
    }
  }

  if (!wizard) return;
  const nav = getEl('stepNav');
  if (!nav) return;
  const current = wizard.getStepIndex();
  nav.innerHTML = '';
  list.forEach((q, i) => {
    const cls = ['fcp-step', i === current ? 'active' : '', stepOk(q) ? 'done' : ''].filter(Boolean).join(' ');
    nav.append(el('button', {
      type: 'button', class: cls, title: q.title, text: String(q.num),
      onclick: () => {
        wizard.setStepIndex(i);
        wizard.renderStep();
        syncUi();
        const err = getEl('stepError');
        if (err) err.hidden = true;
      },
    }));
  });
}

function ensureWizard() {
  ensureModal();
  if (wizard) return;
  wizard = createWizardController({
    getEl,
    getQuestions: () => activeQuestions(state),
    visibleOptions,
    validateQuestion,
    getState: () => state,
    onPersist: () => {
      if (state.basics?.gender !== lastGender) {
        lastGender = state.basics?.gender;
        wizard.renderStep();
      }
      syncUi();
    },
    onComplete: () => { syncUi(); close(); },
    finalButtonText: 'Готово',
  });
}

function ensureModal() {
  if (modal) return;

  modal = el('div', { class: 'fcp-modal', id: 'fcpModal', hidden: true, role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'fcp-modal-backdrop' }),
    el('div', { class: 'fcp-modal-panel' },
      el('div', { class: 'fcp-modal-head' },
        el('h3', { text: 'Клиентски въпросник' }),
        el('button', { type: 'button', class: 'fcp-modal-close', text: '×' }),
      ),
      el('div', { class: 'fcp-wizard' },
        el('div', { class: 'fcp-steps', id: IDS.stepNav }),
        el('div', { class: 'fcp-progress-track' }, el('div', { class: 'fcp-progress-fill', id: IDS.progressFill })),
        el('div', { class: 'fcp-progress-meta' },
          el('span', { id: IDS.stepLabel }),
          el('span', { id: IDS.stepPct }),
        ),
        el('div', { class: 'fcp-q-card', id: IDS.questionCard }),
        el('p', { class: 'fcp-step-error', id: IDS.stepError, hidden: true }),
        el('div', { class: 'fcp-wizard-nav' },
          el('button', { type: 'button', class: 'fcp-btn-ghost', id: IDS.btnBack }, '← Назад'),
          el('button', { type: 'button', class: 'fcp-btn-primary', id: IDS.btnNext }, 'Напред →'),
        ),
      ),
    ),
  );
  document.body.append(modal);

  modal.querySelector('.fcp-modal-backdrop').addEventListener('click', close);
  modal.querySelector('.fcp-modal-close').addEventListener('click', close);
  getEl('btnBack').addEventListener('click', () => {
    ensureWizard();
    wizard.prevStep();
    syncUi();
    const err = getEl('stepError');
    if (err) err.hidden = true;
  });
  getEl('btnNext').addEventListener('click', () => {
    ensureWizard();
    const atEnd = wizard.getStepIndex() >= activeQuestions(state).length - 1;
    if (wizard.nextStep()) {
      syncUi();
      if (atEnd) close();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) close();
  });
}

export function open() {
  ensureModal();
  ensureWizard();
  requestAnimationFrame(() => {
    if (!wizard) return;
    wizard.renderStep();
    syncUi();
    if (modal) {
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
    }
  });
}

export function close() {
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  syncUi();
}

export function reset() {
  state = {};
  lastGender = null;
  if (wizard) wizard.reset();
  syncUi();
}

export function load(record = {}) {
  state = (record.clientFormState && typeof record.clientFormState === 'object')
    ? record.clientFormState
    : {};
  lastGender = state.basics?.gender || null;
  if (wizard) {
    wizard.reset();
    wizard.renderStep();
  }
  syncUi();
}

export function validate() {
  for (const q of activeQuestions(state)) {
    const err = validateQuestion(q, state);
    if (err) return `${q.num}. ${q.title}: ${err}`;
  }
  return null;
}

export function payload() {
  const clientAnswers = buildAnswers(state);
  return {
    clientAnswers,
    clientFormState: JSON.parse(JSON.stringify(state)),
    clientProfile: buildProfileSummary(clientAnswers),
  };
}

// За admin.html inline (без await при първо отваряне)
window.FcpQuestionnaire = { open, close, reset, load, validate, payload };
