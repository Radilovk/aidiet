/**
 * Избор на оборудване по групи — споделен от въпросник (app/консултация/админ).
 */
import { EQUIPMENT_GROUPS, buildVirtualEquipmentFacets } from './equipment-groups.js';
import { expandSearchTokens } from './exercise-synonyms.js';
import { tokenize, tokenOverlapScore } from './normalize.js';

const SEARCH_EXTRA = {
  equipment_rig: ['уреди', 'машини', 'кабел', 'скрипец'],
  body_weight: ['собствено', 'тегло', 'trx', 'bodyweight'],
  dumbbell: ['дъмбел', 'гирич', 'dumbbell', 'гира'],
  barbell: ['щанга', 'лост', 'barbell', 'ez', 'диск'],
  kettlebell: ['пудовка', 'kettlebell'],
  cable: ['кабел', 'скрипец', 'cable', 'pulley'],
  band: ['ластик', 'band', 'резист'],
  machine: ['машина', 'преса', 'smith', 'смит', 'lever', 'hack'],
  cardio_trainer: ['кардио', 'пътека', 'treadmill', 'велоерг', 'елипт', 'стълби', 'erg'],
  balls: ['топка', 'фитбол', 'bosu', 'медицинска'],
  weight_plate: ['диск', 'тежест', 'plate', 'weighted'],
  accessory: ['въже', 'ролер', 'rope', 'гума'],
};

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

function fallbackFacets() {
  return [
    ...buildVirtualEquipmentFacets({ machine: 1, cable: 1 }),
    ...EQUIPMENT_GROUPS.map((g) => ({ value: g.id, label: g.label, count: 0 })),
  ];
}

async function loadFacets(apiBase) {
  if (!apiBase) return fallbackFacets();
  try {
    const res = await fetch(`${apiBase}/api/exercises/search?facets=1&limit=1`);
    const data = await res.json();
    if (data.success && data.facets?.equipment?.length) return data.facets.equipment;
  } catch { /* offline */ }
  return fallbackFacets();
}

function matchesSearch(facet, tokens) {
  if (!tokens.length) return true;
  const extra = SEARCH_EXTRA[facet.value] || [];
  return tokenOverlapScore(tokens, tokenize(`${facet.label} ${extra.join(' ')}`)) > 0;
}

/** @param {HTMLElement} container */
export function mountEquipmentSelect(container, { apiBase, selected, onChange }) {
  const picked = selected instanceof Set ? selected : new Set(selected || []);
  let facets = fallbackFacets();
  let q = '';

  const render = () => {
    container.innerHTML = '';
    const tokens = expandSearchTokens(q);
    const visible = facets.filter((f) => matchesSearch(f, tokens));

    container.append(el('input', {
      type: 'search',
      class: 'equip-picker-search',
      placeholder: 'Търси (дъмбел, скрипец, пътека, машина…)',
      value: q,
      onclick: (e) => e.stopPropagation(),
      onkeydown: (e) => e.stopPropagation(),
      oninput: (e) => { q = e.target.value; render(); },
    }));

    const chips = el('div', { class: 'equip-picker-chips' });
    if (!visible.length) {
      chips.append(el('p', { class: 'equip-picker-empty', text: 'Няма съвпадение.' }));
    } else {
      for (const f of visible) {
        const active = picked.has(f.value);
        chips.append(el('button', {
          type: 'button',
          class: `equip-picker-chip${active ? ' active' : ''}`,
          text: f.count ? `${f.label} (${f.count})` : f.label,
          onclick: (e) => {
            e.stopPropagation();
            if (picked.has(f.value)) picked.delete(f.value);
            else picked.add(f.value);
            onChange?.([...picked]);
            render();
          },
        }));
      }
    }
    container.append(chips);
    if (picked.size) {
      container.append(el('p', { class: 'equip-picker-summary', text: `Избрани групи: ${picked.size}` }));
    }
  };

  render();
  loadFacets(apiBase).then((f) => { facets = f; render(); });
}
