/**
 * Избор на конкретни уреди — fullscreen sheet + обобщение за въпросника.
 * Клиентски каталог — без бекенд заявки.
 */
import {
  APPARATUS_CATEGORIES,
  APPARATUS_EQUIP_TYPES,
  APPARATUS_ZONES,
  GYM_APPARATUS,
  apparatusById,
  categoryLabel,
  computeApparatusFacets,
  groupApparatusByZone,
  targetLabelFor,
  zoneLabel,
  searchApparatus,
} from './equipment-apparatus.js';
import { apparatusThumbUrl } from './equipment-media.js';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

function debounce(fn, ms = 140) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const CATEGORY_ICON = {
  machine: '⚙',
  cable: '↕',
  bench: '▭',
  rack: '▣',
  cardio: '♥',
};

let activeOverlay = null;

function renderThumb(item, className = 'equip-picker-thumb') {
  const src = apparatusThumbUrl(item);
  if (src) {
    return el('img', { class: className, src, loading: 'lazy', decoding: 'async', alt: '' });
  }
  return el('span', {
    class: `${className} equip-picker-thumb-fallback`,
    text: CATEGORY_ICON[item.category] || '◆',
    'aria-hidden': 'true',
  });
}

function buildPickerState(getSelected, selected) {
  return {
    picked: new Set(getSelected?.() || selected || []),
    zone: 'all',
    category: 'all',
    equip: 'all',
    q: '',
    filtersOpen: false,
    collapsed: new Set(APPARATUS_ZONES.filter((z) => z.id !== 'all').map((z) => z.id)),
    facets: computeApparatusFacets(),
  };
}

function renderItem(item, picked, onToggle) {
  const active = picked.has(item.id);
  const row = el('button', {
    type: 'button',
    class: `equip-picker-item${active ? ' active' : ''}`,
    onclick: (e) => { e.stopPropagation(); onToggle(item.id); },
  });
  row.append(
    renderThumb(item),
    el('span', { class: 'equip-picker-item-body' },
      el('span', { class: 'equip-picker-item-label', text: item.label }),
      item.subtitle ? el('span', { class: 'equip-picker-item-sub', text: item.subtitle }) : null,
      el('span', { class: 'equip-picker-item-meta' },
        el('span', { class: 'equip-picker-badge', text: targetLabelFor(item) }),
        el('span', { class: 'equip-picker-badge equip-picker-badge-muted', text: categoryLabel(item.category) }),
      ),
    ),
    el('span', { class: 'equip-picker-check', text: active ? '✓' : '' }),
  );
  return row;
}

/**
 * @param {HTMLElement} root
 * @param {{ state: ReturnType<typeof buildPickerState>, onChange?: (ids: string[]) => void, onDone?: () => void, fullscreen?: boolean }} ctx
 */
function mountPickerUi(root, ctx) {
  const { state, onChange, onDone, fullscreen = false } = ctx;
  const { picked } = state;

  root.classList.add('equip-picker');
  if (fullscreen) root.classList.add('equip-picker--fullscreen');
  root.innerHTML = '';

  const top = el('div', { class: 'equip-picker-top' });
  const meta = el('p', { class: 'equip-picker-meta' });
  const actions = el('div', { class: 'equip-picker-actions' });

  const zoneRail = el('div', { class: 'equip-picker-zone-rail' });
  const zoneScroll = el('div', { class: 'equip-picker-zone-scroll' });

  const filterToggle = el('button', {
    type: 'button',
    class: 'equip-picker-filter-toggle',
    text: 'Филтри',
    onclick: (e) => {
      e.stopPropagation();
      state.filtersOpen = !state.filtersOpen;
      paintFilters();
    },
  });

  const filtersPanel = el('div', { class: 'equip-picker-filters-panel', hidden: true });
  const categoryRow = el('div', { class: 'equip-picker-filter-row' });
  const equipRow = el('div', { class: 'equip-picker-filter-row' });

  const search = el('input', {
    type: 'search',
    class: 'equip-picker-search',
    placeholder: 'Търси уред, зона, преса, кабел…',
    autocomplete: 'off',
    enterkeyhint: 'search',
    onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => e.stopPropagation(),
    oninput: debounce((e) => { state.q = e.target.value; paintList(); paintMeta(); }),
  });

  const selectedHost = el('div', { class: 'equip-picker-selected' });
  const scroll = el('div', { class: 'equip-picker-scroll' });

  top.append(meta, actions);
  zoneRail.append(zoneScroll, filterToggle);
  filtersPanel.append(categoryRow, equipRow);
  root.append(top, search, zoneRail, filtersPanel, selectedHost, scroll);

  const visibleItems = () => searchApparatus({
    query: state.q,
    category: state.category,
    zone: state.zone,
    equip: state.equip,
  });

  const paintMeta = () => {
    const visible = visibleItems();
    const parts = [`${visible.length} от ${GYM_APPARATUS.length}`];
    if (picked.size) parts.push(`${picked.size} избрани`);
    meta.textContent = parts.join(' · ');
    actions.innerHTML = '';
    if (visible.length) {
      actions.append(el('button', {
        type: 'button',
        class: 'equip-picker-action',
        text: 'Избери видимите',
        onclick: (e) => {
          e.stopPropagation();
          for (const item of visible) picked.add(item.id);
          onChange?.([...picked]);
          paintSelected();
          paintList();
          paintMeta();
          paintZones();
        },
      }));
    }
    if (picked.size) {
      actions.append(el('button', {
        type: 'button',
        class: 'equip-picker-action equip-picker-action-muted',
        text: 'Изчисти',
        onclick: (e) => {
          e.stopPropagation();
          picked.clear();
          onChange?.([]);
          paintSelected();
          paintList();
          paintMeta();
        },
      }));
    }
    filterToggle.classList.toggle('active', state.filtersOpen || state.category !== 'all' || state.equip !== 'all');
    const extra = (state.category !== 'all' ? 1 : 0) + (state.equip !== 'all' ? 1 : 0);
    filterToggle.textContent = extra ? `Филтри (${extra})` : 'Филтри';
  };

  const paintSelected = () => {
    selectedHost.innerHTML = '';
    if (!picked.size) {
      selectedHost.hidden = true;
      return;
    }
    selectedHost.hidden = false;
    for (const id of picked) {
      const item = apparatusById(id);
      const chip = el('button', {
        type: 'button',
        class: 'equip-picker-sel-chip',
        title: 'Премахни',
        onclick: (e) => {
          e.stopPropagation();
          picked.delete(id);
          onChange?.([...picked]);
          paintSelected();
          paintList();
          paintMeta();
          paintZones();
        },
      });
      const thumbSrc = apparatusThumbUrl(item);
      if (thumbSrc) chip.append(el('img', { class: 'equip-picker-chip-thumb', src: thumbSrc, loading: 'lazy', alt: '' }));
      const label = item?.label || id;
      chip.append(el('span', { class: 'equip-picker-chip-text', text: `${label} ×` }));
      selectedHost.append(chip);
    }
  };

  const makeChip = (label, active, count, onPick) => el('button', {
    type: 'button',
    class: `equip-picker-filter${active ? ' active' : ''}`,
    text: count != null ? `${label} (${count})` : label,
    onclick: (e) => { e.stopPropagation(); onPick(); },
  });

  const paintZones = () => {
    zoneScroll.innerHTML = '';
    for (const z of APPARATUS_ZONES) {
      const count = z.id === 'all' ? null : state.facets.zone?.get(z.id);
      if (z.id !== 'all' && count === 0) continue;
      zoneScroll.append(makeChip(z.label, state.zone === z.id, count, () => {
        state.zone = z.id;
        paintList();
        paintMeta();
        paintZones();
      }));
    }
  };

  const paintFilters = () => {
    filtersPanel.hidden = !state.filtersOpen;
    categoryRow.innerHTML = '';
    equipRow.innerHTML = '';
    categoryRow.append(el('span', { class: 'equip-picker-filter-label', text: 'Тип уред' }));
    const catChips = el('div', { class: 'equip-picker-filters' });
    for (const c of APPARATUS_CATEGORIES) {
      const count = c.id === 'all' ? null : state.facets.category.get(c.id);
      if (c.id !== 'all' && count === 0) continue;
      catChips.append(makeChip(c.label, state.category === c.id, count, () => {
        state.category = c.id;
        paintList();
        paintMeta();
        paintFilters();
      }));
    }
    categoryRow.append(catChips);

    equipRow.append(el('span', { class: 'equip-picker-filter-label', text: 'Конкретен уред' }));
    const eqChips = el('div', { class: 'equip-picker-filters' });
    for (const e of APPARATUS_EQUIP_TYPES) {
      const count = e.id === 'all' ? null : state.facets.equip.get(e.id);
      if (e.id !== 'all' && count === 0) continue;
      eqChips.append(makeChip(e.label, state.equip === e.id, count, () => {
        state.equip = e.id;
        paintList();
        paintMeta();
        paintFilters();
      }));
    }
    equipRow.append(eqChips);
  };

  const paintList = () => {
    const focusSearch = document.activeElement === search;
    const visible = visibleItems();
    scroll.innerHTML = '';

    if (!visible.length) {
      scroll.append(el('div', { class: 'equip-picker-empty-wrap' },
        el('p', { class: 'equip-picker-empty', text: 'Няма съвпадение с филтрите.' }),
        el('button', {
          type: 'button',
          class: 'equip-picker-action',
          text: 'Нулирай филтрите',
          onclick: (e) => {
            e.stopPropagation();
            state.category = 'all';
            state.zone = 'all';
            state.equip = 'all';
            state.q = '';
            search.value = '';
            paintZones();
            paintFilters();
            paintList();
            paintMeta();
          },
        }),
      ));
      if (focusSearch) search.focus();
      return;
    }

    const toggle = (id) => {
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      onChange?.([...picked]);
      paintSelected();
      paintList();
      paintMeta();
      paintZones();
    };

    const filtered = state.category !== 'all' || state.zone !== 'all' || state.equip !== 'all' || state.q.trim();
    const groups = groupApparatusByZone(visible);

    for (const group of groups) {
      const isCollapsed = filtered ? false : state.collapsed.has(group.id);
      const section = el('section', { class: `equip-picker-group${isCollapsed ? ' collapsed' : ''}` });
      const titleBtn = el('button', {
        type: 'button',
        class: 'equip-picker-group-title',
        onclick: (e) => {
          e.stopPropagation();
          if (filtered) return;
          if (state.collapsed.has(group.id)) state.collapsed.delete(group.id);
          else state.collapsed.add(group.id);
          paintList();
        },
      });
      titleBtn.append(
        el('span', { class: 'equip-picker-group-chevron', text: isCollapsed ? '▸' : '▾' }),
        el('span', { class: 'equip-picker-group-name', text: group.label }),
        el('span', { class: 'equip-picker-group-count', text: String(group.items.length) }),
      );
      section.append(titleBtn);
      if (!isCollapsed) {
        const grid = el('div', { class: 'equip-picker-grid' });
        for (const item of group.items) grid.append(renderItem(item, picked, toggle));
        section.append(grid);
      }
      scroll.append(section);
    }
    if (focusSearch) search.focus();
  };

  paintZones();
  paintFilters();
  paintSelected();
  paintList();
  paintMeta();

  return { paintSelected, paintList, paintMeta, paintZones };
}

/**
 * Fullscreen избор на уреди.
 */
export function openEquipmentPicker({ getSelected, selected, onChange, onClose } = {}) {
  if (activeOverlay) return null;

  const state = buildPickerState(getSelected, selected);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const overlay = el('div', {
    class: 'equip-fs-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Избор на уреди',
  });

  const sheet = el('div', { class: 'equip-fs-sheet' });
  const header = el('header', { class: 'equip-fs-header' });
  const title = el('h2', { class: 'equip-fs-title', text: 'Избери уреди' });
  const closeBtn = el('button', {
    type: 'button',
    class: 'equip-fs-close',
    text: '×',
    'aria-label': 'Затвори',
  });
  header.append(closeBtn, title);

  const body = el('div', { class: 'equip-fs-body' });
  const footer = el('footer', { class: 'equip-fs-footer' });
  const doneBtn = el('button', { type: 'button', class: 'equip-fs-done', text: 'Готово' });
  const countHint = el('span', { class: 'equip-fs-count' });

  footer.append(countHint, doneBtn);
  sheet.append(header, body, footer);
  overlay.append(sheet);
  document.body.append(overlay);
  activeOverlay = overlay;

  const updateCount = () => {
    const n = state.picked.size;
    countHint.textContent = n ? `${n} избрани` : 'Избери поне един уред';
    doneBtn.disabled = !n;
  };

  const ui = mountPickerUi(body, {
    state,
    fullscreen: true,
    onChange: (ids) => {
      onChange?.(ids);
      updateCount();
    },
  });

  const close = () => {
    overlay.remove();
    document.body.style.overflow = prevOverflow;
    activeOverlay = null;
    onClose?.();
  };

  closeBtn.onclick = (e) => { e.stopPropagation(); close(); };
  doneBtn.onclick = (e) => { e.stopPropagation(); close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape' && activeOverlay === overlay) {
      document.removeEventListener('keydown', onKey);
      close();
    }
  });

  updateCount();
  requestAnimationFrame(() => overlay.classList.add('open'));

  return {
    close,
    syncSelection(ids = []) {
      state.picked.clear();
      for (const id of ids) state.picked.add(id);
      ui.paintSelected();
      ui.paintList();
      ui.paintMeta();
      updateCount();
    },
  };
}

/**
 * Компактно обобщение + бутон за fullscreen — за въпросника.
 */
export function renderEquipmentSummary(container, { getSelected, selected, onChange } = {}) {
  container.classList.add('equip-picker-summary');
  container.innerHTML = '';

  const paint = () => {
    container.innerHTML = '';
    const ids = getSelected?.() || selected || [];
    const items = ids.map((id) => apparatusById(id)).filter(Boolean);

    const head = el('div', { class: 'equip-summary-head' });
    head.append(
      el('p', {
        class: 'equip-summary-text',
        text: items.length
          ? `${items.length} уреда избрани`
          : 'Посочи кои уреди имаш в залата',
      }),
      el('button', {
        type: 'button',
        class: 'equip-summary-open',
        text: items.length ? 'Промени' : 'Избери уреди',
        onclick: (e) => {
          e.stopPropagation();
          openEquipmentPicker({
            getSelected: () => [...(getSelected?.() || selected || [])],
            onChange: (next) => {
              onChange?.(next);
              paint();
            },
          });
        },
      }),
    );
    container.append(head);

    if (items.length) {
      const preview = el('div', { class: 'equip-summary-preview' });
      const shown = items.slice(0, 6);
      for (const item of shown) preview.append(renderThumb(item, 'equip-summary-thumb'));
      if (items.length > 6) {
        preview.append(el('span', { class: 'equip-summary-more', text: `+${items.length - 6}` }));
      }
      container.append(preview);
    }
  };

  paint();
  return { refresh: paint };
}

/** @deprecated — използвай renderEquipmentSummary + openEquipmentPicker */
export function createEquipmentSelect(container, opts) {
  const state = buildPickerState(opts.getSelected, opts.selected);
  return mountPickerUi(container, {
    state,
    onChange: opts.onChange,
    fullscreen: false,
  });
}

export function mountEquipmentSelect(container, opts) {
  return createEquipmentSelect(container, opts);
}
