/**
 * Shared action-button editor for admin.html and notifications-test.html.
 * Max 3 buttons per notification (Android limit).
 */
(function (global) {
    const MAX = 3;

    function valueDisplay(v) {
        if (v === true) return 'true';
        if (v === false) return 'false';
        if (v === null) return 'null';
        return v !== undefined ? String(v) : '';
    }

    function parseValue(raw) {
        const s = String(raw || '').trim();
        if (s === 'true') return true;
        if (s === 'false') return false;
        if (s === 'null' || s === 'skip') return null;
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        return s || undefined;
    }

    function onMaxReached(opts) {
        const msg = 'Максимум 3 бутона на нотификация (Android лимит).';
        if (opts && typeof opts.onMax === 'function') opts.onMax(msg);
        else if (typeof global.showError === 'function') global.showError(msg);
        else if (typeof global.log === 'function') global.log(msg, 'warn');
    }

    function addRow(containerId, data, opts) {
        opts = opts || {};
        const list = document.getElementById(containerId);
        if (!list) return;
        if (list.querySelectorAll('.gn-action-row').length >= MAX) {
            onMaxReached(opts);
            return;
        }
        const p = opts.prefix || 'gn-action';
        const d = data || { id: 'btn_' + Date.now(), title: '', value: '' };
        const row = document.createElement('div');
        row.className = 'gn-action-row';
        if (opts.compact) row.classList.add('extra-row');
        if (!opts.compact) {
            row.style.cssText = 'display:grid;grid-template-columns:120px 1fr 90px auto;gap:8px;align-items:end;background:#f8f9fa;padding:8px;border-radius:6px;border:1px solid #e0e0e0;';
        }

        function inp(cls, val, placeholder) {
            const el = document.createElement('input');
            el.type = 'text';
            el.className = cls;
            el.value = val || '';
            if (placeholder) el.placeholder = placeholder;
            if (!opts.compact) el.style.cssText = 'width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:0.85rem;';
            return el;
        }

        if (opts.compact) {
            row.appendChild(inp(p + '-id', d.id, 'id'));
            row.appendChild(inp(p + '-title', d.title, 'Етикет'));
            row.appendChild(inp(p + '-value', valueDisplay(d.value), 'value'));
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'btn-red';
            del.textContent = '🗑️';
            del.addEventListener('click', () => row.remove());
            row.appendChild(del);
        } else {
            function field(label, cls, val, placeholder) {
                const wrap = document.createElement('div');
                const lbl = document.createElement('label');
                lbl.textContent = label;
                lbl.style.cssText = 'font-size:0.75rem;color:#666;display:block;margin-bottom:3px;';
                wrap.appendChild(lbl);
                wrap.appendChild(inp(cls, val, placeholder));
                return wrap;
            }
            row.appendChild(field('ID', p + '-id', d.id, 'sleep_yes'));
            row.appendChild(field('Етикет', p + '-title', d.title, 'Да'));
            row.appendChild(field('Value', p + '-value', valueDisplay(d.value), 'true'));
            const delWrap = document.createElement('div');
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.title = 'Изтрий';
            delBtn.style.cssText = 'background:#dc3545;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;';
            delBtn.innerHTML = '<i class="fas fa-trash"></i>';
            delBtn.addEventListener('click', () => row.remove());
            delWrap.appendChild(delBtn);
            row.appendChild(delWrap);
        }
        list.appendChild(row);
    }

    function render(containerId, actions, opts) {
        const list = document.getElementById(containerId);
        if (!list) return;
        list.innerHTML = '';
        (actions || []).forEach((a) => addRow(containerId, a, opts));
    }

    function collect(containerId, prefix) {
        prefix = prefix || 'gn-action';
        const list = document.getElementById(containerId);
        if (!list) return [];
        return Array.from(list.querySelectorAll('.gn-action-row')).map((row) => {
            const id = ((row.querySelector('.' + prefix + '-id') || {}).value || '').trim();
            const title = ((row.querySelector('.' + prefix + '-title') || {}).value || '').trim();
            const raw = ((row.querySelector('.' + prefix + '-value') || {}).value || '').trim();
            const value = parseValue(raw);
            const out = { id, title };
            if (value !== undefined) out.value = value;
            return out;
        }).filter((a) => a.id && a.title);
    }

    function renderAll(containerMap, cfg, opts) {
        Object.keys(containerMap).forEach((containerId) => {
            render(containerId, cfg[containerMap[containerId]] || [], opts);
        });
    }

    function collectAll(containerMap, prefix) {
        const out = {};
        Object.keys(containerMap).forEach((containerId) => {
            out[containerMap[containerId]] = collect(containerId, prefix);
        });
        return out;
    }

    global.GnActionsUI = { MAX, valueDisplay, parseValue, addRow, render, collect, renderAll, collectAll };
})(typeof window !== 'undefined' ? window : globalThis);
