/**
 * Скрита консултационна страница — само с линк от админ.
 * Не е свързана с публичния KA-TRAINER интерфейс.
 */
import { QUESTIONS, activeQuestions, visibleOptions, validateQuestion, buildAnswers } from './questions.js';
import { createWizardController } from './wizard-ui.js';

const DEFAULT_WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
const FALLBACK_WORKER_URL = 'https://aidiet-fitness.radilov-k.workers.dev';
const ACCESS_KEY = new URLSearchParams(location.search).get('k') || '';

const $ = (id) => document.getElementById(id);
const wizardState = {};

let clientInfo = { name: '', contact: '' };

const wizard = createWizardController({
  getEl: $,
  questions: QUESTIONS,
  getQuestions: () => activeQuestions(wizardState),
  visibleOptions,
  validateQuestion,
  getState: () => wizardState,
  onComplete: submitConsultation,
  finalButtonText: 'Изпрати отговорите ✓',
});

async function apiFetch(path, options = {}) {
  const bases = [DEFAULT_WORKER_URL, FALLBACK_WORKER_URL];
  let lastError;
  for (let i = 0; i < bases.length; i += 1) {
    try {
      const res = await fetch(`${bases[i]}${path}`, options);
      if ((res.status === 404 || res.status === 405) && i < bases.length - 1) continue;
      return res;
    } catch (e) {
      lastError = e;
      if (i < bases.length - 1) continue;
      throw e;
    }
  }
  throw lastError || new Error('Сървърът не е достъпен');
}

function showView(name) {
  for (const id of ['view-intro', 'view-wizard', 'view-done', 'view-invalid']) {
    $(id).classList.toggle('hidden', id !== `view-${name}`);
  }
}

function startWizard() {
  const name = $('clientName').value.trim();
  const contact = $('clientContact').value.trim();
  const err = $('introError');
  if (!name) {
    err.textContent = 'Моля, въведи име.';
    err.hidden = false;
    return;
  }
  if (!contact) {
    err.textContent = 'Моля, въведи имейл или телефон за връзка.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  clientInfo = { name, contact };
  wizard.reset();
  wizard.renderStep();
  showView('wizard');
}

async function submitConsultation() {
  if (!ACCESS_KEY) {
    showView('invalid');
    return;
  }

  const btn = $('btnNext');
  btn.disabled = true;
  btn.textContent = 'Изпращане…';

  try {
    const answers = buildAnswers(wizardState);
    const res = await apiFetch('/api/fitplan/consultation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessKey: ACCESS_KEY,
        client: clientInfo,
        answers,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Грешка при изпращане');
    }
    showView('done');
  } catch (e) {
    const err = $('stepError');
    err.textContent = e.message || 'Неуспешно изпращане. Опитай отново.';
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Изпрати отговорите ✓';
  }
}

function init() {
  if (!ACCESS_KEY) {
    showView('invalid');
    return;
  }

  $('btnStartConsult').addEventListener('click', startWizard);
  $('btnNext').addEventListener('click', () => wizard.nextStep());
  $('btnBack').addEventListener('click', () => wizard.prevStep());
  showView('intro');
}

init();
