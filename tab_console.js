const LIMIT = 200000;

export function appendLog(tab, entry) {
    tab.console ??= { text: '', expanded: false, follow: true, height: 180 };
    const time = new Date().toLocaleTimeString();
    const text = `[${time}] [${entry.label ?? 'Application'} · ${entry.stream ?? 'system'}] ${entry.text}`;
    tab.console.text += text.endsWith('\n') ? text : `${text}\n`;
    if (tab.console.text.length > LIMIT) {
        const marker = '[Older output discarded]\n';
        tab.console.text = marker + tab.console.text.slice(-(LIMIT - marker.length));
    }
    if (entry.stream === 'error') tab.console.expanded = true;
}

export function buildConsole(tab, onChange) {
    tab.console ??= { text: '', expanded: false, follow: true, height: 180 };
    const state = tab.console;
    const panel = document.createElement('section');
    panel.className = 'tab-console';
    panel.dataset.consoleTab = tab.id;
    const divider = document.createElement('div');
    divider.className = 'console-divider';
    divider.title = 'Drag to resize console';
    panel.append(divider);
    const header = document.createElement('div');
    header.className = 'console-header';
    const button = (text, callback) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = text;
        b.addEventListener('click', callback); header.append(b); return b;
    };
    button(state.expanded ? 'Console ▾' : 'Console ▸', () => {
        state.expanded = !state.expanded; onChange();
    });
    const notification = document.createElement('span');
    notification.setAttribute('role', 'status');
    button('Clear', () => { state.text = ''; state.scrollTop = 0; body.value = ''; });
    button('Copy', async () => {
        try { await navigator.clipboard.writeText(state.text); notification.textContent = 'Copied'; }
        catch (error) { notification.textContent = `Copy failed: ${error.message}`; }
    });
    const follow = document.createElement('input');
    follow.type = 'checkbox'; follow.checked = state.follow;
    const label = document.createElement('label');
    label.append(follow, document.createTextNode('Follow output'));
    follow.addEventListener('change', () => {
        state.follow = follow.checked;
        if (state.follow) body.scrollTop = body.scrollHeight;
    });
    header.append(label, notification); panel.append(header);
    const body = document.createElement('textarea');
    body.className = 'console-output';
    body.readOnly = true;
    body.setAttribute('aria-label', 'Console output');
    body.spellcheck = false; body.value = state.text;
    body.hidden = !state.expanded;
    body.style.height = `${state.height}px`;
    body.addEventListener('scroll', () => {
        state.scrollTop = body.scrollTop;
        state.follow = body.scrollHeight - body.clientHeight - body.scrollTop < 8;
        follow.checked = state.follow;
    });
    panel.append(body);
    divider.hidden = !state.expanded;
    divider.addEventListener('pointerdown', event => {
        event.preventDefault();
        const start = event.clientY, height = state.height;
        const move = e => {
            const maximum = Math.max(80, Math.min(500, panel.parentElement.clientHeight - 100));
            state.height = Math.max(80, Math.min(maximum, height + start - e.clientY));
            body.style.height = `${state.height}px`;
        };
        const end = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    });
    requestAnimationFrame(() => {
        body.scrollTop = state.follow ? body.scrollHeight : state.scrollTop ?? 0;
    });
    return panel;
}
