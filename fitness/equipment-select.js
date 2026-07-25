/**
 * Избор на конкретни уреди/станции — въпросник (app/консултация/админ).
 */
import { APPARATUS_CATEGORIES, searchApparatus } from './equipment-apparatus.js';

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

/** @param {HTMLElement} container */
export function mountEquipmentSelect(container, { selected, onChange }) {
  const picked = selected instanceof Set ? selected : new Set(selected || []);
  let category = 'all';
  let q = '';

  const render = () => {
    container.innerHTML = '';
    const visible = searchApparatus({ query: q, category });

    const filters = el('div', { class: 'equip-picker-filters' });
    for (const cat of APPARATUS_CATEGORIES) {
      filters.append(el('button', {
        type: 'button',
        class: `equip-picker-filter${category === cat.id ? ' active' : ''}`,
        text: cat.label,
        onclick: (e) => {
          e.stopPropagation();
          category = cat.id;
          render();
        },
      }));
    }
    container.append(filters);

    container.append(el('input', {
      type: 'search',
      class: 'equip-picker-search',
      placeholder: 'Търси уред (лег преса, лежанка, скрипец…)',
      value: q,
      onclick: (e) => e.stopPropagation(),
      onkeydown: (e) => e.stopPropagation(),
      oninput: (e) => { q = e.target.value; render(); },
    }));

    if (picked.size) {
      const sel = el('div', { class: 'equip-picker-selected' });
      for (const id of picked) {
        const item = visible.find((a) => a.id === id) || searchApparatus({}).find((a) => a.id === id);
        sel.append(el('button', {
          type: 'button',
          class: 'equip-picker-sel-chip',
          text: `${item?.label || id} ×`,
          onclick: (e) => {
            e.stopPropagation();
            picked.delete(id);
            onChange?.([...picked]);
            render();
          },
        }));
      }
      container.append(sel);
    }

    const list = el('div', { class: 'equip-picker-list' });
    if (!visible.length) {
      list.append(el('p', { class: 'equip-picker-empty', text: 'Няма съвпадение.' }));
    } else {
      for (const item of visible) {
        const active = picked.has(item.id);
        list.append(el('button', {
          type: 'button',
          class: `equip-picker-item${active ? ' active' : ''}`,
          text: item.label,
          onclick: (e) => {
            e.stopPropagation();
            if (picked.has(item.id)) picked.delete(item.id);
            else picked.add(item.id);
            onChange?.([...picked]);
            render();
          },
        }));
      }
    }
    container.append(list);
  };

  render();
}
