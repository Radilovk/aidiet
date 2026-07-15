/**
 * Споделен UI за KA-TRAINER въпросник (app + консултация).
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

function optionInputs(option) {
  return option.inputs || (option.input ? [option.input] : []);
}

export function createWizardController({
  getEl,
  questions,
  visibleOptions,
  validateQuestion,
  getState,
  onPersist,
  onComplete,
  finalButtonText = 'Изпрати',
}) {
  let stepIndex = 0;

  function save() {
    onPersist?.();
  }

  function renderFields(q, container) {
    const state = getState()[q.id] || (getState()[q.id] = {});

    const renderAll = () => {
      container.innerHTML = '';
      for (const f of q.fields) {
        if (f.showIf && state[f.showIf.key] !== f.showIf.equals) continue;
        const field = el('div', { class: 'field' });
        field.append(el('label', { class: 'field-label', text: f.label }));

        if (f.type === 'choice') {
          const group = el('div', { class: 'choice-group' });
          for (const opt of f.options) {
            group.append(el('button', {
              type: 'button',
              class: `choice-btn${state[f.key] === opt ? ' active' : ''}`,
              text: opt,
              onclick: () => { state[f.key] = opt; save(); renderAll(); },
            }));
          }
          field.append(group);
        } else if (f.type === 'chips') {
          const group = el('div', { class: 'chips-group' });
          const selected = new Set(state[f.key] || []);
          for (const opt of f.options) {
            group.append(el('button', {
              type: 'button',
              class: `chip-btn${selected.has(opt) ? ' active' : ''}`,
              text: opt,
              onclick: () => {
                if (selected.has(opt)) selected.delete(opt);
                else selected.add(opt);
                state[f.key] = [...selected];
                save(); renderAll();
              },
            }));
          }
          field.append(group);
        } else if (f.type === 'number') {
          const input = el('input', {
            type: 'number', inputmode: 'numeric', min: f.min, max: f.max,
            value: state[f.key] ?? '',
            oninput: (e) => { state[f.key] = e.target.value; save(); },
          });
          const wrap = el('div', { class: 'num-wrap' }, input);
          if (f.suffix) wrap.append(el('span', { class: 'num-suffix', text: f.suffix }));
          field.append(wrap);
        } else {
          field.append(el('input', {
            type: 'text', placeholder: f.placeholder || '',
            value: state[f.key] ?? '',
            oninput: (e) => { state[f.key] = e.target.value; save(); },
          }));
        }
        container.append(field);
      }
    };
    renderAll();
  }

  function renderMulti(q, container) {
    const state = getState()[q.id] || (getState()[q.id] = { selected: [], inputs: {} });
    const options = visibleOptions(q, getState());

    const renderAll = () => {
      container.innerHTML = '';
      const list = el('div', { class: 'opt-list' });
      const selected = new Set(state.selected);

      for (const opt of options) {
        const isActive = selected.has(opt.value);
        const cardEl = el('div', { class: `opt-card${isActive ? ' active' : ''}`, role: 'checkbox', 'aria-checked': String(isActive), tabindex: '0' });
        cardEl.append(el('div', { class: 'opt-row' },
          el('span', { class: 'opt-mark', text: isActive ? '✓' : '' }),
          el('span', { class: 'opt-text', text: opt.value }),
        ));

        if (isActive && optionInputs(opt).length) {
          const inputsWrap = el('div', { class: 'opt-inputs' });
          for (const inp of optionInputs(opt)) {
            inputsWrap.append(el('input', {
              type: inp.type === 'number' ? 'number' : 'text',
              placeholder: inp.placeholder || '',
              value: state.inputs[inp.key] ?? '',
              onclick: (e) => e.stopPropagation(),
              oninput: (e) => { state.inputs[inp.key] = e.target.value; save(); },
            }));
          }
          cardEl.append(inputsWrap);
        }

        const toggle = () => {
          if (selected.has(opt.value)) selected.delete(opt.value);
          else {
            if (opt.exclusive) selected.clear();
            else for (const o of options) if (o.exclusive) selected.delete(o.value);
            selected.add(opt.value);
          }
          state.selected = [...selected];
          save(); renderAll();
        };
        cardEl.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') toggle(); });
        cardEl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
        list.append(cardEl);
      }
      container.append(list);
    };
    renderAll();
  }

  function renderSingle(q, container) {
    const state = getState()[q.id] || (getState()[q.id] = { selected: null, inputs: {} });

    const renderAll = () => {
      container.innerHTML = '';
      const list = el('div', { class: 'opt-list' });
      for (const opt of q.options) {
        const isActive = state.selected === opt.value;
        const cardEl = el('div', { class: `opt-card radio${isActive ? ' active' : ''}`, role: 'radio', 'aria-checked': String(isActive), tabindex: '0' });
        cardEl.append(el('div', { class: 'opt-row' },
          el('span', { class: 'opt-mark', text: isActive ? '●' : '' }),
          el('span', { class: 'opt-text', text: opt.value }),
        ));

        if (isActive && optionInputs(opt).length) {
          const inputsWrap = el('div', { class: 'opt-inputs' });
          for (const inp of optionInputs(opt)) {
            inputsWrap.append(el('input', {
              type: inp.type === 'number' ? 'number' : 'text',
              placeholder: inp.placeholder || '',
              value: state.inputs[inp.key] ?? '',
              onclick: (e) => e.stopPropagation(),
              oninput: (e) => { state.inputs[inp.key] = e.target.value; save(); },
            }));
          }
          cardEl.append(inputsWrap);
        }

        const select = () => { state.selected = opt.value; save(); renderAll(); };
        cardEl.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') select(); });
        cardEl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); select(); } });
        list.append(cardEl);
      }
      container.append(list);
    };
    renderAll();
  }

  function renderScale(q, container) {
    const wizardState = getState();
    const current = wizardState[q.id] ?? 5;
    wizardState[q.id] = current;
    save();

    const valueEl = el('div', { class: 'scale-value', text: String(current) });
    const range = el('input', {
      type: 'range', min: q.min, max: q.max, value: current,
      oninput: (e) => {
        wizardState[q.id] = Number(e.target.value);
        valueEl.textContent = e.target.value;
        save();
      },
    });
    container.append(el('div', { class: 'scale-wrap' },
      valueEl, range,
      el('div', { class: 'scale-labels' },
        el('span', { text: `${q.min} — спокойно` }),
        el('span', { text: `${q.max} — на предела` }),
      ),
    ));
  }

  function renderTextArea(q, container) {
    const wizardState = getState();
    container.append(el('textarea', {
      placeholder: q.placeholder || '',
      maxlength: '1500',
      oninput: (e) => { wizardState[q.id] = e.target.value; save(); },
    }, wizardState[q.id] || ''));
  }

  function renderStep() {
    const q = questions[stepIndex];
    const card = getEl('questionCard');
    card.innerHTML = '';
    getEl('stepError').hidden = true;

    const pct = Math.round(((stepIndex + 1) / questions.length) * 100);
    getEl('progressFill').style.width = `${pct}%`;
    getEl('stepLabel').textContent = `Въпрос ${q.num} от ${questions.length}`;
    getEl('stepPct').textContent = `${pct}%`;
    getEl('btnBack').style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
    getEl('btnNext').textContent = stepIndex === questions.length - 1 ? finalButtonText : 'Напред →';

    card.append(el('h2', { class: 'q-title', text: q.title }));
    if (q.subtitle) card.append(el('p', { class: 'q-subtitle', text: q.subtitle }));

    const body = el('div', { class: 'q-body' });
    card.append(body);

    if (q.type === 'fields') renderFields(q, body);
    else if (q.type === 'multi') renderMulti(q, body);
    else if (q.type === 'single') renderSingle(q, body);
    else if (q.type === 'scale') renderScale(q, body);
    else if (q.type === 'text') renderTextArea(q, body);

    card.style.animation = 'none';
    void card.offsetHeight;
    card.style.animation = '';
  }

  function nextStep() {
    const q = questions[stepIndex];
    const error = validateQuestion(q, getState());
    if (error) {
      const errEl = getEl('stepError');
      errEl.textContent = error;
      errEl.hidden = false;
      errEl.style.animation = 'none';
      void errEl.offsetHeight;
      errEl.style.animation = '';
      return false;
    }
    if (stepIndex < questions.length - 1) {
      stepIndex += 1;
      renderStep();
      return true;
    }
    onComplete?.();
    return true;
  }

  function prevStep() {
    if (stepIndex > 0) {
      stepIndex -= 1;
      renderStep();
    }
  }

  function reset() {
    stepIndex = 0;
  }

  function setStepIndex(idx) {
    stepIndex = Math.max(0, Math.min(idx, questions.length - 1));
  }

  return {
    renderStep, nextStep, prevStep, reset, setStepIndex,
    getStepIndex: () => stepIndex,
  };
}
