/**
 * Избор на конкретни уреди/станции — въпросник (app / консултация / админ).
 * Клиентски каталог — без бекенд заявки.
 */
import {
  APPARATUS_CATEGORIES,
  APPARATUS_EQUIP_TYPES,
  APPARATUS_MUSCLES,
  GYM_APPARATUS,
  apparatusById,
  categoryLabel,
  computeApparatusFacets,
  groupApparatusByMuscle,
  muscleLabel,
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

function makeChip(label, active, onPick, count) {
  const text = count != null ? `${label} (${count})` : label;
  return el('button', {
    type: 'button',
    class: `equip-picker-filter${active ? ' active' : ''}`,
    text,
    onclick: (e) => { e.stopPropagation(); onPick(); },
  });
}

function makeFilterRow(label, options, activeId, counts, onPick) {
  const row = el('div', { class: 'equip-picker-filter-row' });
  row.append(el('span', { class: 'equip-picker-filter-label', text: label }));
  const chips = el('div', { class: 'equip-picker-filters' });
  for (const opt of options) {
    const count = opt.id === 'all' ? null : counts?.get(opt.id);
    if (opt.id !== 'all' && count === 0) continue;
    chips.append(makeChip(opt.label, activeId === opt.id, () => onPick(opt.id), count));
  }
  row.append(chips);
  return row;
}

const CATEGORY_ICON = {
  machine: '⚙',
  cable: '↕',
  bench: '▭',
  rack: '▣',
  cardio: '♥',
};

function renderThumb(item) {
  const src = apparatusThumbUrl(item);
  if (src) {
    return el('img', {
      class: 'equip-picker-thumb',
      src,
      loading: 'lazy',
      decoding: 'async',
      alt: '',
    });
  }
  return el('span', {
    class: 'equip-picker-thumb equip-picker-thumb-fallback',
    text: CATEGORY_ICON[item.category] || '◆',
    'aria-hidden': 'true',
  });
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
    el('span', { class: 'equip-picker-check', text: active ? '✓' : '' }),
    el('span', { class: 'equip-picker-item-body' },
      el('span', { class: 'equip-picker-item-label', text: item.label }),
      item.subtitle
        ? el('span', { class: 'equip-picker-item-sub', text: item.subtitle })
        : null,
      el('span', { class: 'equip-picker-item-meta' },
        el('span', { class: 'equip-picker-badge', text: muscleLabel(item.muscle) }),
        el('span', { class: 'equip-picker-badge equip-picker-badge-muted', text: categoryLabel(item.category) }),
      ),
    ),
  );
  return row;
}

function defaultCollapsed() {
  const collapsed = new Set();
  for (const m of APPARATUS_MUSCLES) {
    if (m.id !== 'all') collapsed.add(m.id);
  }
  return collapsed;
}

/**
 * @param {HTMLElement} container
 * @param {{ getSelected?: () => string[], selected?: string[], onChange?: (ids: string[]) => void }} opts
 */
export function createEquipmentSelect(container, { getSelected, selected, onChange } = {}) {
  const picked = new Set(getSelected?.() || selected || []);
  let category = 'all';
  let muscle = 'all';
  let equip = 'all';
  let q = '';
  const collapsed = defaultCollapsed();
  const facets = computeApparatusFacets();

  container.classList.add('equip-picker');
  container.innerHTML = '';

  const sticky = el('div', { class: 'equip-picker-sticky' });
  const head = el('div', { class: 'equip-picker-head' });
  const meta = el('p', { class: 'equip-picker-meta' });
  const actions = el('div', { class: 'equip-picker-actions' });
  head.append(meta, actions);

  const toolbar = el('div', { class: 'equip-picker-toolbar' });
  const search = el('input', {
    type: 'search',
    class: 'equip-picker-search',
    placeholder: 'Търси уред, мускул, кабел, преса…',
    autocomplete: 'off',
    onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => e.stopPropagation(),
    oninput: debounce((e) => { q = e.target.value; paintList(); paintMeta(); }),
  });

  const selectedHost = el('div', { class: 'equip-picker-selected' });
  const scroll = el('div', { class: 'equip-picker-scroll' });

  sticky.append(head, toolbar, search, selectedHost);
  container.append(sticky, scroll);

  const visibleItems = () => searchApparatus({ query: q, category, muscle, equip });

  const paintMeta = () => {
    const visible = visibleItems();
    const parts = [`${visible.length} от ${GYM_APPARATUS.length} уреда`];
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
        },
      }));
    }
    if (picked.size) {
      actions.append(el('button', {
        type: 'button',
        class: 'equip-picker-action equip-picker-action-muted',
        text: 'Изчисти всички',
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
      const chipText = item?.subtitle ? `${item.label} · ${item.subtitle}` : (item?.label || id);
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
        },
      });
      const thumbSrc = apparatusThumbUrl(item);
      if (thumbSrc) chip.append(el('img', { class: 'equip-picker-chip-thumb', src: thumbSrc, loading: 'lazy', alt: '' }));
      chip.append(el('span', { class: 'equip-picker-chip-text', text: `${chipText} ×` }));
      selectedHost.append(chip);
    }
  };

  const paintToolbar = () => {
    toolbar.innerHTML = '';
    toolbar.append(
      makeFilterRow('Тип уред', APPARATUS_CATEGORIES, category, facets.category, (id) => {
        category = id;
        paintList();
        paintMeta();
        paintToolbar();
      }),
      makeFilterRow('Конкретен уред', APPARATUS_EQUIP_TYPES, equip, facets.equip, (id) => {
        equip = id;
        paintList();
        paintMeta();
        paintToolbar();
      }),
      makeFilterRow('Мускулна група', APPARATUS_MUSCLES, muscle, facets.muscle, (id) => {
        muscle = id;
        paintList();
        paintMeta();
        paintToolbar();
      }),
    );
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
            category = 'all';
            muscle = 'all';
            equip = 'all';
            q = '';
            search.value = '';
            paintToolbar();
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
    };

    const filtered = category !== 'all' || muscle !== 'all' || equip !== 'all' || q.trim();
    const groups = groupApparatusByMuscle(visible);

    for (const group of groups) {
      const isCollapsed = filtered ? false : collapsed.has(group.id);
      const section = el('section', { class: `equip-picker-group${isCollapsed ? ' collapsed' : ''}` });
      const titleBtn = el('button', {
        type: 'button',
        class: 'equip-picker-group-title',
        onclick: (e) => {
          e.stopPropagation();
          if (filtered) return;
          if (collapsed.has(group.id)) collapsed.delete(group.id);
          else collapsed.add(group.id);
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

  paintToolbar();
  paintSelected();
  paintList();
  paintMeta();

  return {
    attach(next) {
      if (!next || next === container) return;
      next.classList.add('equip-picker');
      next.innerHTML = '';
      next.append(sticky, scroll);
      container = next;
    },
    syncSelection(ids = []) {
      picked.clear();
      for (const id of ids) picked.add(id);
      paintSelected();
      paintList();
      paintMeta();
    },
    destroy() {
      container.innerHTML = '';
      container.classList.remove('equip-picker');
    },
  };
}

/** @deprecated prefer createEquipmentSelect */
export function mountEquipmentSelect(container, opts) {
  return createEquipmentSelect(container, opts);
}
