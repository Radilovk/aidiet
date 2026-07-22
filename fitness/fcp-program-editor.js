/**
 * KA-TRAINER — админ редактор на клиентска програма.
 * Промяна на упражнения (добавяне/смяна/изтриване), пренареждане
 * (drag&drop + бутони) и редакция на дни (фокус/тип/продължителност/
 * загрявка/разпускане) — без нова AI генерация. Търсене по дума+синоними
 * и филтри в picker-а идват от /api/exercises/search.
 */
import { el } from './wizard-ui.js?v=2';

const DAY_TYPES = [
  ['strength', 'Сила'],
  ['cardio', 'Кардио'],
  ['hiit', 'HIIT'],
  ['mobility', 'Мобилност'],
  ['active-recovery', 'Активно възстановяване'],
  ['rest', 'Почивка'],
];
const DIFF_LABELS = { 1: 'd1 лесно', 2: 'd2 средно', 3: 'd3 трудно' };

let modal = null;
let state = null; // { programId, planId, plan, dirty, picker }
let facetsCache = null;
let dragData = null;

const $ = (sel, root = modal) => root?.querySelector(sel);

function apiBase() {
  return window.FITPLAN_WORKER_URL || '';
}
function adminHeaders() {
  return window.fitplanAdminHeaders?.() || { 'Content-Type': 'application/json' };
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function setStatus(text, isError = false) {
  const s = $('#fcpEditorStatus');
  if (!s) return;
  s.textContent = text;
  s.style.color = isError ? '#e74c3c' : '';
}

function markDirty() {
  state.dirty = true;
  const btn = $('#fcpEditorSaveBtn');
  if (btn) btn.disabled = false;
  setStatus('Незапазени промени…');
}

// ============================================================================
// Модал (shell) — създава се веднъж
// ============================================================================

function ensureModal() {
  if (modal) return;
  modal = el('div', { class: 'fcp-modal', id: 'fcpEditorModal', hidden: true, role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'fcp-modal-backdrop' }),
    el('div', { class: 'fcp-modal-panel fcp-editor-panel', style: 'position:relative;' },
      el('div', { class: 'fcp-modal-head' },
        el('h3', { id: 'fcpEditorTitle', text: 'Редактор на програма' }),
        el('div', { class: 'fcp-editor-head-actions' },
          el('span', { id: 'fcpEditorStatus' }),
          el('button', {
            type: 'button', class: 'fcp-editor-save', id: 'fcpEditorSaveBtn', disabled: true,
            onclick: () => save(),
          }, 'Запази промените'),
          el('button', { type: 'button', class: 'fcp-modal-close', onclick: () => close() }, '×'),
        ),
      ),
      el('div', { class: 'fcp-editor-body', id: 'fcpEditorBody' }),
    ),
  );
  document.body.append(modal);
  modal.querySelector('.fcp-modal-backdrop').addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) {
      if (state?.picker?.open) closePicker();
      else close();
    }
  });
}

export async function open(program) {
  ensureModal();
  const id = program?.id;
  if (!id) return;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#fcpEditorTitle').textContent = `Редактор на програма — ${program.clientName || ''}`.trim();
  $('#fcpEditorBody').innerHTML = '<p style="padding:20px;color:var(--text-gray);"><i class="fas fa-spinner fa-spin"></i> Зареждане…</p>';
  setStatus('');
  state = { programId: id, planId: null, plan: null, dirty: false, picker: null };

  try {
    const res = await fetch(`${apiBase()}/api/admin/fitplan/client-programs/${encodeURIComponent(id)}/plan`, {
      headers: adminHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Грешка при зареждане');
    state.planId = data.planId;
    state.plan = data.plan;
    renderBoard();
  } catch (e) {
    $('#fcpEditorBody').innerHTML = `<p style="padding:20px;color:#e74c3c;">Грешка: ${escapeHtml(e.message)}</p>`;
  }
}

export function close() {
  if (!modal) return;
  if (state?.dirty && !confirm('Има незапазени промени. Затвори без запис?')) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  state = null;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================================
// Запис
// ============================================================================

async function save() {
  if (!state?.plan) return;
  const btn = $('#fcpEditorSaveBtn');
  btn.disabled = true;
  setStatus('Запазване…');
  try {
    const res = await fetch(`${apiBase()}/api/admin/fitplan/client-programs/${encodeURIComponent(state.programId)}/plan`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ plan: state.plan }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Грешка при запис');
    state.plan = data.plan;
    state.dirty = false;
    renderBoard();
    setStatus('Запазено ✓');
    window.loadFitplanClientPrograms?.(true);
  } catch (e) {
    btn.disabled = false;
    setStatus(`Грешка: ${e.message}`, true);
  }
}

// ============================================================================
// Табло с дни
// ============================================================================

function renderBoard() {
  const body = $('#fcpEditorBody');
  body.innerHTML = '';
  state.plan.days.forEach((day, dayIndex) => {
    body.append(renderDayColumn(day, dayIndex));
  });
}

function renderDayColumn(day, dayIndex) {
  const col = el('div', { class: 'fcp-editor-day', 'data-day-index': String(dayIndex) });

  const typeSelect = el('select', { class: 'fcp-editor-type' });
  for (const [value, label] of DAY_TYPES) {
    typeSelect.append(el('option', { value, ...(day.type === value ? { selected: true } : {}) }, label));
  }
  typeSelect.addEventListener('change', () => { day.type = typeSelect.value; markDirty(); });

  const focusInput = el('input', {
    class: 'fcp-editor-focus', type: 'text', value: day.focus || '', placeholder: 'Фокус на деня',
    oninput: (e) => { day.focus = e.target.value; markDirty(); },
  });

  const durationInput = el('input', {
    type: 'number', min: '0', value: day.durationMin ?? '',
    oninput: (e) => { day.durationMin = Number(e.target.value) || null; markDirty(); },
  });

  const swapSelect = el('select', {},
    el('option', { value: '' }, 'размени с…'),
    ...state.plan.days.map((d, i) => (i === dayIndex ? null : el('option', { value: String(i) }, d.day))).filter(Boolean),
  );
  const swapBtn = el('button', {
    type: 'button', class: 'fcp-editor-mini-btn', title: 'Размени съдържанието на двата дни',
    onclick: () => {
      const target = Number(swapSelect.value);
      if (!Number.isInteger(target)) return;
      swapDayContent(dayIndex, target);
    },
  }, '⇄');

  col.append(
    el('div', { class: 'fcp-editor-day-head' },
      el('div', { class: 'fcp-editor-day-title' }, el('strong', { text: day.day }), focusInput),
      el('div', { class: 'fcp-editor-day-meta' },
        typeSelect,
        el('span', {}, durationInput, ' мин'),
      ),
      el('div', { class: 'fcp-editor-day-swap' }, swapSelect, swapBtn),
    ),
    renderPhaseEditor(day),
  );

  const list = el('div', { class: `fcp-editor-exlist${day.exercises.length ? '' : ' empty'}`, 'data-day-index': String(dayIndex) });
  day.exercises.forEach((ex, exIndex) => list.append(renderExerciseCard(day, dayIndex, ex, exIndex)));
  attachDropZone(list, dayIndex);
  col.append(list);

  col.append(el('button', {
    type: 'button', class: 'fcp-editor-addbtn',
    onclick: () => openPicker({ mode: 'add', dayIndex }),
  }, '+ Добави упражнение'));

  return col;
}

function renderPhaseEditor(day) {
  const warmupTa = el('textarea', {
    oninput: (e) => { day.warmup = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); markDirty(); },
  }, (day.warmup || []).join('\n'));
  const cooldownTa = el('textarea', {
    oninput: (e) => { day.cooldown = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); markDirty(); },
  }, (day.cooldown || []).join('\n'));

  return el('details', { class: 'fcp-editor-phase' },
    el('summary', { text: 'Загрявка / Разпускане' }),
    el('label', { text: 'Загрявка (стъпка на ред)' }), warmupTa,
    el('label', { text: 'Разпускане (стъпка на ред)' }), cooldownTa,
  );
}

function renderExerciseCard(day, dayIndex, ex, exIndex) {
  const card = el('div', {
    class: 'fcp-editor-excard', draggable: 'true',
    'data-day-index': String(dayIndex), 'data-ex-index': String(exIndex),
  });

  card.addEventListener('dragstart', (e) => {
    dragData = { dayIndex, exIndex, dropped: false };
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'ex');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    // Пуснато извън валидна drop зона — DOM може да е било преместено
    // визуално при dragover preview без state да е обновен; пренареждаме
    // от текущия state, за да няма разминаване.
    if (dragData && !dragData.dropped) renderBoard();
    dragData = null;
  });

  const thumb = ex.match?.imageUrl
    ? el('img', { class: 'fcp-editor-ex-thumb', src: ex.match.imageUrl, loading: 'lazy', alt: '' })
    : el('div', { class: 'fcp-editor-ex-thumb' });

  const setsInput = el('input', {
    type: 'number', min: '1', max: '10', value: String(ex.sets ?? 3),
    oninput: (e) => { ex.sets = Math.min(10, Math.max(1, Number(e.target.value) || 1)); markDirty(); },
  });
  const repsInput = el('input', {
    class: 'fcp-editor-reps', type: 'text', value: ex.reps || '',
    oninput: (e) => { ex.reps = e.target.value; markDirty(); },
  });
  const restInput = el('input', {
    type: 'number', min: '15', max: '300', value: String(ex.restSeconds ?? 60),
    oninput: (e) => { ex.restSeconds = Math.min(300, Math.max(15, Number(e.target.value) || 60)); markDirty(); },
  });

  const detailRow = el('div', { class: 'fcp-editor-ex-detail' },
    el('input', {
      type: 'text', placeholder: 'темпо', value: ex.tempo || '', style: 'width:70px;',
      oninput: (e) => { ex.tempo = e.target.value; markDirty(); },
    }),
    el('input', {
      type: 'text', placeholder: 'RPE', value: ex.rpe || '', style: 'width:60px;',
      oninput: (e) => { ex.rpe = e.target.value; markDirty(); },
    }),
    el('textarea', {
      placeholder: 'бележка', style: 'flex:1 1 100%;',
      oninput: (e) => { ex.notes = e.target.value; markDirty(); },
    }, ex.notes || ''),
  );
  const detailToggle = el('button', {
    type: 'button', class: 'fcp-editor-mini-btn', title: 'Темпо / RPE / бележка',
    onclick: () => detailRow.classList.toggle('open'),
  }, '⋯');

  const main = el('div', { class: 'fcp-editor-ex-main' },
    el('div', { class: 'fcp-editor-ex-name', text: ex.displayName || ex.canonicalName || 'Упражнение' }),
    el('div', { class: 'fcp-editor-ex-sub', text: [ex.canonicalName, ex.equipmentHint].filter(Boolean).join(' · ') }),
    el('div', { class: 'fcp-editor-ex-fields' },
      setsInput, el('span', { text: '×' }), repsInput, el('span', { text: 'повт.' }),
      restInput, el('span', { text: 'сек почивка' }),
      detailToggle,
    ),
    detailRow,
  );

  const actions = el('div', { class: 'fcp-editor-ex-actions' },
    el('button', { type: 'button', title: 'Смени упражнението', onclick: () => openPicker({ mode: 'swap', dayIndex, exIndex }) }, '⇄'),
    el('button', {
      type: 'button', title: 'Нагоре', disabled: exIndex === 0,
      onclick: () => { moveExercise(dayIndex, exIndex, dayIndex, exIndex - 1); },
    }, '▲'),
    el('button', {
      type: 'button', title: 'Надолу', disabled: exIndex === day.exercises.length - 1,
      onclick: () => { moveExercise(dayIndex, exIndex, dayIndex, exIndex + 1); },
    }, '▼'),
    el('button', {
      type: 'button', title: 'Изтрий', onclick: () => {
        day.exercises.splice(exIndex, 1);
        markDirty(); renderBoard();
      },
    }, '🗑'),
  );

  card.append(el('div', { class: 'fcp-editor-ex-handle', text: '⠿' }), thumb, main, actions);
  return card;
}

// ============================================================================
// Пренареждане (drag&drop между/в рамките на дни)
// ============================================================================

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.fcp-editor-excard:not(.dragging)')];
  return cards.reduce((closest, cardEl) => {
    const box = cardEl.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: cardEl };
    return closest;
  }, { offset: -Infinity, element: null }).element;
}

function attachDropZone(list, dayIndex) {
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    list.closest('.fcp-editor-day')?.classList.add('drop-hover');
    const after = getDragAfterElement(list, e.clientY);
    const dragging = modal.querySelector('.fcp-editor-excard.dragging');
    if (!dragging) return;
    if (after == null) list.append(dragging);
    else list.insertBefore(dragging, after);
  });
  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) list.closest('.fcp-editor-day')?.classList.remove('drop-hover');
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    list.closest('.fcp-editor-day')?.classList.remove('drop-hover');
    if (!dragData) return;
    dragData.dropped = true;
    const domCards = [...list.querySelectorAll('.fcp-editor-excard')];
    const targetIndex = domCards.findIndex((c) => c.classList.contains('dragging'));
    moveExercise(dragData.dayIndex, dragData.exIndex, dayIndex, targetIndex === -1 ? undefined : targetIndex);
  });
}

function moveExercise(fromDay, fromIndex, toDay, toIndex) {
  const src = state.plan.days[fromDay];
  const dst = state.plan.days[toDay];
  if (!src || !dst) return;
  const [ex] = src.exercises.splice(fromIndex, 1);
  if (!ex) return;
  let insertAt = toIndex ?? dst.exercises.length;
  if (fromDay === toDay && fromIndex < insertAt) insertAt -= 1;
  insertAt = Math.max(0, Math.min(insertAt, dst.exercises.length));
  dst.exercises.splice(insertAt, 0, ex);
  markDirty();
  renderBoard();
}

function swapDayContent(a, b) {
  const days = state.plan.days;
  const keys = ['focus', 'type', 'durationMin', 'warmup', 'cooldown', 'exercises'];
  const tmp = {};
  for (const k of keys) tmp[k] = days[a][k];
  for (const k of keys) days[a][k] = days[b][k];
  for (const k of keys) days[b][k] = tmp[k];
  markDirty();
  renderBoard();
}

// ============================================================================
// Picker — търсене по дума+синоними и филтри (equipment/target/modality/diff)
// ============================================================================

async function ensureFacets() {
  if (facetsCache) return facetsCache;
  try {
    const res = await fetch(`${apiBase()}/api/exercises/search?limit=1&facets=1`);
    const data = await res.json();
    facetsCache = data.facets || { equipment: [], target: [] };
  } catch {
    facetsCache = { equipment: [], target: [] };
  }
  return facetsCache;
}

function openPicker({ mode, dayIndex, exIndex = null }) {
  state.picker = {
    open: true, mode, dayIndex, exIndex,
    q: '', equipment: new Set(), target: new Set(), modality: new Set(), diffMax: null,
  };
  const panel = modal.querySelector('.fcp-editor-panel');
  const picker = el('div', { class: 'fcp-picker' },
    el('div', { class: 'fcp-picker-head' },
      el('h4', { text: mode === 'swap' ? 'Смени упражнението' : 'Добави упражнение' }),
      el('button', { type: 'button', class: 'fcp-modal-close', onclick: () => closePicker() }, '×'),
    ),
    el('div', { class: 'fcp-picker-search' },
      el('input', {
        type: 'text', placeholder: 'Търси по дума (напр. клек, дупе, гребане)…',
        oninput: debounce((e) => { state.picker.q = e.target.value; runPickerSearch(); }, 250),
      }),
    ),
    el('div', { class: 'fcp-picker-filters', id: 'fcpPickerFilters' }),
    el('div', { class: 'fcp-picker-results', id: 'fcpPickerResults' }, '…'),
  );
  panel.append(picker);
  ensureFacets().then((facets) => {
    renderPickerFilters(facets);
    runPickerSearch();
  });
}

function closePicker() {
  if (state) state.picker = null;
  modal.querySelector('.fcp-picker')?.remove();
}

function renderPickerFilters(facets) {
  const wrap = $('#fcpPickerFilters');
  if (!wrap) return;
  wrap.innerHTML = '';

  const modalityRow = el('div', { class: 'fcp-picker-filter-row' }, el('span', { class: 'fcp-picker-flabel', text: 'Тип:' }));
  for (const [value, label] of [['strength', 'Силови'], ['cardio', 'Кардио'], ['hiit', 'HIIT'], ['mobility', 'Мобилност']]) {
    modalityRow.append(el('button', {
      type: 'button', class: 'fcp-picker-chip',
      onclick: (e) => {
        toggleSetValue(state.picker.modality, value);
        e.currentTarget.classList.toggle('active');
        runPickerSearch();
      },
    }, label));
  }
  wrap.append(modalityRow);

  const diffRow = el('div', { class: 'fcp-picker-filter-row' }, el('span', { class: 'fcp-picker-flabel', text: 'Трудност ≤:' }));
  for (const d of [1, 2, 3]) {
    const chip = el('button', {
      type: 'button', class: 'fcp-picker-chip fcp-picker-diff-chip',
      onclick: (e) => {
        const active = state.picker.diffMax === d;
        state.picker.diffMax = active ? null : d;
        wrap.querySelectorAll('.fcp-picker-diff-chip').forEach((b) => b.classList.remove('active'));
        if (!active) e.currentTarget.classList.add('active');
        runPickerSearch();
      },
    }, DIFF_LABELS[d]);
    diffRow.append(chip);
  }
  wrap.append(diffRow);

  if (facets.equipment?.length) {
    const row = el('div', { class: 'fcp-picker-filter-row' }, el('span', { class: 'fcp-picker-flabel', text: 'Оборудване:' }));
    for (const f of facets.equipment.slice(0, 14)) {
      row.append(el('button', {
        type: 'button', class: 'fcp-picker-chip',
        onclick: (e) => {
          toggleSetValue(state.picker.equipment, f.value);
          e.currentTarget.classList.toggle('active');
          runPickerSearch();
        },
      }, `${f.label} (${f.count})`));
    }
    wrap.append(row);
  }

  if (facets.target?.length) {
    const row = el('div', { class: 'fcp-picker-filter-row' }, el('span', { class: 'fcp-picker-flabel', text: 'Мускулна група:' }));
    for (const f of facets.target.slice(0, 20)) {
      row.append(el('button', {
        type: 'button', class: 'fcp-picker-chip',
        onclick: (e) => {
          toggleSetValue(state.picker.target, f.value);
          e.currentTarget.classList.toggle('active');
          runPickerSearch();
        },
      }, `${f.label} (${f.count})`));
    }
    wrap.append(row);
  }
}

function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

async function runPickerSearch() {
  const results = $('#fcpPickerResults');
  if (!results) return;
  results.innerHTML = '<p class="fcp-picker-empty">Търсене…</p>';
  const p = state.picker;
  const params = new URLSearchParams({ limit: '40' });
  if (p.q) params.set('q', p.q);
  if (p.equipment.size) params.set('equipment', [...p.equipment].join(','));
  if (p.target.size) params.set('target', [...p.target].join(','));
  if (p.modality.size) params.set('modality', [...p.modality].join(','));
  if (p.diffMax != null) params.set('diffMax', String(p.diffMax));

  try {
    const res = await fetch(`${apiBase()}/api/exercises/search?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Грешка при търсене');
    renderPickerResults(data.results || []);
  } catch (e) {
    results.innerHTML = `<p class="fcp-picker-empty">Грешка: ${escapeHtml(e.message)}</p>`;
  }
}

function renderPickerResults(items) {
  const results = $('#fcpPickerResults');
  results.innerHTML = '';
  if (!items.length) {
    results.append(el('p', { class: 'fcp-picker-empty', text: 'Няма съвпадения — опитай друга дума/филтър.' }));
    return;
  }
  for (const item of items) {
    const row = el('div', { class: 'fcp-picker-row', onclick: () => pickExercise(item) },
      item.imageUrl ? el('img', { src: item.imageUrl, loading: 'lazy', alt: '' }) : el('div', { class: 'fcp-editor-ex-thumb' }),
      el('div', { class: 'fcp-picker-row-main' },
        el('div', { class: 'fcp-picker-row-name', text: item.displayName || item.name }),
        el('div', { class: 'fcp-picker-row-sub', text: item.name }),
        el('div', { class: 'fcp-picker-badges' },
          el('span', { class: 'fcp-picker-badge', text: `d${item.diff ?? 2}` }),
          item.equipment ? el('span', { class: 'fcp-picker-badge', text: item.equipment }) : null,
          item.target ? el('span', { class: 'fcp-picker-badge', text: item.target }) : null,
        ),
      ),
    );
    results.append(row);
  }
}

function pickExercise(item) {
  const p = state.picker;
  const day = state.plan.days[p.dayIndex];
  if (!day) return;

  if (p.mode === 'swap' && p.exIndex != null) {
    const ex = day.exercises[p.exIndex];
    ex.displayName = item.displayName || item.name;
    ex.canonicalName = item.name;
    ex.equipmentHint = item.equipment || '';
    ex.bodyPart = item.bodyPart || item.target || '';
    ex.match = { imageUrl: item.imageUrl, gifUrl: item.gifUrl };
  } else {
    day.exercises.push({
      displayName: item.displayName || item.name,
      canonicalName: item.name,
      equipmentHint: item.equipment || '',
      bodyPart: item.bodyPart || item.target || '',
      sets: 3, reps: '10', restSeconds: 60, tempo: '', rpe: '', notes: '',
      match: { imageUrl: item.imageUrl, gifUrl: item.gifUrl },
    });
  }
  markDirty();
  closePicker();
  renderBoard();
}

window.FcpProgramEditor = { open, close };
