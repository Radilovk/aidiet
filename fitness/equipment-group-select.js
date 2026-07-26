/**
 * Групиран избор на оборудване (дъмбели, щанга, ластици…) — отделно от apparatus picker.
 */
import {
  GYM_EQUIPMENT_OPTION,
  EQUIPMENT_PICKER_OPTION,
  QUESTIONNAIRE_EQUIPMENT_SECTIONS,
  groupLabelById,
} from './equipment-groups.js';

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

const SPECIAL_VALUES = new Set([GYM_EQUIPMENT_OPTION, EQUIPMENT_PICKER_OPTION, 'Друго']);

/**
 * @param {HTMLElement} container
 * @param {{ options: object[], selected: Set<string>, onToggle: (value: string, opt: object) => void }} ctx
 */
export function renderEquipmentGroupSections(container, { options, selected, onToggle }) {
  container.innerHTML = '';
  const byGroupId = new Map(
    options.filter((o) => o.groupId).map((o) => [o.groupId, o]),
  );

  const wrap = el('div', { class: 'equip-group-sections' });
  for (const section of QUESTIONNAIRE_EQUIPMENT_SECTIONS) {
    const sectionOpts = section.groupIds
      .map((id) => byGroupId.get(id))
      .filter(Boolean);
    if (!sectionOpts.length) continue;

    const block = el('section', { class: 'equip-group-section' });
    block.append(el('h4', { class: 'equip-group-section-title', text: section.label }));
    const chips = el('div', { class: 'equip-group-chips' });
    for (const opt of sectionOpts) {
      const active = selected.has(opt.value);
      chips.append(el('button', {
        type: 'button',
        class: `equip-group-chip${active ? ' active' : ''}`,
        text: opt.value,
        title: groupLabelById(opt.groupId),
        onclick: (e) => { e.stopPropagation(); onToggle(opt.value, opt); },
      }));
    }
    block.append(chips);
    wrap.append(block);
  }
  container.append(wrap);
}

export function isEquipmentGroupValue(value) {
  return !SPECIAL_VALUES.has(value);
}
