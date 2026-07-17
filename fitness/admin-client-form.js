/**
 * KA-TRAINER — структурирана админ бланка за клиентски програми.
 * Използва същите въпроси като клиентския въпросник (questions.js).
 */
import { QUESTIONS, activeQuestions, buildAnswers, validateQuestion } from './questions.js';
import { buildProfileSummary } from './profile-summary.js';

let formState = {};
let containerEl = null;
let previewEl = null;
let legacyEl = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

function ensureState(question) {
  if (formState[question.id] !== undefined) return formState[question.id];
  if (question.type === 'fields') formState[question.id] = {};
  else if (question.type === 'multi') formState[question.id] = { selected: [], inputs: {} };
  else if (question.type === 'single') formState[question.id] = { selected: null, inputs: {} };
  else if (question.type === 'scale') formState[question.id] = 5;
  else formState[question.id] = '';
  return formState[question.id];
}

function updatePreview() {
  if (!previewEl) return;
  try {
    const answers = buildAnswers(formState);
    if (answers.gender && answers.age) {
      previewEl.textContent = buildProfileSummary(answers);
      previewEl.classList.remove('fcp-preview-empty');
    } else {
      previewEl.textContent = 'Попълни поне пол, възраст, ръст и тегло…';
      previewEl.classList.add('fcp-preview-empty');
    }
  } catch {
    previewEl.textContent = '';
  }
}

function rerender() {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  for (const q of activeQuestions(formState)) {
    containerEl.append(renderSection(q));
  }
  updatePreview();
}

function renderSection(q) {
  const section = el('div', { class: 'fcp-section', 'data-qid': q.id });
  section.append(el('h4', { text: `${q.num}. ${q.title}` }));
  if (q.subtitle) section.append(el('p', { class: 'fcp-section-sub', text: q.subtitle }));

  if (q.type === 'fields') renderFields(q, section);
  else if (q.type === 'multi') renderMulti(q, section);
  else if (q.type === 'single') renderSingle(q, section);
  else if (q.type === 'scale') renderScale(q, section);
  else if (q.type === 'text') renderText(q, section);

  return section;
}

function renderFields(q, section) {
  const state = ensureState(q);
  const wrap = el('div', { class: 'fcp-fields' });

  const paint = () => {
    wrap.innerHTML = '';
    for (const f of q.fields) {
      if (f.showIf && state[f.showIf.key] !== f.showIf.equals) continue;
      const field = el('div', { class: 'fcp-field' });
      field.append(el('label', { class: 'fcp-label', text: f.label + (f.required ? ' *' : '') }));

      if (f.type === 'choice') {
        const group = el('div', { class: 'fcp-choice-group' });
        for (const opt of f.options) {
          group.append(el('button', {
            type: 'button',
            class: `fcp-choice${state[f.key] === opt ? ' active' : ''}`,
            text: opt,
            onclick: () => { state[f.key] = opt; if (f.key === 'gender') rerender(); else paint(); updatePreview(); },
          }));
        }
        field.append(group);
      } else if (f.type === 'chips') {
        const selected = new Set(state[f.key] || []);
        const group = el('div', { class: 'fcp-choice-group' });
        for (const opt of f.options) {
          group.append(el('button', {
            type: 'button',
            class: `fcp-choice${selected.has(opt) ? ' active' : ''}`,
            text: opt,
            onclick: () => {
              if (selected.has(opt)) selected.delete(opt);
              else selected.add(opt);
              state[f.key] = [...selected];
              paint();
              updatePreview();
            },
          }));
        }
        field.append(group);
      } else if (f.type === 'number') {
        const row = el('div', { class: 'fcp-num-row' });
        const input = el('input', {
          type: 'number', class: 'fcp-input', min: f.min, max: f.max,
          value: state[f.key] ?? '',
          oninput: (e) => { state[f.key] = e.target.value; updatePreview(); },
        });
        row.append(input);
        if (f.suffix) row.append(el('span', { class: 'fcp-suffix', text: f.suffix }));
        field.append(row);
      } else {
        field.append(el('input', {
          type: 'text', class: 'fcp-input', placeholder: f.placeholder || '',
          value: state[f.key] ?? '',
          oninput: (e) => { state[f.key] = e.target.value; updatePreview(); },
        }));
      }
      wrap.append(field);
    }
  };
  paint();
  section.append(wrap);
}

function renderMulti(q, section) {
  const state = ensureState(q);
  const list = el('div', { class: 'fcp-opt-list' });

  const paint = () => {
    list.innerHTML = '';
    const selected = new Set(state.selected || []);
    for (const opt of q.options) {
      const active = selected.has(opt.value);
      const card = el('label', { class: `fcp-opt${active ? ' active' : ''}` });
      const cb = el('input', {
        type: 'checkbox',
        checked: active,
        onchange: (e) => {
          if (e.target.checked) {
            if (opt.exclusive) selected.clear();
            else for (const o of q.options) if (o.exclusive) selected.delete(o.value);
            selected.add(opt.value);
          } else selected.delete(opt.value);
          state.selected = [...selected];
          paint();
          updatePreview();
        },
      });
      card.append(cb, el('span', { text: opt.value }));

      const inputs = opt.inputs || (opt.input ? [opt.input] : []);
      if (active && inputs.length) {
        const iw = el('div', { class: 'fcp-opt-inputs' });
        for (const inp of inputs) {
          iw.append(el('input', {
            type: inp.type === 'number' ? 'number' : 'text',
            class: 'fcp-input',
            placeholder: inp.placeholder || '',
            value: state.inputs[inp.key] ?? '',
            oninput: (e) => { state.inputs[inp.key] = e.target.value; updatePreview(); },
          }));
        }
        card.append(iw);
      }
      list.append(card);
    }
  };
  paint();
  section.append(list);
}

function renderSingle(q, section) {
  const state = ensureState(q);
  const list = el('div', { class: 'fcp-opt-list' });

  const paint = () => {
    list.innerHTML = '';
    for (const opt of q.options) {
      const active = state.selected === opt.value;
      const card = el('label', { class: `fcp-opt${active ? ' active' : ''}` });
      card.append(el('input', {
        type: 'radio',
        name: `fcp_${q.id}`,
        checked: active,
        onchange: () => { state.selected = opt.value; paint(); updatePreview(); },
      }), el('span', { text: opt.value }));

      const inputs = opt.inputs || (opt.input ? [opt.input] : []);
      if (active && inputs.length) {
        const iw = el('div', { class: 'fcp-opt-inputs' });
        for (const inp of inputs) {
          iw.append(el('input', {
            type: inp.type === 'number' ? 'number' : 'text',
            class: 'fcp-input',
            placeholder: inp.placeholder || '',
            value: state.inputs[inp.key] ?? '',
            oninput: (e) => { state.inputs[inp.key] = e.target.value; updatePreview(); },
          }));
        }
        card.append(iw);
      }
      list.append(card);
    }
  };
  paint();
  section.append(list);
}

function renderScale(q, section) {
  const state = ensureState(q);
  const input = el('input', {
    type: 'range', class: 'fcp-range', min: q.min, max: q.max, value: state ?? 5,
    oninput: (e) => { formState[q.id] = Number(e.target.value); val.textContent = e.target.value; updatePreview(); },
  });
  const val = el('span', { class: 'fcp-scale-val', text: String(state ?? 5) });
  section.append(el('div', { class: 'fcp-scale-row' }, input, val));
}

function renderText(q, section) {
  const state = ensureState(q);
  section.append(el('textarea', {
    class: 'fcp-textarea',
    rows: '3',
    placeholder: q.placeholder || '',
    value: state || '',
    oninput: (e) => { formState[q.id] = e.target.value; updatePreview(); },
  }));
}

/** Инициализира формата в контейнера. */
export function initAdminClientForm({ container, preview, legacyNotice }) {
  containerEl = container;
  previewEl = preview;
  legacyEl = legacyNotice;
  formState = {};
  rerender();
}

/** Връща суровото състояние на формата (wizard state). */
export function getAdminFormState() {
  return JSON.parse(JSON.stringify(formState));
}

/** Зарежда записан state или legacy clientProfile текст. */
export function setAdminFormData({ clientAnswers, clientProfile } = {}) {
  if (clientAnswers && typeof clientAnswers === 'object') {
    formState = answersToFormState(clientAnswers);
    if (legacyEl) legacyEl.classList.add('hidden');
  } else if (clientProfile?.trim()) {
    formState = {};
    if (legacyEl) {
      legacyEl.classList.remove('hidden');
      legacyEl.textContent = 'Стар запис със свободен текст. Попълни структурираната бланка по-долу и запази отново.';
    }
  } else {
    formState = {};
    if (legacyEl) legacyEl.classList.add('hidden');
  }
  rerender();
}

/** Обратно от answers към wizard state (за зареждане на запис). */
function answersToFormState(a) {
  const s = {};
  s.basics = {
    gender: a.gender || '',
    age: a.age ?? '',
    heightCm: a.heightCm ?? '',
    weightKg: a.weightKg ?? '',
  };
  s.health = { selected: [...(a.health || [])], inputs: { healthMeds: a.healthMeds || '', healthOther: a.healthOther || '' } };
  if (a.healthFemale?.length) {
    const label = a.healthFemale[0];
    if (label.includes('Бременна')) {
      s.womenContext = { selected: 'Бременна', inputs: { pregnancyTrimester: label.split(':').pop()?.trim() || '' } };
    } else if (label.includes('Кърмене')) {
      s.womenContext = { selected: 'Кърмя в момента', inputs: {} };
    } else if (label.includes('Следродилен')) {
      s.womenContext = { selected: 'Скоро след раждане (до 6 месеца)', inputs: {} };
    } else if (label.includes('Менопауза')) {
      s.womenContext = { selected: 'Менопауза / перименопауза', inputs: {} };
    } else {
      s.womenContext = { selected: 'Други хормонални особености', inputs: { womenOther: label } };
    }
  }
  s.limitations = { selected: (a.limitations || []).map((l) => l.split(':')[0].trim()), inputs: {} };
  s.weightChange = { selected: a.weightChange?.type === 'gain' ? 'Да, качих килограми' : a.weightChange?.type === 'loss' ? 'Да, свалих килограми' : 'Не, теглото ми е стабилно', inputs: {} };
  s.sleep = { selected: a.sleep || '' };
  s.stress = a.stress ?? 5;
  s.dailyActivity = { selected: a.dailyActivity || '' };
  s.sportActivity = { selected: a.sportActivity?.status || '', inputs: { sportCurrent: a.sportActivity?.current || '' } };
  s.experience = { selected: a.experience || '' };
  s.nutrition = { type: a.nutrition?.type || '', custom: a.nutrition?.custom || '', mealsPerDay: a.nutrition?.mealsPerDay ?? '' };
  s.goal = {
    main: a.goal?.main || '',
    other: a.goal?.other || '',
    timeframe: a.goal?.deadline ? 'Конкретна дата' : 'Без краен срок',
    deadline: a.goal?.deadline || '',
  };
  s.equipment = { selected: [...(a.equipment || [])], inputs: { equipmentOther: a.equipmentOther || '' } };
  s.preferences = { ...(a.preferences || {}), types: a.preferences?.types || [] };
  s.extraInfo = a.extraInfo || '';
  return s;
}

export function validateAdminClientForm() {
  for (const q of activeQuestions(formState)) {
    const err = validateQuestion(q, formState);
    if (err) return `${q.title}: ${err}`;
  }
  return null;
}

/** Payload за запис към API. */
export function buildAdminClientPayload() {
  const clientAnswers = buildAnswers(formState);
  return {
    clientAnswers,
    clientFormState: getAdminFormState(),
    clientProfile: buildProfileSummary(clientAnswers),
  };
}

/** Зарежда запис — предпочита запазен form state. */
export function loadAdminClientRecord({ clientFormState, clientAnswers, clientProfile } = {}) {
  if (clientFormState && typeof clientFormState === 'object') {
    formState = clientFormState;
    if (legacyEl) legacyEl.classList.add('hidden');
  } else {
    setAdminFormData({ clientAnswers, clientProfile });
    return;
  }
  rerender();
}

export function resetAdminClientForm() {
  formState = {};
  if (legacyEl) legacyEl.classList.add('hidden');
  rerender();
}
