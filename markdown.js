// A small Markdown renderer for the Help window: headings, paragraphs, lists, fenced code,
// inline code, emphasis, links and simple tables. Everything is HTML-escaped first.

const escapeHtml = text => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function inline(text) {
    const codes = [];
    let html = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code) => `\u0000${codes.push(code) - 1}\u0000`);
    html = html
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => `<a href="${href}">${label}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    return html.replace(/\u0000(\d+)\u0000/g, (_m, index) => `<code>${codes[Number(index)]}</code>`);
}

export function renderMarkdown(source) {
    const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let paragraph = [];
    let list = null;

    const flushParagraph = () => {
        if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
        paragraph = [];
    };
    const flushList = () => {
        if (list) out.push(`<${list.tag}>${list.items.map(item => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`);
        list = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = line.match(/^\s*```/);
        if (fence) {
            flushParagraph(); flushList();
            const code = [];
            while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
            out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushParagraph(); flushList();
            out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
            continue;
        }
        if (/^\s*\|.*\|\s*$/.test(line)) {
            flushParagraph(); flushList();
            const rows = [];
            for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(lines[i]);
            i--;
            const cells = row => row.trim().slice(1, -1).split('|').map(cell => cell.trim());
            const body = rows.filter(row => !/^\s*\|[\s:|-]+\|\s*$/.test(row));
            const [head, ...rest] = body;
            out.push(`<table><thead><tr>${cells(head).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
                rest.map(row => `<tr>${cells(row).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
            continue;
        }
        const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (item) {
            flushParagraph();
            const tag = /\d/.test(item[1]) ? 'ol' : 'ul';
            if (list && list.tag !== tag) flushList();
            list ??= { tag, items: [] };
            list.items.push(item[2]);
            continue;
        }
        if (!line.trim()) { flushParagraph(); flushList(); continue; }
        if (list && /^\s+\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
        flushList();
        paragraph.push(line.trim());
    }
    flushParagraph(); flushList();
    return out.join('\n');
}
