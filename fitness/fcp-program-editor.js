/**
 * KA-TRAINER — админ редактор на клиентска програма.
 * Мобилно-първи: ден-пилюли + едно видимо съдържание на ден.
 * Минимални бекенд заявки: 1× зареждане на план, 1× запис; picker с кеш + abort.
 */
import { el } from './wizard-ui.js?v=2';

const DAY_TYPES = [
  ['strength', 'Сила'],
  ['cardio', 'Кардио'],
  ['hiit', 'HIIT'],
  ['mobility', 'Мобилност'],
  ['active-recovery', 'Активно възст.'],
  ['rest', 'Почивка'],
];
const DAY_TYPE_LABELS = Object.fromEntries(DAY_TYPES);
const DAY_SHORT = ['Пон', 'Вто', 'Сря', 'Чет', 'Пет', 'Съб', 'Нед'];
const DIFF_LABELS = { 1: 'd1 лесно', 2: 'd2 средно', 3: 'd3 трудно' };
const FACETS_SESSION_KEY = 'fcp.editor.facets.v1';
const SEARCH_CACHE_MAX = 48;

const CAN_DRAG = typeof window !== 'undefined'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

let modal = null;
let state = null;
let facetsCache = null;
let dragData = null;
let searchAbort = null;
let searchSeq = 0;
const searchCache = new Map();

const $ = (sel, root = modal) => root?.querySelector(sel);

function apiBase() {
  return window.FITPLAN_WORKER_URL || '';
}
function adminHeaders() {
  return window.fitplanAdminHeaders?.() || { 'Content-Type': 'application/json' };
}

function debounce(fn, ms) {
  let t = null;
  const debounced = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  debounced.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return debounced;
}

const debouncedSearch = debounce(() => runPickerSearch(), 400);

function loadFacetsFromSession() {
  if (facetsCache) return;
  try {
    const raw = sessionStorage.getItem(FACETS_SESSION_KEY);
    if (raw) facetsCache = JSON.parse(raw);
  } catch { /* noop */ }
}

function persistFacets() {
  if (!facetsCache) return;
  try { sessionStorage.setItem(FACETS_SESSION_KEY, JSON.stringify(facetsCache)); } catch { /* noop */ }
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ensureModal() {
  if (modal) return;
  loadFacetsFromSession();

  modal = el('div', { class: 'fcp-modal', id: 'fcpEditorModal', hidden: true, role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'fcp-modal-backdrop' }),
    el('div', { class: 'fcp-modal-panel fcp-editor-panel', style: 'position:relative;' },
      el('div', { class: 'fcp-modal-head fcp-editor-head' },
        el('h3', { id: 'fcpEditorTitle', text: 'Редактор на програма' }),
        el('div', { class: 'fcp-editor-head-actions' },
          el('span', { id: 'fcpEditorStatus' }),
          el('button', {
            type: 'button', class: 'fcp-editor-save', id: 'fcpEditorSaveBtn', disabled: true,
            onclick: () => save(),
          }, 'Запази'),
          el('button', { type: 'button', class: 'fcp-modal-close', 'aria-label': 'Затвори', onclick: () => close() }, '×'),
        ),
      ),
      el('div', { class: 'fcp-editor-body', id: 'fcpEditorBody' },
        el('div', { class: 'fcp-editor-daypills', id: 'fcpEditorDayPills' }),
        el('div', { class: 'fcp-editor-daypanel', id: 'fcpEditorDayPanel' }),
      ),
    ),
  );
  document.body.append(modal);
  modal.querySelector('.fcp-modal-backdrop').addEventListener('click', () => close());
  bindDropDelegation();
  document.addEventListener('keydown', (e) => {
    if (!modal || modal.hidden) return;
    if (e.key === 'Escape') {
      if (state?.picker?.open) closePicker();
      else close();
    }
  });
}

function bindDropDelegation() {
  const panel = $('#fcpEditorDayPanel');
  if (!panel || panel.dataset.dropBound === '1') return;
  panel.dataset.dropBound = '1';

  panel.addEventListener('dragover', (e) => {
    if (!CAN_DRAG || !dragData) return;
    const list = e.target.closest('#fcpEditorExList');
    if (!list) return;
    e.preventDefault();
    const after = getDragAfterElement(list, e.clientY);
    const dragging = list.querySelector('.fcp-editor-excard.dragging');
    if (!dragging) return;
    if (after == null) list.append(dragging);
    else list.insertBefore(dragging, after);
  });

  panel.addEventListener('drop', (e) => {
    if (!CAN_DRAG || !dragData) return;
    const list = e.target.closest('#fcpEditorExList');
    if (!list) return;
    e.preventDefault();
    dragData.dropped = true;
    const domCards = [...list.querySelectorAll('.fcp-editor-excard')];
    const targetIndex = domCards.findIndex((c) => c.classList.contains('dragging'));
    moveExercise(dragData.dayIndex, dragData.exIndex, state.activeDayIndex, targetIndex === -1 ? undefined : targetIndex);
    dragData = null;
  });
}

export async function open(program) {
  ensureModal();
  const id = program?.id;
  if (!id) return;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#fcpEditorTitle').textContent = `Редактор — ${program.clientName || ''}`.trim();
  $('#fcpEditorDayPills').innerHTML = '';
  $('#fcpEditorDayPanel').innerHTML = '<p class="fcp-editor-loading"><i class="fas fa-spinner fa-spin"></i> Зареждане…</p>';
  setStatus('');
  state = { programId: id, planId: null, plan: null, dirty: false, activeDayIndex: 0, picker: null, openDetails: new Set() };

  try {
    const res = await fetch(`${apiBase()}/api/admin/fitplan/client-programs/${encodeURIComponent(id)}/plan`, {
      headers: adminHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Грешка при зареждане');
    state.planId = data.planId;
    state.plan = data.plan;
    state.activeDayIndex = firstUsefulDayIndex(state.plan);
    renderBoard();
  } catch (e) {
    $('#fcpEditorDayPanel').innerHTML = `<p class="fcp-editor-error">Грешка: ${escapeHtml(e.message)}</p>`;
  }
}

export function close() {
  if (!modal) return;
  if (state?.picker?.open) {
    closePicker();
    return;
  }
  if (state?.dirty && !confirm('Има незапазени промени. Затвори без запис?')) return;
  searchAbort?.abort();
  modal.hidden = true;
  document.body.style.overflow = '';
  state = null;
}

function firstUsefulDayIndex(plan) {
  const idx = plan.days.findIndex((d) => d.type !== 'rest' && d.exercises?.length);
  return idx === -1 ? 0 : idx;
}

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
    renderBoard({ preserveScroll: true });
    setStatus('Запазено ✓');
    window.patchFcpProgramCache?.(state.programId, {
      planTitle: state.plan.title || data.program?.planTitle,
      updatedAt: data.program?.updatedAt,
    });
  } catch (e) {
    btn.disabled = false;
    setStatus(`Грешка: ${e.message}`, true);
  }
}

function renderBoard({ preserveScroll = false } = {}) {
  renderDayPills();
  renderDayPanel({ preserveScroll });
}

function renderDayPills() {
  const pills = $('#fcpEditorDayPills');
  pills.innerHTML = '';
  state.plan.days.forEach((day, i) => {
    const count = day.exercises?.length || 0;
    const cls = [
      'fcp-editor-pill',
      i === state.activeDayIndex ? 'active' : '',
      day.type === 'rest' ? 'rest' : '',
    ].filter(Boolean).join(' ');
    pills.append(el('button', {
      type: 'button', class: cls,
      onclick: () => {
        if (state.activeDayIndex === i) return;
        state.activeDayIndex = i;
        renderBoard();
      },
    },
      el('strong', { text: DAY_SHORT[i] || day.day.slice(0, 3) }),
      el('small', { text: day.type === 'rest' ? 'почивка' : (day.focus || DAY_TYPE_LABELS[day.type] || day.type) }),
      count ? el('span', { class: 'fcp-editor-pill-count', text: String(count) }) : null,
    ));
  });
}

function renderDayPanel({ preserveScroll = false } = {}) {
  const panel = $('#fcpEditorDayPanel');
  const scrollTop = preserveScroll ? panel.scrollTop : 0;
  panel.innerHTML = '';

  const dayIndex = state.activeDayIndex;
  const day = state.plan.days[dayIndex];
  if (!day) return;

  const typeSelect = el('select', { class: 'fcp-editor-type' });
  for (const [value, label] of DAY_TYPES) {
    typeSelect.append(el('option', { value, ...(day.type === value ? { selected: true } : {}) }, label));
  }
  typeSelect.addEventListener('change', () => {
    day.type = typeSelect.value;
    markDirty();
    renderDayPills();
  });

  const focusInput = el('input', {
    class: 'fcp-editor-focus', type: 'text', value: day.focus || '', placeholder: 'Фокус на деня (напр. Гръб и бицепс)',
    oninput: (e) => { day.focus = e.target.value; markDirty(); },
  });

  const durationInput = el('input', {
    type: 'number', min: '0', inputmode: 'numeric', value: day.durationMin ?? '',
    oninput: (e) => { day.durationMin = Number(e.target.value) || null; markDirty(); },
  });

  const swapSelect = el('select', {},
    el('option', { value: '' }, 'размени с друг ден…'),
    ...state.plan.days.map((d, i) => (i === dayIndex ? null : el('option', { value: String(i) }, `${d.day} (${d.exercises?.length || 0} упр.)`))).filter(Boolean),
  );
  const swapBtn = el('button', {
    type: 'button', class: 'fcp-editor-mini-btn', title: 'Размени съдържанието на двата дни',
    onclick: () => {
      const target = Number(swapSelect.value);
      if (!Number.isInteger(target)) return setStatus('Избери ден за размяна', true);
      swapDayContent(dayIndex, target);
      swapSelect.value = '';
      setStatus(`Разменено с ${state.plan.days[target].day}`);
    },
  }, '⇄');

  panel.append(
    el('div', { class: 'fcp-editor-day-head' },
      el('div', { class: 'fcp-editor-field' }, el('label', { text: `${day.day} — фокус` }), focusInput),
      el('div', { class: 'fcp-editor-day-row2' },
        el('div', { class: 'fcp-editor-field' }, el('label', { text: 'Тип' }), typeSelect),
        el('div', { class: 'fcp-editor-field' },
          el('label', { text: 'Продължителност' }),
          el('div', { class: 'fcp-editor-duration-wrap' }, durationInput, el('span', { text: 'мин' })),
        ),
      ),
      el('div', { class: 'fcp-editor-field' }, el('label', { text: 'Размяна с друг ден' }), el('div', { class: 'fcp-editor-day-swap' }, swapSelect, swapBtn)),
    ),
    renderPhaseEditor(day),
    el('div', { class: 'fcp-editor-section-title', text: `Упражнения (${day.exercises?.length || 0})` }),
  );

  const list = el('div', { class: 'fcp-editor-exlist', id: 'fcpEditorExList' });
  if (!day.exercises?.length) {
    list.append(el('div', { class: 'fcp-editor-empty', text: day.type === 'rest' ? 'Почивен ден — без упражнения.' : 'Няма добавени упражнения.' }));
  } else {
    day.exercises.forEach((ex, exIndex) => list.append(renderExerciseCard(day, dayIndex, ex, exIndex)));
  }
  panel.append(list);

  panel.append(el('button', {
    type: 'button', class: 'fcp-editor-addbtn',
    onclick: () => openPicker({ mode: 'add', dayIndex }),
  }, '+ Добави упражнение'));

  requestAnimationFrame(() => { panel.scrollTop = scrollTop; });
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
    el('label', { text: 'Загрявка (по стъпка на ред)' }), warmupTa,
    el('label', { text: 'Разпускане (по стъпка на ред)' }), cooldownTa,
  );
}

function renderExerciseCard(day, dayIndex, ex, exIndex) {
  const detailKey = `${dayIndex}-${exIndex}`;
  const card = el('div', {
    class: 'fcp-editor-excard',
    draggable: CAN_DRAG ? 'true' : 'false',
    'data-ex-index': String(exIndex),
  });

  if (CAN_DRAG) {
    card.addEventListener('dragstart', (e) => {
      dragData = { dayIndex, exIndex, dropped: false };
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'ex');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      if (dragData && !dragData.dropped) dragData = null;
    });
  }

  const thumb = ex.match?.imageUrl
    ? el('img', { class: 'fcp-editor-ex-thumb', src: ex.match.imageUrl, loading: 'lazy', alt: '' })
    : el('div', { class: 'fcp-editor-ex-thumb' });

  const setsInput = el('input', {
    type: 'number', inputmode: 'numeric', min: '1', max: '10', value: String(ex.sets ?? 3),
    oninput: (e) => { ex.sets = Math.min(10, Math.max(1, Number(e.target.value) || 1)); markDirty(); },
  });
  const repsInput = el('input', {
    type: 'text', value: ex.reps || '',
    oninput: (e) => { ex.reps = e.target.value; markDirty(); },
  });
  const restInput = el('input', {
    type: 'number', inputmode: 'numeric', min: '15', max: '300', value: String(ex.restSeconds ?? 60),
    oninput: (e) => { ex.restSeconds = Math.min(300, Math.max(15, Number(e.target.value) || 60)); markDirty(); },
  });

  const detailRow = el('div', {
    class: `fcp-editor-ex-detail${state.openDetails.has(detailKey) ? ' open' : ''}`,
    'data-detail-key': detailKey,
  },
    el('input', {
      type: 'text', placeholder: 'темпо (напр. 2-0-2)', value: ex.tempo || '', class: 'fcp-editor-ex-tempo',
      oninput: (e) => { ex.tempo = e.target.value; markDirty(); },
    }),
    el('input', {
      type: 'text', placeholder: 'RPE', value: ex.rpe || '', class: 'fcp-editor-ex-rpe',
      oninput: (e) => { ex.rpe = e.target.value; markDirty(); },
    }),
    el('textarea', {
      placeholder: 'бележка за клиента', class: 'fcp-editor-ex-notes',
      oninput: (e) => { ex.notes = e.target.value; markDirty(); },
    }, ex.notes || ''),
  );
  const detailToggle = el('button', {
    type: 'button', class: 'fcp-editor-ex-detail-toggle',
    onclick: () => {
      detailRow.classList.toggle('open');
      if (detailRow.classList.contains('open')) state.openDetails.add(detailKey);
      else state.openDetails.delete(detailKey);
    },
  }, state.openDetails.has(detailKey) ? '▴ Скрий детайли' : '▾ Темпо / RPE / бележка');

  const main = el('div', { class: 'fcp-editor-ex-main' },
    el('div', { class: 'fcp-editor-ex-name', text: ex.displayName || ex.canonicalName || 'Упражнение' }),
    el('div', { class: 'fcp-editor-ex-sub', text: [ex.canonicalName, ex.equipmentHint].filter(Boolean).join(' · ') }),
  );

  const fields = el('div', { class: 'fcp-editor-ex-fields' },
    el('div', {}, el('label', { text: 'Серии' }), setsInput),
    el('div', {}, el('label', { text: 'Повторения' }), repsInput),
    el('div', {}, el('label', { text: 'Почивка, сек' }), restInput),
  );

  const moveSelect = el('select', { class: 'fcp-editor-ex-moveto-select' },
    el('option', { value: '', selected: true }, 'премести в ден…'),
    ...state.plan.days.map((d, i) => (i === dayIndex ? null : el('option', { value: String(i) }, d.day))).filter(Boolean),
  );
  moveSelect.addEventListener('change', () => {
    const target = Number(moveSelect.value);
    if (!Number.isInteger(target)) return;
    moveExercise(dayIndex, exIndex, target, undefined);
    setStatus(`Преместено в ${state.plan.days[target].day}`);
  });

  const actions = el('div', { class: 'fcp-editor-ex-actions' },
    el('button', { type: 'button', class: 'fcp-editor-action-swap', onclick: () => openPicker({ mode: 'swap', dayIndex, exIndex }) }, '⇄ Смени'),
    el('div', { class: 'fcp-editor-ex-moveto' }, moveSelect),
    el('button', {
      type: 'button', class: 'fcp-editor-action-up', title: 'Нагоре', disabled: exIndex === 0,
      onclick: () => moveExercise(dayIndex, exIndex, dayIndex, exIndex - 1),
    }, '▲'),
    el('button', {
      type: 'button', class: 'fcp-editor-action-down', title: 'Надолу', disabled: exIndex === day.exercises.length - 1,
      onclick: () => moveExercise(dayIndex, exIndex, dayIndex, exIndex + 1),
    }, '▼'),
    el('button', {
      type: 'button', class: 'danger fcp-editor-action-del', title: 'Изтрий',
      onclick: () => {
        if (!confirm(`Изтрий „${ex.displayName || ex.canonicalName || 'упражнение'}“?`)) return;
        day.exercises.splice(exIndex, 1);
        markDirty();
        renderBoard({ preserveScroll: true });
      },
    }, '🗑'),
  );

  card.append(
    el('div', { class: 'fcp-editor-ex-top' },
      CAN_DRAG ? el('div', { class: 'fcp-editor-ex-handle', text: '⠿', title: 'Плъзни за пренареждане' }) : null,
      thumb,
      main,
    ),
    fields,
    detailToggle,
    detailRow,
    actions,
  );
  return card;
}

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.fcp-editor-excard:not(.dragging)')];
  return cards.reduce((closest, cardEl) => {
    const box = cardEl.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: cardEl };
    return closest;
  }, { offset: -Infinity, element: null }).element;
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
  if (toDay !== fromDay) state.activeDayIndex = toDay;
  markDirty();
  renderBoard({ preserveScroll: true });
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
// Picker
// ============================================================================

function buildSearchParams(p) {
  const params = new URLSearchParams({ limit: '40' });
  if (p.q?.trim()) params.set('q', p.q.trim());
  if (p.equipment.size) params.set('equipment', [...p.equipment].join(','));
  if (p.target.size) params.set('target', [...p.target].join(','));
  if (p.modality.size) params.set('modality', [...p.modality].join(','));
  if (p.diffMax != null) params.set('diffMax', String(p.diffMax));
  const needsFacets = !facetsCache;
  if (needsFacets) params.set('facets', '1');
  return { params, needsFacets };
}

function pickerHasActiveFilters(p) {
  return Boolean(p.q?.trim()) || p.equipment.size || p.target.size || p.modality.size || p.diffMax != null;
}

function openPicker({ mode, dayIndex, exIndex = null }) {
  state.picker = {
    open: true, mode, dayIndex, exIndex,
    q: '', equipment: new Set(), target: new Set(), modality: new Set(), diffMax: null,
  };
  const panel = modal.querySelector('.fcp-editor-panel');
  const searchInput = el('input', {
    type: 'search', enterkeyhint: 'search', autocomplete: 'off',
    placeholder: 'Търси (клек, дупе, гребане…)',
    oninput: (e) => {
      state.picker.q = e.target.value;
      debouncedSearch();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        state.picker.q = e.target.value;
        debouncedSearch.flush();
      }
    },
  });

  const picker = el('div', { class: 'fcp-picker' },
    el('div', { class: 'fcp-picker-top' },
      el('div', { class: 'fcp-picker-head' },
        el('h4', { text: mode === 'swap' ? 'Смени упражнението' : 'Добави упражнение' }),
        el('button', { type: 'button', class: 'fcp-modal-close', 'aria-label': 'Затвори', onclick: () => closePicker() }, '×'),
      ),
      el('div', { class: 'fcp-picker-search' }, searchInput),
    ),
    el('div', { class: 'fcp-picker-filters', id: 'fcpPickerFilters' }),
    el('div', { class: 'fcp-picker-results-bar' },
      el('span', { class: 'fcp-picker-results-hint', id: 'fcpPickerResultsHint', text: 'Резултати' }),
      el('button', {
        type: 'button', class: 'fcp-picker-clear-btn hidden', id: 'fcpPickerClearBtn',
        onclick: () => clearPickerFilters(),
      }, 'Изчисти филтрите'),
    ),
    el('div', { class: 'fcp-picker-results', id: 'fcpPickerResults' }, '…'),
  );
  panel.append(picker);
  searchInput.focus({ preventScroll: true });
  if (facetsCache) renderPickerFilters(facetsCache);
  runPickerSearch();
}

function closePicker() {
  searchAbort?.abort();
  if (state) state.picker = null;
  modal.querySelector('.fcp-picker')?.remove();
}

function updateClearFiltersBtn() {
  const btn = $('#fcpPickerClearBtn');
  if (!btn || !state?.picker) return;
  btn.classList.toggle('hidden', !pickerHasActiveFilters(state.picker));
}

function clearPickerFilters() {
  if (!state?.picker) return;
  const p = state.picker;
  p.q = '';
  p.equipment.clear();
  p.target.clear();
  p.modality.clear();
  p.diffMax = null;
  const input = modal.querySelector('.fcp-picker-search input');
  if (input) input.value = '';
  if (facetsCache) renderPickerFilters(facetsCache);
  runPickerSearch();
}

function makePickerChip(label, isActive, onClick, extraClass = '') {
  return el('button', {
    type: 'button',
    class: `fcp-picker-chip${extraClass ? ` ${extraClass}` : ''}${isActive ? ' active' : ''}`,
    onclick: onClick,
  }, label);
}

function renderPickerFilters(facets) {
  const wrap = $('#fcpPickerFilters');
  if (!wrap || !state?.picker) return;
  wrap.innerHTML = '';
  const p = state.picker;

  const primary = el('div', { class: 'fcp-picker-filters-primary' });

  const modalityRow = el('div', { class: 'fcp-picker-filter-row' }, el('span', { class: 'fcp-picker-flabel', text: 'Тип упражнение' }));
  for (const [value, label] of [['strength', 'Силови'], ['cardio', 'Кардио'], ['hiit', 'HIIT'], ['mobility', 'Мобилност']]) {
    modalityRow.append(makePickerChip(label, p.modality.has(value), (e) => {
      toggleSetValue(p.modality, value);
      e.currentTarget.classList.toggle('active');
      runPickerSearch();
    }));
  }
  primary.append(modalityRow);

  const diffRow = el('div', { class: 'fcp-picker-filter-row' }, el('span', { class: 'fcp-picker-flabel', text: 'Трудност' }));
  for (const d of [1, 2, 3]) {
    diffRow.append(makePickerChip(DIFF_LABELS[d], p.diffMax === d, (e) => {
      const active = p.diffMax === d;
      p.diffMax = active ? null : d;
      wrap.querySelectorAll('.fcp-picker-diff-chip').forEach((b) => b.classList.remove('active'));
      if (!active) e.currentTarget.classList.add('active');
      runPickerSearch();
    }, 'fcp-picker-diff-chip'));
  }
  primary.append(diffRow);
  wrap.append(primary);

  const hasAdvanced = facets.equipment?.length || facets.target?.length;
  if (!hasAdvanced) {
    updateClearFiltersBtn();
    return;
  }

  const activeAdvanced = p.equipment.size + p.target.size;
  const advanced = el('details', { class: 'fcp-picker-filters-advanced', ...(activeAdvanced ? { open: true } : {}) });
  advanced.append(el('summary', { class: 'fcp-picker-advanced-summary' },
    el('span', { text: 'Оборудване и мускулна група' }),
    activeAdvanced ? el('span', { class: 'fcp-picker-filter-count', text: String(activeAdvanced) }) : null,
  ));

  const body = el('div', { class: 'fcp-picker-filters-advanced-body' });

  if (facets.equipment?.length) {
    const row = el('div', { class: 'fcp-picker-filter-row' }, el('span', { class: 'fcp-picker-flabel', text: 'Оборудване' }));
    for (const f of facets.equipment.slice(0, 14)) {
      row.append(makePickerChip(`${f.label} (${f.count})`, p.equipment.has(f.value), (e) => {
        toggleSetValue(p.equipment, f.value);
        e.currentTarget.classList.toggle('active');
        const count = p.equipment.size + p.target.size;
        const badge = advanced.querySelector('.fcp-picker-filter-count');
        if (count && !badge) {
          advanced.querySelector('.fcp-picker-advanced-summary')?.append(
            el('span', { class: 'fcp-picker-filter-count', text: String(count) }),
          );
        } else if (badge) badge.textContent = String(count);
        if (!count) badge?.remove();
        runPickerSearch();
      }));
    }
    body.append(row);
  }

  if (facets.target?.length) {
    const row = el('div', { class: 'fcp-picker-filter-row' }, el('span', { class: 'fcp-picker-flabel', text: 'Мускулна група' }));
    for (const f of facets.target.slice(0, 20)) {
      row.append(makePickerChip(`${f.label} (${f.count})`, p.target.has(f.value), (e) => {
        toggleSetValue(p.target, f.value);
        e.currentTarget.classList.toggle('active');
        runPickerSearch();
      }));
    }
    body.append(row);
  }

  advanced.append(body);
  wrap.append(advanced);
  updateClearFiltersBtn();
}

function toggleSetValue(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

async function runPickerSearch() {
  const results = $('#fcpPickerResults');
  if (!results || !state?.picker) return;
  const p = state.picker;
  const { params, needsFacets } = buildSearchParams(p);
  const cacheKey = params.toString();

  updateClearFiltersBtn();

  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (needsFacets && cached.facets) {
      facetsCache = cached.facets;
      persistFacets();
      renderPickerFilters(facetsCache);
    }
    renderPickerResults(cached.results || [], cached.total);
    return;
  }

  searchAbort?.abort();
  searchAbort = new AbortController();
  const seq = ++searchSeq;
  results.innerHTML = '<p class="fcp-picker-empty"><i class="fas fa-spinner fa-spin"></i> Търсене…</p>';

  try {
    const res = await fetch(`${apiBase()}/api/exercises/search?${cacheKey}`, { signal: searchAbort.signal });
    const data = await res.json();
    if (seq !== searchSeq) return;
    if (!res.ok || !data.success) throw new Error(data.message || 'Грешка при търсене');

    if (needsFacets && data.facets) {
      facetsCache = data.facets;
      persistFacets();
      renderPickerFilters(facetsCache);
    }

    if (searchCache.size >= SEARCH_CACHE_MAX) {
      searchCache.delete(searchCache.keys().next().value);
    }
    searchCache.set(cacheKey, { results: data.results || [], total: data.total, facets: data.facets || null });

    renderPickerResults(data.results || [], data.total);
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (seq !== searchSeq) return;
    results.innerHTML = `<p class="fcp-picker-empty">Грешка: ${escapeHtml(e.message)}</p>`;
  }
}

function renderPickerResults(items, total) {
  const results = $('#fcpPickerResults');
  const hint = $('#fcpPickerResultsHint');
  results.innerHTML = '';
  const shown = items.length;
  const totalCount = total ?? shown;
  if (hint) {
    hint.textContent = shown
      ? (totalCount > shown ? `Резултати ${shown} от ${totalCount}` : `Резултати (${shown})`)
      : 'Резултати';
  }
  if (!items.length) {
    results.append(el('p', { class: 'fcp-picker-empty', text: 'Няма съвпадения — опитай друга дума или махни филтър.' }));
    return;
  }
  for (const item of items) {
    results.append(el('button', { type: 'button', class: 'fcp-picker-row', onclick: () => pickExercise(item) },
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
    ));
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
    day.exercises = day.exercises || [];
    if (day.type === 'rest') day.type = 'strength';
    const last = day.exercises[day.exercises.length - 1];
    day.exercises.push({
      displayName: item.displayName || item.name,
      canonicalName: item.name,
      equipmentHint: item.equipment || '',
      bodyPart: item.bodyPart || item.target || '',
      sets: last?.sets ?? 3,
      reps: last?.reps ?? '10',
      restSeconds: last?.restSeconds ?? 60,
      tempo: '', rpe: '', notes: '',
      match: { imageUrl: item.imageUrl, gifUrl: item.gifUrl },
    });
  }
  markDirty();
  closePicker();
  renderBoard({ preserveScroll: true });
}

window.FcpProgramEditor = { open, close };
