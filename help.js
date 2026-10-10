import { renderMarkdown } from './markdown.js';

const HOME = 'help.md';
const history = [];
let current = null;

const doc = document.getElementById('doc');
const back = document.getElementById('back');

// Resolves a link in the current document against that document's folder, POSIX style.
function resolveDoc(from, href) {
    const parts = from.split('/').slice(0, -1);
    for (const piece of href.split('#')[0].split('/')) {
        if (piece === '..') parts.pop();
        else if (piece && piece !== '.') parts.push(piece);
    }
    return parts.join('/');
}

async function show(relativePath, remember = true) {
    try {
        const { path, content } = await window.appInfo.openDoc(relativePath);
        if (remember && current) history.push(current);
        current = path;
        doc.innerHTML = renderMarkdown(content);
        document.getElementById('path').textContent = path;
        back.disabled = history.length === 0;
        window.scrollTo(0, 0);
    } catch (err) {
        doc.textContent = `Could not open ${relativePath}: ${err.message}`;
    }
}

doc.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
        link.target = '_blank';
        return;
    }
    event.preventDefault();
    if (href.startsWith('#')) return;
    show(resolveDoc(current ?? HOME, href));
});

back.addEventListener('click', () => { if (history.length) show(history.pop(), false); });
document.getElementById('home').addEventListener('click', () => show(HOME));

show(HOME);
