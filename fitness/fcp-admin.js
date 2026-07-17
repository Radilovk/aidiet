/**
 * KA-TRAINER — админ въпросник за клиентски програми.
 * Един модул: модал + wizard + API за admin.html (window.FcpForm).
 */
import {
  activeQuestions, buildAnswers, formStateFromAnswers,
  validateQuestion, visibleOptions,
} from './questions.js';
import { buildProfileSummary } from './profile-summary.js';
import { createWizardController, el } from './wizard-ui.js';

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
let statusEl = null;
let previewEl = null;
let lastGender = null;

const getEl = (key) => document.getElementById(IDS[key] || key);

function stepOk(q) {
  return !validateQuestion(q, state);
}

function syncUi() {
  if (!wizard) return;
  const list = activeQuestions(state);
  const done = list.filter(stepOk).length;
  const total = list.length;
  const answers = buildAnswers(state);

  if (statusEl) {
    if (answers.gender && done === total) {
      statusEl.innerHTML = `<span class="fcp-q-complete"><i class="fas fa-check-circle"></i> Попълнен (${done}/${total})</span>`;
    } else if (done > 0) {
      const cur = list[wizard.getStepIndex()];
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

  const nav = getEl('stepNav');
  if (nav) {
    const current = wizard.getStepIndex();
    nav.innerHTML = '';
    list.forEach((q, i) => {
      const cls = ['fcp-step', i === current ? 'active' : '', stepOk(q) ? 'done' : ''].filter(Boolean).join(' ');
      nav.append(el('button', {
        type: 'button', class: cls, title: q.title, text: String(q.num),
        onclick: () => { wizard.setStepIndex(i); wizard.renderStep(); syncUi(); getEl('stepError').hidden = true; },
      }));
    });
  }
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
  getEl('btnBack').addEventListener('click', () => { wizard.prevStep(); syncUi(); getEl('stepError').hidden = true; });
  getEl('btnNext').addEventListener('click', () => {
    const atEnd = wizard.getStepIndex() >= activeQuestions(state).length - 1;
    if (wizard.nextStep()) {
      syncUi();
      if (atEnd) close();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) close();
  });

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

function open() {
  ensureModal();
  wizard.renderStep();
  syncUi();
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function close() {
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  syncUi();
}

function reset() {
  state = {};
  lastGender = null;
  if (wizard) { wizard.reset(); wizard.renderStep(); }
  syncUi();
}

function load(record = {}) {
  if (record.clientFormState) state = record.clientFormState;
  else if (record.clientAnswers) state = formStateFromAnswers(record.clientAnswers);
  else state = {};
  lastGender = state.basics?.gender || null;
  if (wizard) { wizard.reset(); wizard.renderStep(); }
  syncUi();
}

function validate() {
  for (const q of activeQuestions(state)) {
    const err = validateQuestion(q, state);
    if (err) return `${q.num}. ${q.title}: ${err}`;
  }
  return null;
}

function payload() {
  const clientAnswers = buildAnswers(state);
  return {
    clientAnswers,
    clientFormState: JSON.parse(JSON.stringify(state)),
    clientProfile: buildProfileSummary(clientAnswers),
  };
}

function init() {
  statusEl = document.getElementById('fcpQuestionnaireStatus');
  previewEl = document.getElementById('fcpProfilePreview');
  document.getElementById('fcpOpenBtn')?.addEventListener('click', open);
  ensureModal();
  syncUi();
}

window.FcpForm = {
  init, open, close, reset, load, validate, payload,
  loadRecord: load, // backward compat
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
