/**
 * Избор на конкретни уреди/станции — въпросник (app / консултация / админ).
 */
import {
  APPARATUS_CATEGORIES,
  APPARATUS_MUSCLES,
  GYM_APPARATUS,
  categoryLabel,
  groupApparatusByMuscle,
  muscleLabel,
  searchApparatus,
} from './equipment-apparatus.js';

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

function makeFilterRow(label, options, activeId, onPick) {
  const row = el('div', { class: 'equip-picker-filter-row' });
  row.append(el('span', { class: 'equip-picker-filter-label', text: label }));
  const chips = el('div', { class: 'equip-picker-filters' });
  for (const opt of options) {
    chips.append(el('button', {
      type: 'button',
      class: `equip-picker-filter${activeId === opt.id ? ' active' : ''}`,
      text: opt.label,
      onclick: (e) => { e.stopPropagation(); onPick(opt.id); },
    }));
  }
  row.append(chips);
  return row;
}

function renderItem(item, picked, onToggle) {
  const active = picked.has(item.id);
  const row = el('button', {
    type: 'button',
    class: `equip-picker-item${active ? ' active' : ''}`,
    onclick: (e) => { e.stopPropagation(); onToggle(item.id); },
  });
  row.append(
    el('span', { class: 'equip-picker-check', text: active ? '✓' : '' }),
    el('span', { class: 'equip-picker-item-body' },
      el('span', { class: 'equip-picker-item-label', text: item.label }),
      el('span', { class: 'equip-picker-item-meta' },
        el('span', { class: 'equip-picker-badge', text: muscleLabel(item.muscle) }),
        el('span', { class: 'equip-picker-badge equip-picker-badge-muted', text: categoryLabel(item.category) }),
      ),
    ),
  );
  return row;
}

/** @param {HTMLElement} container */
export function mountEquipmentSelect(container, { selected, onChange }) {
  const picked = selected instanceof Set ? selected : new Set(selected || []);
  let category = 'all';
  let muscle = 'all';
  let q = '';

  container.classList.add('equip-picker');
  container.innerHTML = '';

  const head = el('div', { class: 'equip-picker-head' });
  const meta = el('p', { class: 'equip-picker-meta' });
  head.append(meta);

  const toolbar = el('div', { class: 'equip-picker-toolbar' });
  const search = el('input', {
    type: 'search',
    class: 'equip-picker-search',
    placeholder: 'Търси уред, зона или тип…',
    autocomplete: 'off',
    onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => e.stopPropagation(),
    oninput: (e) => { q = e.target.value; paintList(); paintMeta(); },
  });

  const selectedHost = el('div', { class: 'equip-picker-selected' });
  const scroll = el('div', { class: 'equip-picker-scroll' });

  container.append(head, toolbar, search, selectedHost, scroll);

  const paintMeta = () => {
    const visible = searchApparatus({ query: q, category, muscle });
    const parts = [`${visible.length} от ${GYM_APPARATUS.length} уреда`];
    if (picked.size) parts.push(`${picked.size} избрани`);
    meta.textContent = parts.join(' · ');
  };

  const paintSelected = () => {
    selectedHost.innerHTML = '';
    if (!picked.size) {
      selectedHost.hidden = true;
      return;
    }
    selectedHost.hidden = false;
    for (const id of picked) {
      const item = BY_ID_SAFE(id);
      selectedHost.append(el('button', {
        type: 'button',
        class: 'equip-picker-sel-chip',
        text: `${item?.label || id} ×`,
        onclick: (e) => {
          e.stopPropagation();
          picked.delete(id);
          onChange?.([...picked]);
          paintSelected();
          paintList();
          paintMeta();
        },
      }));
    }
  };

  const paintToolbar = () => {
    toolbar.innerHTML = '';
    toolbar.append(
      makeFilterRow('Тип', APPARATUS_CATEGORIES, category, (id) => {
        category = id;
        paintList();
        paintMeta();
        paintToolbar();
      }),
      makeFilterRow('Мускулна група', APPARATUS_MUSCLES, muscle, (id) => {
        muscle = id;
        paintList();
        paintMeta();
        paintToolbar();
      }),
    );
  };

  const paintList = () => {
    const focusSearch = document.activeElement === search;
    const visible = searchApparatus({ query: q, category, muscle });
    scroll.innerHTML = '';

    if (!visible.length) {
      scroll.append(el('p', { class: 'equip-picker-empty', text: 'Няма съвпадение с филтрите.' }));
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

    const grouped = (category === 'all' && muscle === 'all' && !q.trim())
      ? groupApparatusByMuscle(visible)
      : null;

    if (grouped?.length) {
      for (const group of grouped) {
        const block = el('section', { class: 'equip-picker-group' });
        block.append(el('h4', { class: 'equip-picker-group-title', text: group.label }));
        const grid = el('div', { class: 'equip-picker-grid' });
        for (const item of group.items) grid.append(renderItem(item, picked, toggle));
        block.append(grid);
        scroll.append(block);
      }
    } else {
      const grid = el('div', { class: 'equip-picker-grid' });
      for (const item of visible) grid.append(renderItem(item, picked, toggle));
      scroll.append(grid);
    }

    if (focusSearch) search.focus();
  };

  paintToolbar();
  paintSelected();
  paintList();
  paintMeta();
}

function BY_ID_SAFE(id) {
  return GYM_APPARATUS.find((a) => a.id === id);
}
