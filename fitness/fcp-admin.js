/**
 * KA-TRAINER — клиентски програми в админа.
 * Въпросник (модал) → запази → AI → одобри → линк.
 */
import {
  activeQuestions, buildAnswers,
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
let programsCache = [];
let currentPlanId = null;

const DEFAULT_WORKER_URL = 'https://aidiet.radilov-k.workers.dev';

const cfg = () => ({
  workerUrl: window.FITPLAN_WORKER_URL || window.WORKER_URL || DEFAULT_WORKER_URL,
  headers: () => window.fitplanAdminHeaders?.() || { 'Content-Type': 'application/json' },
  ok: (m) => window.showSuccess?.(m),
  err: (m) => window.showError?.(m),
  esc: (s) => window.escapeHtml?.(s) ?? String(s ?? ''),
  base: () => window.getFitplanPublicBase?.() || '',
});

const $ = (id) => document.getElementById(id);
const getEl = (key) => document.getElementById(IDS[key] || key);

function stepOk(q) {
  return !validateQuestion(q, state);
}

function syncQuestionnaireUi() {
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
        syncQuestionnaireUi();
        const err = getEl('stepError');
        if (err) err.hidden = true;
      },
    }));
  });
}

let lastGender = null;

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
      syncQuestionnaireUi();
    },
    onComplete: () => { syncQuestionnaireUi(); closeQuestionnaire(); },
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

  modal.querySelector('.fcp-modal-backdrop').addEventListener('click', closeQuestionnaire);
  modal.querySelector('.fcp-modal-close').addEventListener('click', closeQuestionnaire);
  getEl('btnBack').addEventListener('click', () => {
    ensureWizard();
    wizard.prevStep();
    syncQuestionnaireUi();
    const err = getEl('stepError');
    if (err) err.hidden = true;
  });
  getEl('btnNext').addEventListener('click', () => {
    ensureWizard();
    const atEnd = wizard.getStepIndex() >= activeQuestions(state).length - 1;
    if (wizard.nextStep()) {
      syncQuestionnaireUi();
      if (atEnd) closeQuestionnaire();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) closeQuestionnaire();
  });
}

function openQuestionnaire() {
  ensureModal();
  ensureWizard();
  wizard.renderStep();
  syncQuestionnaireUi();
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeQuestionnaire() {
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  syncQuestionnaireUi();
}

function resetQuestionnaire() {
  state = {};
  lastGender = null;
  if (wizard) wizard.reset();
  syncQuestionnaireUi();
}

function loadQuestionnaire(record = {}) {
  state = (record.clientFormState && typeof record.clientFormState === 'object')
    ? record.clientFormState
    : {};
  lastGender = state.basics?.gender || null;
  if (wizard) {
    wizard.reset();
    wizard.renderStep();
  }
  syncQuestionnaireUi();
}

function validateQuestionnaire() {
  for (const q of activeQuestions(state)) {
    const err = validateQuestion(q, state);
    if (err) return `${q.num}. ${q.title}: ${err}`;
  }
  return null;
}

function questionnairePayload() {
  const clientAnswers = buildAnswers(state);
  return {
    clientAnswers,
    clientFormState: JSON.parse(JSON.stringify(state)),
    clientProfile: buildProfileSummary(clientAnswers),
  };
}

function statusLabel(status) {
  return status === 'approved' ? 'Одобрена' : 'Чернова';
}

function readPayload() {
  const built = questionnairePayload();
  return {
    id: $('fcpId')?.value.trim() || undefined,
    clientName: $('fcpClientName')?.value.trim() || '',
    clientContact: $('fcpClientContact')?.value.trim() || '',
    clientAnswers: built.clientAnswers,
    clientFormState: built.clientFormState,
    clientProfile: built.clientProfile,
    exampleScheme: $('fcpExampleScheme')?.value.trim() || '',
  };
}

function resetForm() {
  if ($('fcpId')) $('fcpId').value = '';
  if ($('fcpClientName')) $('fcpClientName').value = '';
  if ($('fcpClientContact')) $('fcpClientContact').value = '';
  if ($('fcpExampleScheme')) $('fcpExampleScheme').value = '';
  resetQuestionnaire();
  const statusEl = $('fcpStatus');
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.dataset.approved = '0';
  }
  $('fcpLinkWrap')?.classList.add('hidden');
  if ($('fcpClientLink')) $('fcpClientLink').value = '';
  $('fcpPreviewBtn')?.classList.add('hidden');
  $('fcpDeleteBtn')?.classList.add('hidden');
  currentPlanId = null;
}

function setClientLink(path) {
  const wrap = $('fcpLinkWrap');
  const input = $('fcpClientLink');
  const open = $('fcpClientLinkOpen');
  if (!path) {
    wrap?.classList.add('hidden');
    return;
  }
  const url = `${cfg().base()}/${path}`;
  if (input) input.value = url;
  if (open) open.href = url;
  wrap?.classList.remove('hidden');
}

function fillForm(program) {
  if ($('fcpId')) $('fcpId').value = program.id || '';
  if ($('fcpClientName')) $('fcpClientName').value = program.clientName || '';
  if ($('fcpClientContact')) $('fcpClientContact').value = program.clientContact || '';
  loadQuestionnaire({ clientFormState: program.clientFormState });
  if ($('fcpExampleScheme')) $('fcpExampleScheme').value = program.exampleScheme || '';
  currentPlanId = program.planId || null;
  $('fcpPreviewBtn')?.classList.toggle('hidden', !currentPlanId);
  const statusParts = [statusLabel(program.status)];
  if (program.planTitle) statusParts.push(program.planTitle);
  const statusEl = $('fcpStatus');
  if (statusEl) {
    statusEl.textContent = `Статус: ${statusParts.join(' · ')}`;
    statusEl.dataset.approved = program.status === 'approved' ? '1' : '0';
  }
  $('fcpDeleteBtn')?.classList.toggle('hidden', !program.id);
  if (program.clientLinkPath) setClientLink(program.clientLinkPath);
  else $('fcpLinkWrap')?.classList.add('hidden');
}

async function saveProgram() {
  const { err, ok } = cfg();
  const statusEl = $('fcpStatus');
  const validationError = validateQuestionnaire();
  if (validationError) return err(validationError);
  const payload = readPayload();
  if (!payload.clientName) return err('Въведи име на клиента.');
  if (!payload.clientAnswers?.gender) return err('Попълни въпросника.');
  if (statusEl) statusEl.textContent = 'Запазване…';
  try {
    const res = await fetch(`${cfg().workerUrl}/api/admin/fitplan/client-programs`, {
      method: 'POST',
      headers: cfg().headers(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Грешка');
    fillForm(data.program);
    if (statusEl) statusEl.textContent = `Запазено · ${statusLabel(data.program.status)}`;
    loadPrograms(true);
    ok('Черновата е запазена.');
  } catch (e) {
    if (statusEl) statusEl.textContent = '';
    err('Грешка при запис: ' + e.message);
  }
}

async function generateProgram() {
  const { err, ok } = cfg();
  const statusEl = $('fcpStatus');
  let id = $('fcpId')?.value.trim();
  if (!id) {
    await saveProgram();
    id = $('fcpId')?.value.trim();
    if (!id) return;
  }
  if (statusEl) statusEl.textContent = 'AI генерира… (до 1–2 мин)';
  try {
    const res = await fetch(`${cfg().workerUrl}/api/admin/fitplan/client-programs/${encodeURIComponent(id)}/generate`, {
      method: 'POST',
      headers: cfg().headers(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Грешка');
    fillForm(data.program);
    if (statusEl) statusEl.textContent = `${statusLabel(data.program.status)} · прегледай и одобри`;
    loadPrograms(true);
    ok('Готово. Прегледай, после одобри.');
  } catch (e) {
    if (statusEl) statusEl.textContent = '';
    err('Грешка при генерация: ' + e.message);
  }
}

async function approveProgram() {
  const { err, ok } = cfg();
  const id = $('fcpId')?.value.trim();
  if (!id) return err('Първо запази и генерирай програмата.');
  const statusEl = $('fcpStatus');
  if (statusEl) statusEl.textContent = 'Одобряване…';
  try {
    const res = await fetch(`${cfg().workerUrl}/api/admin/fitplan/client-programs/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: cfg().headers(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Грешка');
    fillForm(data.program);
    setClientLink(data.path);
    if (statusEl) statusEl.textContent = 'Одобрено · линкът е готов';
    loadPrograms(true);
    ok('Програмата е одобрена. Копирай линка.');
  } catch (e) {
    if (statusEl) statusEl.textContent = '';
    err('Грешка при одобрение: ' + e.message);
  }
}

function previewProgram(planId) {
  const { err } = cfg();
  const id = planId || currentPlanId;
  if (!id) return err('Първо генерирай програмата.');
  window.open(`${cfg().base()}/fitness/app.html?plan=${encodeURIComponent(id)}`, '_blank', 'noopener');
}

async function copyLink() {
  const { ok } = cfg();
  const input = $('fcpClientLink');
  if (!input?.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    ok('Линкът е копиран.');
  } catch {
    input.select();
    document.execCommand('copy');
    ok('Линкът е копиран.');
  }
}

async function deleteProgram(id, approved = false) {
  const { err, ok } = cfg();
  if (!id) return err('Липсва ID.');
  const msg = approved
    ? 'Изтриване на одобрена програма? Линкът ще спре да работи.'
    : 'Изтриване на записа?';
  if (!confirm(msg)) return;
  try {
    const res = await fetch(`${cfg().workerUrl}/api/admin/fitplan/client-programs`, {
      method: 'POST',
      headers: cfg().headers(),
      body: JSON.stringify({ action: 'delete', id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.message || `HTTP ${res.status}`);
    if ($('fcpId')?.value.trim() === id) resetForm();
    loadPrograms(true);
    ok('Изтрито.');
  } catch (e) {
    err('Грешка при изтриване: ' + e.message);
  }
}

function openProgram(id) {
  const { err } = cfg();
  const item = programsCache.find((p) => p.id === id);
  if (!item) return err('Програмата не е намерена. Обнови списъка.');
  resetForm();
  fillForm(item);
  $('fcpQuestionnaireStatus')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadPrograms(force = false) {
  const { err, esc } = cfg();
  const list = $('fcpProgramsList');
  if (!list) return;
  if (!force && list.dataset.loaded === '1') return;
  list.innerHTML = '<p style="color:var(--text-gray);"><i class="fas fa-spinner fa-spin"></i> Зареждане…</p>';
  try {
    const res = await fetch(`${cfg().workerUrl}/api/admin/fitplan/client-programs`, {
      headers: cfg().headers(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Грешка');
    const items = data.programs || [];
    programsCache = items;
    if (!items.length) {
      list.innerHTML = '<p style="color:var(--text-gray);font-size:0.9rem;">Няма запазени програми.</p>';
      list.dataset.loaded = '1';
      return;
    }
    list.innerHTML = '';
    for (const item of items) {
      const date = new Date(item.updatedAt || item.createdAt).toLocaleString('bg-BG');
      const card = document.createElement('div');
      card.className = 'pending-client-card';
      card.style.padding = '12px';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
          <div>
            <strong>${esc(item.clientName || 'Без име')}</strong>
            <span style="color:var(--text-gray);"> · ${esc(item.clientContact || '')}</span>
            <span class="report-badge badge-${item.status === 'approved' ? 'read' : 'unread'}" style="margin-left:8px;">${statusLabel(item.status)}</span>
          </div>
          <span style="color:var(--text-gray);font-size:0.85rem;">${date}</span>
        </div>
        <div style="margin-top:8px;color:var(--text-gray);font-size:0.9rem;">${esc(item.planTitle || 'Без генериран план')}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn" style="background:#3498db;padding:6px 12px;font-size:0.85rem;" data-fcp-open="${esc(item.id)}">Отвори</button>
          ${item.hasPlan ? `<button type="button" class="btn" style="background:#6366f1;padding:6px 12px;font-size:0.85rem;" data-fcp-preview="${esc(item.planId)}">Преглед</button>` : ''}
          <button type="button" class="btn" style="background:#e74c3c;padding:6px 12px;font-size:0.85rem;" data-fcp-delete="${esc(item.id)}" data-fcp-approved="${item.status === 'approved' ? '1' : '0'}">Изтрий</button>
          ${item.clientLinkPath ? `<button type="button" class="btn" style="background:#10b981;padding:6px 12px;font-size:0.85rem;" data-fcp-copy="${esc(item.id)}">Копирай линк</button>` : ''}
        </div>
      `;
      list.appendChild(card);
    }
    list.dataset.loaded = '1';
  } catch (e) {
    console.error('FCP list error:', e);
    list.innerHTML = '<p style="color:#e74c3c;">Грешка при зареждане.</p>';
  }
}

function fromConsultation({ name, contact, summary }) {
  resetForm();
  if ($('fcpClientName')) $('fcpClientName').value = name || '';
  if ($('fcpClientContact')) $('fcpClientContact').value = contact || '';
  if ($('fcpExampleScheme')) {
    $('fcpExampleScheme').value = summary ? `От консултация:\n${summary}` : '';
  }
  const statusEl = $('fcpStatus');
  if (statusEl) statusEl.textContent = 'От консултация — попълни въпросника.';
  openQuestionnaire();
  cfg().ok('Попълни въпросника.');
}

function fromConsultationById(id) {
  const item = window.fitplanConsultationsCache?.find((c) => c.id === id);
  if (!item) return cfg().err('Консултацията не е намерена.');
  fromConsultation({
    name: item.clientName,
    contact: item.clientContact,
    summary: item.summary,
  });
}

function bindUi() {
  $('fcpOpenBtn')?.addEventListener('click', openQuestionnaire);

  const card = $('fcpCard');
  if (!card) return;

  card.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fcp-action]');
    if (btn) {
      const action = btn.getAttribute('data-fcp-action');
      if (action === 'save') saveProgram();
      else if (action === 'generate') generateProgram();
      else if (action === 'preview') previewProgram();
      else if (action === 'approve') approveProgram();
      else if (action === 'reset') resetForm();
      else if (action === 'copy-link') copyLink();
      else if (action === 'refresh-list') loadPrograms(true);
      else if (action === 'delete') {
        const id = $('fcpId')?.value.trim();
        deleteProgram(id, $('fcpStatus')?.dataset.approved === '1');
      }
      return;
    }

    const openBtn = e.target.closest('[data-fcp-open]');
    if (openBtn) {
      openProgram(openBtn.getAttribute('data-fcp-open'));
      return;
    }
    const previewBtn = e.target.closest('[data-fcp-preview]');
    if (previewBtn) {
      previewProgram(previewBtn.getAttribute('data-fcp-preview'));
      return;
    }
    const delBtn = e.target.closest('[data-fcp-delete]');
    if (delBtn) {
      deleteProgram(delBtn.getAttribute('data-fcp-delete'), delBtn.getAttribute('data-fcp-approved') === '1');
      return;
    }
    const copyBtn = e.target.closest('[data-fcp-copy]');
    if (copyBtn) {
      openProgram(copyBtn.getAttribute('data-fcp-copy'));
      setTimeout(copyLink, 300);
    }
  });
}

function init() {
  bindUi();
  syncQuestionnaireUi();
}

window.loadFitplanClientPrograms = loadPrograms;
window.loadConsultationIntoClientProgramById = fromConsultationById;
window.deleteFitplanClientProgram = deleteProgram;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
