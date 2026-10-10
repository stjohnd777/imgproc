// The view: draws the model into the DOM and forwards user input to the controller.
// It never changes the model itself.
import { cameraParameters } from './camera_parameters.js';
import { showSceneDialog } from './scene_dialog.js';
import { ELEMENT_CATEGORIES, elementCategory, elementIconName as pickElementIcon, fitScale, nodeParameterSummary } from './view_helpers.js';
import { buildConsole } from './tab_console.js';

// Custom drag type so only our own tabs are accepted as drops (not text/files dragged in from elsewhere).
const TAB_DRAG_TYPE = 'application/x-editor-tab';

const DROP_CLASSES = ['drag-over', 'drop-before', 'drop-after', 'drop-left', 'drop-right'];
const MIN_GROUP_WIDTH_PX = 120;
// Dropping within this fraction of a group's left/right edge creates a new split on that side.
const EDGE_ZONE = 0.25;

// Icon shapes on a 24x24 grid. Built with createElementNS (not innerHTML) so no markup is ever parsed.
const ICON_SHAPES = {
    folder: [
        ['path', { d: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z', fill: 'currentColor' }]
    ],
    image: [
        ['rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 1.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }],
        ['circle', { cx: 15.5, cy: 9.5, r: 1.6, fill: 'currentColor' }],
        ['path', { d: 'M5.5 17l4-4.5 3 3 2-2 4 3.5z', fill: 'currentColor' }]
    ],
    eye: [
        ['path', { d: 'M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }],
        ['circle', { cx: 12, cy: 12, r: 2.7, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }]
    ],
    file: [
        ['path', { d: 'M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h6', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }]
    ],
    camera: [
        ['path', { d: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }],
        ['circle', { cx: 12, cy: 13, r: 3.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }]
    ],
    algorithm: [
        ['circle', { cx: 6, cy: 7, r: 2.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }],
        ['circle', { cx: 6, cy: 17, r: 2.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }],
        ['circle', { cx: 18, cy: 12, r: 2.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }],
        ['path', { d: 'M8.2 8.1l7.6 2.9M8.2 15.9l7.6-2.9', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }]
    ],
    transform: [
        ['rect', { x: 4, y: 6, width: 16, height: 12, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }],
        ['path', { d: 'M8 15l3-6 2 4 1.5-2 1.5 4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }]
    ],
    storage: [
        ['ellipse', { cx: 12, cy: 6.5, rx: 7, ry: 2.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }],
        ['path', { d: 'M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }]
    ],
    workflow: [
        ['rect', { x: 2.5, y: 9.5, width: 5, height: 5, rx: 1, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }],
        ['rect', { x: 16.5, y: 3.5, width: 5, height: 5, rx: 1, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }],
        ['rect', { x: 16.5, y: 15.5, width: 5, height: 5, rx: 1, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }],
        ['path', { d: 'M7.5 12C12 12 12 6 16.5 6M7.5 12C12 12 12 18 16.5 18', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }]
    ],
    brain: [
        ['path', { d: 'M12 5.5v13M12 5.5A3 3 0 0 0 7 6.6a3 3 0 0 0-2.6 4.1A3 3 0 0 0 5.3 16a3 3 0 0 0 3.4 2.9A3 3 0 0 0 12 18.5M12 5.5a3 3 0 0 1 5-1.1 3 3 0 0 1 2.6 4.1 3 3 0 0 1-.9 5.3 3 3 0 0 1-3.4 2.9A3 3 0 0 1 12 18.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }],
        ['path', { d: 'M8.5 10.5c1 0 1.8.6 2 1.5M15.5 10.5c-1 0-1.8.6-2 1.5M8 14.5h1.5M14.5 14.5H16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }]
    ],
    sliders: [
        ['path', { d: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' }],
        ['circle', { cx: 15, cy: 7, r: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7 }],
        ['circle', { cx: 9, cy: 12, r: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7 }],
        ['circle', { cx: 17, cy: 17, r: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7 }]
    ],
    grid: [
        ['path', { d: 'M4 4c5 3 11 3 16 0M4 20c5-3 11-3 16 0M4 4v16M20 4v16M9.3 5.2v13.6M14.7 5.2v13.6M4 12h16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }]
    ],
    edges: [
        ['path', { d: 'M4 18l4.5-8 3.5 5 2.5-3.5L20 18z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linejoin': 'round' }],
        ['path', { d: 'M4 5.5h3M10.5 5.5h3M17 5.5h3', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' }]
    ],
    crosshair: [
        ['circle', { cx: 12, cy: 12, r: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7 }],
        ['path', { d: 'M12 3v4M12 17v4M3 12h4M17 12h4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' }],
        ['circle', { cx: 12, cy: 12, r: 1.4, fill: 'currentColor' }]
    ],
    stereo: [
        ['rect', { x: 2.5, y: 8, width: 7, height: 6, rx: 1.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }],
        ['rect', { x: 14.5, y: 8, width: 7, height: 6, rx: 1.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }],
        ['path', { d: 'M6 14l6 6 6-6M9.5 11h5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-dasharray': '2 1.6', 'stroke-linecap': 'round' }]
    ],
    chart: [
        ['path', { d: 'M4 4v16h16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' }],
        ['path', { d: 'M8 16v-4M12 16V8M16 16v-6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }]
    ],
    sparkle: [
        ['path', { d: 'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }],
        ['circle', { cx: 18.5, cy: 18, r: 1.3, fill: 'currentColor' }],
        ['circle', { cx: 5.5, cy: 18.5, r: 1, fill: 'currentColor' }]
    ],
    branch: [
        ['circle', { cx: 5.5, cy: 12, r: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }],
        ['circle', { cx: 18.5, cy: 5.5, r: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }],
        ['circle', { cx: 18.5, cy: 18.5, r: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }],
        ['path', { d: 'M7.5 12h3c2 0 2.5-6.5 6-6.5M10.5 12c2 0 2.5 6.5 6 6.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }]
    ],
    gear: [
        ['circle', { cx: 12, cy: 12, r: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }],
        ['path', { d: 'M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }]
    ]
};

// Custom drag type for palette elements, so only they can be dropped onto a workflow canvas.
const ELEMENT_DRAG_TYPE = 'application/x-workflow-element';

// Structural roles, with the icon used when an element doesn't name a known one.
const ELEMENT_KINDS = [
    { kind: 'source', icon: 'image' },
    { kind: 'transform', icon: 'transform' },
    { kind: 'sink', icon: 'storage' }
];

const WORKFLOW_CANVAS_SIZE = { width: 3000, height: 2000 };

const SVG_NS = 'http://www.w3.org/2000/svg';

// Cubic bezier between two ports. Outputs leave to the right; telemetry leaves downward.
function edgePath(p1, p2, fromDirection) {
    const bend = Math.max(40, Math.abs(p2.x - p1.x) / 2);
    const c1 = fromDirection === 'telemetry' ? { x: p1.x, y: p1.y + bend } : { x: p1.x + bend, y: p1.y };
    const c2 = { x: p2.x - bend, y: p2.y };
    return {
        d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`,
        mid: { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 }
    };
}

const ICON_NAMES = new Set(Object.keys(ICON_SHAPES));
const KIND_ICONS = Object.fromEntries(ELEMENT_KINDS.map(({ kind, icon }) => [kind, icon]));

function elementIconName(element) {
    return pickElementIcon(element, ICON_NAMES, KIND_ICONS);
}

// Per side bar view: Activity Bar title, spec folder, tree icon, and the field used as a collapsed preview.
const SPEC_VIEWS = {
    cameras: { title: 'Cameras', folder: 'camera_spec/', icon: 'camera', iconClass: 'icon-camera', preview: spec => spec.sensor?.model ?? '' },
    algorithms: { title: 'Algorithms', folder: 'algo_spec/', icon: 'algorithm', iconClass: 'icon-algorithm', preview: spec => spec.vertical ?? '' }
};

// Per-extension CSS class, so each image type gets its own colour.
const IMAGE_ICON_CLASS = { png: 'icon-png', jpg: 'icon-jpg', jpeg: 'icon-jpg', bmp: 'icon-bmp', webp: 'icon-webp' };

function createIcon(shape, extraClass = '') {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `icon ${extraClass}`.trim());
    svg.setAttribute('aria-hidden', 'true');

    for (const [tag, attrs] of ICON_SHAPES[shape]) {
        const el = document.createElementNS(SVG_NS, tag);
        for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
        svg.appendChild(el);
    }
    return svg;
}

function imageIconFor(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    return createIcon('image', IMAGE_ICON_CLASS[ext] ?? '');
}

const isContainer = value => value !== null && typeof value === 'object';

// Short arrays of plain values (e.g. ["UYVY", "MJPEG"], a matrix row) read better on one line.
function isInlineArray(value) {
    return Array.isArray(value) && value.every(item =>
        typeof item === 'number' || typeof item === 'boolean' || (typeof item === 'string' && item.length <= 20));
}

function formatValue(value) {
    if (value === null) return '—';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

// One-line summary of a collapsed object, e.g. a video mode: "UYVY · 1280 · 720 · 60".
function previewOf(value) {
    if (!isContainer(value) || Array.isArray(value)) return '';
    return Object.values(value).filter(v => !isContainer(v) && v !== null).slice(0, 4).join(' · ');
}

export class View {

    constructor(model, { editorArea, sideBar, activityButtons }, toolbarActions, { sideBarModel, explorer, results, specs, thresholdModal, disparityModal }) {
        this.model = model;
        this.sideBarModel = sideBarModel;
        this.explorer = explorer;
        this.results = results;
        this.specs = specs;   // { cameras: SpecModel, algorithms: SpecModel }
        this.thresholdModal = thresholdModal;
        // Last values used in each parameter dialog, so reopening it starts from them.
        this.dialogDefaults = {};
        this.collapsedPaletteCategories = new Set();
        this.disparityModal = disparityModal;
        this.editorArea = editorArea;
        this.sideBar = sideBar;
        this.activityButtons = activityButtons;   // { explorer: <button>, cameras: <button>, ... }
        this.toolbarActions = toolbarActions;
        this.controller = null;
        this.resultFolderMenu = null;
        this.resultFolderMenuDismiss = null;
        this.resultFolderMenuKeydown = null;

        for (const [viewName, button] of Object.entries(activityButtons)) {
            button.addEventListener('click', () => this.controller.toggleSideBarView(viewName));
        }
    }

    // Set after construction because the controller also needs a reference to this view.
    setController(controller) {
        this.controller = controller;
        window.addEventListener('keydown', event => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
            const target = event.target;
            if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return;
            const tab = this.model.getActiveTab();
            if (tab?.type !== 'workflow') return;
            event.preventDefault();
            this.controller.saveWorkflow(tab.id, event.shiftKey);
        });
        window.addEventListener('keydown', event => this.handleWorkflowEditKey(event));
    }

    // Workflow editing shortcuts. They apply only when focus is on the workflow canvas (or nowhere),
    // never while typing in a field, using another focused control, or with a dialog open.
    handleWorkflowEditKey(event) {
        const target = event.target;
        if (target !== document.body && !target?.classList?.contains('workflow-viewport')) return;
        if ([...document.querySelectorAll('.modal')].some(modal => modal.offsetParent !== null)) return;
        const tab = this.model.getActiveTab();
        if (tab?.type !== 'workflow') return;

        const command = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();
        const actions = {
            a: () => this.controller.selectAllWorkflowNodes(tab.id),
            c: () => {
                // Leave ordinary text copying alone when text is highlighted.
                if (String(window.getSelection?.() ?? '')) return false;
                return this.controller.copyWorkflowSelection(tab.id);
            },
            x: () => this.controller.cutWorkflowSelection(tab.id),
            v: () => this.controller.pasteWorkflowClipboard(tab.id),
            d: () => this.controller.duplicateWorkflowSelection(tab.id),
            z: () => event.shiftKey ? this.controller.redoWorkflow(tab.id) : this.controller.undoWorkflow(tab.id),
            y: () => this.controller.redoWorkflow(tab.id)
        };
        let handled;
        if (command && actions[key]) handled = actions[key]();
        else if (!command && (event.key === 'Delete' || event.key === 'Backspace')) {
            handled = Boolean(tab.selectedNodeIds?.length || tab.selectedEdgeId);
            this.controller.deleteWorkflowSelection(tab.id);
        } else if (!command && event.key === 'Escape') {
            handled = Boolean(tab.selectedNodeIds?.length || tab.selectedEdgeId);
            if (handled) {
                this.model.selectWorkflowEdge(tab.id, null);
                this.controller.setWorkflowSelection(tab.id, []);
            }
        } else return;
        if (handled !== false) event.preventDefault();
    }

    render() {
        for (const composer of this.composerViews ?? []) composer.dispose();
        this.composerViews = [];
        this.closeResultFolderMenu();
        this.renderSideBar();

        this.editorArea.innerHTML = '';
        const groups = this.model.getGroups();
        const groupEls = groups.map(group => this.buildGroup(group));

        groupEls.forEach((groupEl, i) => {
            if (i > 0) {
                this.editorArea.appendChild(this.buildSash(groups[i - 1], groups[i], groupEls[i - 1], groupEl));
            }
            this.editorArea.appendChild(groupEl);
        });
    }

    renderSideBar() {
        const activeView = this.sideBarModel.activeView;
        for (const [viewName, button] of Object.entries(this.activityButtons)) {
            button.classList.toggle('active', viewName === activeView);
        }

        this.sideBar.hidden = activeView === null;
        this.sideBar.innerHTML = '';
        if (activeView === 'explorer') this.renderExplorer();
        else if (activeView === 'results') this.renderResults();
        else if (activeView === 'elements') this.renderElementPalette();
        else if (activeView === 'scenes') {
            this.buildSideBarHeader('Scene Composer');
            const button = document.createElement('button');
            button.className = 'open-folder-btn';
            button.textContent = 'Open Scene Composer';
            button.addEventListener('click', () => this.controller.openSceneComposer());
            this.sideBar.appendChild(button);
            const help = document.createElement('p');
            help.className = 'sidebar-message';
            help.textContent = 'Place GLB models and cameras in a static SynC scene. Model and saved-scene folders are configured in app.json.';
            this.sideBar.appendChild(help);
        }
        else if (activeView in SPEC_VIEWS) this.renderSpecs(activeView);
    }

    renderElementPalette() {
        const header = this.buildSideBarHeader('Workflow');
        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'header-btn';
        reloadBtn.textContent = '⟳';
        reloadBtn.title = 'Reload elements/';
        reloadBtn.addEventListener('click', () => this.controller.reloadSpecs('elements'));
        header.appendChild(reloadBtn);

        const newBtn = document.createElement('button');
        newBtn.className = 'open-folder-btn';
        newBtn.textContent = 'New Workflow';
        newBtn.addEventListener('click', () => this.controller.newWorkflow());
        this.sideBar.appendChild(newBtn);

        const openWorkflowBtn = document.createElement('button');
        openWorkflowBtn.className = 'open-folder-btn';
        openWorkflowBtn.textContent = 'Open Workflow';
        openWorkflowBtn.addEventListener('click', () => this.controller.openWorkflow());
        this.sideBar.appendChild(openWorkflowBtn);

        const items = this.specs.elements.specs;
        if (items === null || items.length === 0) {
            const message = document.createElement('div');
            message.className = 'file-list-empty';
            message.textContent = items === null ? 'Loading…' : 'No files in elements/';
            this.sideBar.appendChild(message);
            return;
        }

        const hint = document.createElement('div');
        hint.className = 'palette-hint';
        hint.textContent = 'Drag an element onto a workflow canvas.';
        this.sideBar.appendChild(hint);

        const valid = items.filter(item => ELEMENT_KINDS.some(k => k.kind === item.spec?.kind));
        const known = new Set(ELEMENT_CATEGORIES.map(c => c.category));
        const sections = [
            ...ELEMENT_CATEGORIES,
            // Categories not listed above still get a section, so new ones need no code change.
            ...[...new Set(valid.map(item => elementCategory(item.spec)))]
                .filter(category => !known.has(category))
                .map(category => ({ category, title: category.charAt(0).toUpperCase() + category.slice(1) }))
        ];

        for (const { category, title } of sections) {
            const elements = valid.filter(item => elementCategory(item.spec) === category);
            if (elements.length === 0) continue;

            const heading = document.createElement('button');
            heading.type = 'button';
            heading.className = 'palette-heading';
            const twisty = document.createElement('span');
            twisty.className = 'palette-twisty';
            twisty.setAttribute('aria-hidden', 'true');
            heading.appendChild(twisty);
            const categoryIcon = ELEMENT_CATEGORIES.find(entry => entry.category === category)?.icon;
            if (categoryIcon in ICON_SHAPES) heading.appendChild(createIcon(categoryIcon, 'palette-heading-icon'));
            const headingLabel = document.createElement('span');
            headingLabel.textContent = `${title} (${elements.length})`;
            heading.appendChild(headingLabel);
            this.sideBar.appendChild(heading);

            const list = document.createElement('ul');
            list.className = 'palette-list';
            list.id = `palette-category-${encodeURIComponent(category)}`;
            heading.setAttribute('aria-controls', list.id);
            const updateExpanded = () => {
                const expanded = !this.collapsedPaletteCategories.has(category);
                heading.setAttribute('aria-expanded', String(expanded));
                twisty.textContent = expanded ? '▾' : '▸';
                list.hidden = !expanded;
            };
            updateExpanded();
            heading.addEventListener('click', () => {
                if (this.collapsedPaletteCategories.has(category)) {
                    this.collapsedPaletteCategories.delete(category);
                } else {
                    this.collapsedPaletteCategories.add(category);
                }
                updateExpanded();
            });
            for (const { file, spec } of elements) {
                const item = document.createElement('li');
                item.className = `palette-item wf-${spec.kind}`;
                item.draggable = true;
                item.title = spec.exec ? (spec.summary ?? spec.name) : `${spec.summary ?? spec.name}\n(Not runnable yet: no "exec" in ${file})`;
                item.appendChild(createIcon(elementIconName(spec), 'wf-kind-icon'));
                const label = document.createElement('span');
                label.textContent = spec.name ?? file;
                item.appendChild(label);
                item.addEventListener('dragstart', event => {
                    event.dataTransfer.setData(ELEMENT_DRAG_TYPE, file);
                    event.dataTransfer.effectAllowed = 'copy';
                });
                list.appendChild(item);
            }
            this.sideBar.appendChild(list);
        }

        // Files without a known kind, or that failed to parse, are listed so they aren't silently missing.
        const others = items.filter(item => !valid.includes(item));
        for (const { file, error } of others) {
            const row = document.createElement('div');
            row.className = 'tree-row tree-error';
            row.textContent = error ? `${file}: invalid JSON` : `${file}: missing "kind"`;
            if (error) row.title = error;
            this.sideBar.appendChild(row);
        }
    }

    buildSideBarHeader(title) {
        const header = document.createElement('div');
        header.className = 'side-bar-header';
        const titleEl = document.createElement('span');
        titleEl.textContent = title;
        header.appendChild(titleEl);
        this.sideBar.appendChild(header);
        return header;
    }

    renderExplorer() {
        this.buildSideBarHeader('Explorer');

        const openBtn = document.createElement('button');
        openBtn.className = 'open-folder-btn';
        openBtn.textContent = 'Open Folder…';
        openBtn.addEventListener('click', () => this.controller.openFolder());
        this.sideBar.appendChild(openBtn);

        const folder = this.explorer.folder;
        if (!folder) return;

        const folderName = document.createElement('div');
        folderName.className = 'folder-name';
        folderName.title = folder.folder;
        folderName.appendChild(createIcon('folder', 'icon-folder'));
        const folderLabel = document.createElement('span');
        folderLabel.textContent = folder.name;
        folderName.appendChild(folderLabel);
        this.sideBar.appendChild(folderName);

        if (folder.tree.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'file-list-empty';
            empty.textContent = 'No images in this folder';
            this.sideBar.appendChild(empty);
            return;
        }

        const activePath = this.model.getActiveTab()?.path;
        this.sideBar.appendChild(this.buildImageTree(folder.tree, activePath));
    }

    // The results folder from app.json: the same tree, pointed at finished runs.
    renderResults() {
        this.buildSideBarHeader('Workflow Results');

        const refresh = document.createElement('button');
        refresh.className = 'open-folder-btn';
        refresh.textContent = 'Refresh';
        refresh.addEventListener('click', () => this.controller.reloadResults());
        this.sideBar.appendChild(refresh);

        const folder = this.results.folder;
        if (!folder) return;

        const folderName = document.createElement('div');
        folderName.className = 'folder-name';
        folderName.title = folder.folder;
        folderName.appendChild(createIcon('folder', 'icon-folder'));
        const folderLabel = document.createElement('span');
        folderLabel.textContent = folder.name;
        folderName.appendChild(folderLabel);
        this.sideBar.appendChild(folderName);

        if (folder.tree.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'file-list-empty';
            empty.textContent = 'No runs yet. Run a workflow to see results here.';
            this.sideBar.appendChild(empty);
            return;
        }

        const activePath = this.model.getActiveTab()?.path;
        this.sideBar.appendChild(this.buildImageTree(folder.tree, activePath, this.results,
            path => this.controller.toggleResultsFolder(path), true));
    }

    buildImageTree(nodes, activePath, browser = this.explorer, onToggleFolder = path => this.controller.toggleExplorerFolder(path), resultsTree = false) {
        const list = document.createElement('ul');
        list.className = 'file-tree';

        nodes.forEach(node => {
            if (node.type === 'folder') {
                const item = document.createElement('li');
                const folderRow = document.createElement('div');
                const canDelete = resultsTree && Boolean(node.deleteKind);
                folderRow.className = `folder-row${resultsTree ? ' result-folder-row' : ''}${browser.selectedPath === node.path ? ' selected' : ''}`;
                folderRow.tabIndex = canDelete ? 0 : -1;
                if (resultsTree) folderRow.setAttribute('aria-selected', String(browser.selectedPath === node.path));
                const expanded = browser.isExpanded(node.path);
                const chevron = document.createElement('span');
                chevron.className = 'folder-chevron';
                chevron.textContent = expanded ? '▾' : '▸';
                folderRow.appendChild(chevron);
                folderRow.appendChild(createIcon('folder', 'icon-folder'));
                const label = document.createElement('span');
                label.textContent = node.name;
                folderRow.appendChild(label);
                folderRow.title = node.path;
                folderRow.addEventListener('click', () => onToggleFolder(node.path));
                if (canDelete) {
                    folderRow.addEventListener('contextmenu', event => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.showResultFolderMenu(event, node);
                    });
                    folderRow.addEventListener('keydown', event => {
                        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                        event.preventDefault();
                        event.stopPropagation();
                        this.controller.deleteResult(node.path, node.deleteKind);
                    });
                }
                item.appendChild(folderRow);
                if (expanded) item.appendChild(this.buildImageTree(node.children, activePath, browser, onToggleFolder, resultsTree));
                list.appendChild(item);
                return;
            }

            const item = document.createElement('li');
            item.className = 'file-item' + (node.path === activePath ? ' active' : '');
            item.appendChild(imageIconFor(node.name));
            const fileLabel = document.createElement('span');
            fileLabel.textContent = node.name;
            item.appendChild(fileLabel);
            item.title = node.path;
            item.addEventListener('click', () => this.controller.openImage(node));
            list.appendChild(item);
        });

        return list;
    }

    showResultFolderMenu(event, node) {
        this.closeResultFolderMenu();
        const menu = document.createElement('div');
        menu.className = 'results-context-menu';
        menu.setAttribute('role', 'menu');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = node.deleteKind === 'workflow' ? 'Delete Workflow' : 'Delete Run';
        remove.setAttribute('role', 'menuitem');
        remove.addEventListener('click', () => {
            this.closeResultFolderMenu();
            this.controller.deleteResult(node.path, node.deleteKind);
        });
        menu.appendChild(remove);
        menu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - 164))}px`;
        menu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - 44))}px`;
        document.body.appendChild(menu);

        this.resultFolderMenu = menu;
        this.resultFolderMenuDismiss = pointerEvent => {
            if (!menu.contains(pointerEvent.target)) this.closeResultFolderMenu();
        };
        this.resultFolderMenuKeydown = keyEvent => {
            if (keyEvent.key === 'Escape') this.closeResultFolderMenu();
        };
        window.addEventListener('pointerdown', this.resultFolderMenuDismiss, true);
        window.addEventListener('keydown', this.resultFolderMenuKeydown, true);
        remove.focus();
    }

    closeResultFolderMenu() {
        if (!this.resultFolderMenu) return;
        this.resultFolderMenu.remove();
        window.removeEventListener('pointerdown', this.resultFolderMenuDismiss, true);
        window.removeEventListener('keydown', this.resultFolderMenuKeydown, true);
        this.resultFolderMenu = null;
        this.resultFolderMenuDismiss = null;
        this.resultFolderMenuKeydown = null;
    }

    renderSpecs(kind) {
        const { title, folder, icon, iconClass, preview } = SPEC_VIEWS[kind];

        const header = this.buildSideBarHeader(title);
        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'header-btn';
        reloadBtn.textContent = '⟳';
        reloadBtn.title = `Reload ${folder}`;
        reloadBtn.addEventListener('click', () => this.controller.reloadSpecs(kind));
        header.appendChild(reloadBtn);

        const specs = this.specs[kind].specs;
        if (specs === null || specs.length === 0) {
            const message = document.createElement('div');
            message.className = 'file-list-empty';
            message.textContent = specs === null ? 'Loading…' : `No files in ${folder}`;
            this.sideBar.appendChild(message);
            return;
        }

        const tree = document.createElement('ul');
        tree.className = 'tree';
        for (const { file, spec, error } of specs) {
            if (error) {
                tree.appendChild(this.buildTreeError(kind, file, error));
            } else {
                tree.appendChild(this.buildTreeNode(kind, spec.name ?? file, spec, file, 0, {
                    icon,
                    iconClass,
                    preview: preview(spec),
                    title: folder + file
                }));
            }
        }
        this.sideBar.appendChild(tree);
    }

    buildTreeError(kind, file, error) {
        const item = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'tree-row tree-error tree-expandable';
        row.title = `${error} — Click to open and fix in editor`;

        const chevron = document.createElement('span');
        chevron.className = 'tree-chevron';
        row.appendChild(chevron);

        const label = document.createElement('span');
        label.className = 'tree-key';
        label.textContent = `${file}: invalid JSON`;
        row.appendChild(label);

        const openBtn = document.createElement('button');
        openBtn.className = 'tree-open-btn';
        openBtn.title = `Open ${file} in editor tab`;
        openBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        openBtn.addEventListener('click', event => {
            event.stopPropagation();
            this.controller.openSpec(kind, file);
        });
        row.appendChild(openBtn);

        row.addEventListener('click', () => this.controller.openSpec(kind, file));
        item.appendChild(row);
        return item;
    }

    // Draws one key/value of a spec. Objects and longer arrays expand into child nodes;
    // `path` identifies the node so its expanded state survives re-renders.
    buildTreeNode(kind, label, value, path, depth, { icon = null, iconClass = '', preview = null, title = '' } = {}) {
        const item = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'tree-row' + (depth === 0 ? ' tree-root' : '');
        row.style.paddingLeft = `${8 + depth * 14}px`;
        if (title) row.title = title;

        const expandable = isContainer(value) && !isInlineArray(value) && Object.keys(value).length > 0;
        const expanded = expandable && this.specs[kind].isExpanded(path);

        const chevron = document.createElement('span');
        chevron.className = 'tree-chevron';
        chevron.textContent = expandable ? (expanded ? '▾' : '▸') : '';
        row.appendChild(chevron);

        if (icon) row.appendChild(createIcon(icon, iconClass));

        const keyEl = document.createElement('span');
        keyEl.className = 'tree-key';
        keyEl.textContent = label;
        row.appendChild(keyEl);

        if (depth === 0) {
            chevron.addEventListener('click', event => {
                event.stopPropagation();
                this.controller.toggleSpecNode(kind, path);
            });

            keyEl.title = `Click to open ${path} in editor tab`;
            keyEl.addEventListener('click', event => {
                event.stopPropagation();
                this.controller.openSpec(kind, path);
            });

            const openBtn = document.createElement('button');
            openBtn.className = 'tree-open-btn';
            openBtn.title = `Open ${path} in editor tab`;
            openBtn.setAttribute('aria-label', `Open ${path}`);
            openBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
            openBtn.addEventListener('click', event => {
                event.stopPropagation();
                this.controller.openSpec(kind, path);
            });
            row.appendChild(openBtn);

            row.addEventListener('dblclick', event => {
                event.stopPropagation();
                this.controller.openSpec(kind, path);
            });
        }

        if (expandable) {
            const previewText = preview ?? previewOf(value);
            if (previewText && !expanded) {
                const previewEl = document.createElement('span');
                previewEl.className = 'tree-preview';
                previewEl.textContent = previewText;
                row.appendChild(previewEl);
            }
            row.classList.add('tree-expandable');
            row.addEventListener('click', () => this.controller.toggleSpecNode(kind, path));
        } else {
            const valueEl = document.createElement('span');
            valueEl.className = 'tree-value' + (value === null ? ' tree-null' : '');
            valueEl.textContent = isContainer(value) && Object.keys(value).length === 0 ? '(empty)' : formatValue(value);
            if (value === null) valueEl.title = 'unknown';
            row.appendChild(valueEl);
        }
        item.appendChild(row);

        if (expanded) {
            const children = document.createElement('ul');
            children.className = 'tree';
            for (const [key, child] of Object.entries(value)) {
                // An array of named entries reads better labelled by name than by index.
                const childLabel = Array.isArray(value) ? (child?.name ?? `[${key}]`) : key;
                children.appendChild(this.buildTreeNode(kind, childLabel, child, `${path}/${key}`, depth + 1));
            }
            item.appendChild(children);
        }
        return item;
    }

    buildGroup(group) {
        const groupEl = document.createElement('div');
        groupEl.className = 'editor-group' + (this.model.isActiveGroup(group.id) ? ' active' : '');
        groupEl.style.flex = `${group.size} 1 0`;

        groupEl.appendChild(this.buildTabBar(group));

        const content = document.createElement('div');
        content.className = 'group-content';
        this.renderContent(content, this.model.getTab(group.activeTabId));

        const zoneAt = event => {
            const rect = content.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width;
            if (x < EDGE_ZONE) return 'left';
            if (x > 1 - EDGE_ZONE) return 'right';
            return 'center';
        };
        this.makeDropTarget(content, {
            hoverClass: event => ({ left: 'drop-left', right: 'drop-right', center: 'drag-over' })[zoneAt(event)],
            onDrop: (tabId, event) => {
                const zone = zoneAt(event);
                if (zone === 'center') this.controller.moveTab(tabId, group.id);
                else this.controller.splitWithTab(tabId, group.id, zone);
            }
        });
        groupEl.appendChild(content);

        return groupEl;
    }

    // The draggable divider between two groups. While dragging it only restyles the two groups;
    // the model is updated once on release (re-rendering mid-drag would destroy this element).
    buildSash(leftGroup, rightGroup, leftEl, rightEl) {
        const sash = document.createElement('div');
        sash.className = 'sash';

        sash.addEventListener('pointerdown', event => {
            event.preventDefault();
            sash.setPointerCapture(event.pointerId);
            sash.classList.add('active');
            document.body.classList.add('resizing');

            const startX = event.clientX;
            const leftStart = leftEl.getBoundingClientRect().width;
            const rightStart = rightEl.getBoundingClientRect().width;
            const pairWidth = leftStart + rightStart;
            // Keep the pair's combined weight, so groups outside the pair don't change size.
            const pairSize = leftGroup.size + rightGroup.size;
            let leftSize = leftGroup.size;
            let rightSize = rightGroup.size;

            const onMove = moveEvent => {
                if (pairWidth <= 2 * MIN_GROUP_WIDTH_PX) return;
                const leftWidth = Math.min(pairWidth - MIN_GROUP_WIDTH_PX,
                    Math.max(MIN_GROUP_WIDTH_PX, leftStart + moveEvent.clientX - startX));
                leftSize = pairSize * (leftWidth / pairWidth);
                rightSize = pairSize - leftSize;
                leftEl.style.flex = `${leftSize} 1 0`;
                rightEl.style.flex = `${rightSize} 1 0`;
            };

            const onUp = () => {
                sash.removeEventListener('pointermove', onMove);
                sash.removeEventListener('pointerup', onUp);
                sash.removeEventListener('pointercancel', onUp);
                document.body.classList.remove('resizing');
                this.controller.resizeGroups(leftGroup.id, rightGroup.id, leftSize, rightSize);
            };

            sash.addEventListener('pointermove', onMove);
            sash.addEventListener('pointerup', onUp);
            sash.addEventListener('pointercancel', onUp);
        });

        return sash;
    }

    buildTabBar(group) {
        const tabBar = document.createElement('div');
        tabBar.className = 'tab-bar';
        this.makeDropTarget(tabBar, {
            onDrop: tabId => this.controller.moveTab(tabId, group.id)
        });

        group.tabs.forEach((tab, index) => {
            tabBar.appendChild(this.buildTab(tab, group, index));
        });

        const spacer = document.createElement('div');
        spacer.className = 'tab-bar-spacer';
        tabBar.appendChild(spacer);

        const splitBtn = document.createElement('button');
        splitBtn.className = 'split-btn';
        splitBtn.textContent = '◫';
        splitBtn.title = 'Split editor right';
        splitBtn.disabled = group.tabs.length === 0;
        splitBtn.addEventListener('click', () => this.controller.splitGroup(group.id));
        tabBar.appendChild(splitBtn);

        return tabBar;
    }

    buildTab(tab, group, index) {
        const el = document.createElement('div');
        el.className = 'tab' + (group.activeTabId === tab.id ? ' active' : '');
        el.dataset.tabId = tab.id;
        el.draggable = true;

        const label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = tab.dirty ? `● ${tab.label}` : tab.label;
        label.title = tab.type === 'workflow' ? 'Double-click to rename workflow' : (tab.dirty ? `${tab.label} (modified)` : tab.label);
        el.appendChild(label);

        // Rename in place. Workflow names become the run folder, so they are worth being able to set.
        const startRename = () => {
            if (tab.type !== 'workflow') return;
            if (el.querySelector('.tab-rename')) return;
            const input = document.createElement('input');
            input.className = 'tab-rename';
            input.value = tab.label;
            el.draggable = false;
            label.replaceWith(input);
            input.focus();
            input.select();

            let finished = false;
            const finish = commit => {
                if (finished) return;
                finished = true;
                el.draggable = true;
                if (commit && input.value.trim() && input.value.trim() !== tab.label) {
                    this.controller.renameTab(tab.id, input.value);
                } else {
                    this.render();
                }
            };
            input.addEventListener('keydown', keyEvent => {
                keyEvent.stopPropagation();
                if (keyEvent.key === 'Enter') finish(true);
                else if (keyEvent.key === 'Escape') finish(false);
            });
            input.addEventListener('blur', () => finish(true));
            input.addEventListener('click', clickEvent => clickEvent.stopPropagation());
            input.addEventListener('dblclick', clickEvent => clickEvent.stopPropagation());
        };

        el.addEventListener('dblclick', event => {
            if (event.target.closest('.close-btn') || event.target.closest('.tab-rename')) return;
            event.stopPropagation();
            startRename();
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.textContent = '✕';
        closeBtn.title = `Close ${tab.label}`;
        // Stop the click from also bubbling up to the tab's own "select" handler.
        closeBtn.addEventListener('click', event => {
            event.stopPropagation();
            if (tab.dirty && !window.confirm(`"${tab.label}" has unsaved changes. Discard and close?`)) {
                return;
            }
            this.controller.closeTab(tab.id);
        });
        el.appendChild(closeBtn);

        el.addEventListener('click', event => {
            if (event.target.closest('.close-btn') || event.target.closest('.tab-rename')) return;
            const now = Date.now();
            if (this._lastTabClick && this._lastTabClick.tabId === tab.id && (now - this._lastTabClick.time) < 400) {
                this._lastTabClick = null;
                startRename();
                return;
            }
            this._lastTabClick = { tabId: tab.id, time: now };
            this.controller.selectTab(tab.id);
        });

        el.addEventListener('dragstart', event => {
            event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
            event.dataTransfer.effectAllowed = 'move';
            el.classList.add('dragging');
        });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));

        // Drop on the left half of a tab = insert before it, right half = after it.
        const dropIndex = event => {
            const rect = el.getBoundingClientRect();
            return event.clientX < rect.left + rect.width / 2 ? index : index + 1;
        };
        this.makeDropTarget(el, {
            hoverClass: event => dropIndex(event) === index ? 'drop-before' : 'drop-after',
            onDrop: (tabId, event) => this.controller.moveTab(tabId, group.id, dropIndex(event))
        });

        return el;
    }

    // Wires up HTML5 drag-and-drop so a dragged tab can be dropped on `el`.
    makeDropTarget(el, { hoverClass = () => 'drag-over', onDrop }) {
        const clear = () => el.classList.remove(...DROP_CLASSES);

        el.addEventListener('dragover', event => {
            if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
            // Calling preventDefault is what tells the browser "a drop is allowed here".
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            clear();
            el.classList.add(hoverClass(event));
        });

        el.addEventListener('dragleave', event => {
            if (!el.contains(event.relatedTarget)) clear();
        });

        el.addEventListener('drop', event => {
            if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
            event.preventDefault();
            event.stopPropagation();
            clear();
            onDrop(event.dataTransfer.getData(TAB_DRAG_TYPE), event);
        });
    }

    renderContent(container, activeTab) {
        this.renderTabContent(container, activeTab);
        if (activeTab) container.appendChild(buildConsole(activeTab, () => this.render()));
    }

    refreshConsole(tab) {
        const panels = document.querySelectorAll('[data-console-tab]');
        for (const panel of panels) {
            if (panel.dataset.consoleTab !== tab.id) continue;
            const body = panel.querySelector('.console-output');
            if (body.hidden && tab.console.expanded) {
                panel.replaceWith(buildConsole(tab, () => this.render()));
                continue;
            }
            const top = body.scrollTop;
            body.value = tab.console.text;
            body.scrollTop = tab.console.follow ? body.scrollHeight : top;
        }
    }

    renderTabContent(container, activeTab) {
        if (!activeTab) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No image open';
            container.appendChild(empty);
            return;
        }

        if (activeTab.type === 'scene-composer') {
            const host = document.createElement('div');
            host.className = 'scene-composer-host';
            container.appendChild(host);
            import('./scene_composer.js').then(({ mountSceneComposer }) => {
                if (!host.isConnected) return;
                const composer = mountSceneComposer(host, activeTab, () => {
                    const label = this.editorArea.querySelector(`[data-tab-id="${activeTab.id}"] .tab-label`);
                    if (label) { label.textContent = activeTab.dirty ? `● ${activeTab.label}` : activeTab.label; label.title = activeTab.label; }
                });
                this.composerViews ??= [];
                this.composerViews.push(composer);
            }).catch(error => { if (host.isConnected) host.textContent = `Scene Composer failed: ${error.message}`; });
            return;
        }
        if (activeTab.type === 'workflow') {
            this.renderWorkflowCanvas(container, activeTab);
            return;
        }

        if (activeTab.type === 'json') {
            this.renderJsonEditor(container, activeTab);
            return;
        }

        if (activeTab.type === 'json-artifact' || activeTab.type === 'text-artifact') {
            this.renderJsonArtifact(container, activeTab);
            return;
        }

        container.appendChild(this.buildToolbar(activeTab));
        container.appendChild(this.buildZoomBar(activeTab));

        const imageView = document.createElement('div');
        imageView.className = 'image-view';

        const img = document.createElement('img');
        img.src = activeTab.resultSrc || activeTab.src;
        img.alt = activeTab.label;
        // Stops the browser's built-in "drag the image" behaviour.
        img.draggable = false;
        imageView.appendChild(img);
        container.appendChild(imageView);

        const statusBar = this.buildStatusBar(activeTab);
        container.appendChild(statusBar);

        this.attachImageHandlers(img, statusBar, activeTab);
    }

    attachImageHandlers(img, statusBar, tab) {
        const dimensionsText = () => {
            const base = `height: ${img.naturalHeight}px  width: ${img.naturalWidth}px  type: ${tab.pixelType}`;
            if (tab.serviceError) return `${base}  ⚠ ${tab.serviceError}`;
            if (tab.resultMeta) return `${base}  ${tab.activeAction}: ${tab.resultMeta.timingMs}ms`;
            return base;
        };

        // Browsers can't read an <img>'s raw bytes, so copy it into an off-screen canvas for getImageData.
        let pixelCtx = null;

        img.addEventListener('load', () => {
            statusBar.textContent = dimensionsText();

            const scale = tab.fitImage
                ? fitScale(img.naturalWidth, img.naturalHeight, img.parentElement.clientWidth - 24, img.parentElement.clientHeight - 24)
                : tab.zoom / 100;
            img.style.width = `${img.naturalWidth * scale}px`;
            img.style.height = `${img.naturalHeight * scale}px`;

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            pixelCtx = canvas.getContext('2d', { willReadFrequently: true });
            pixelCtx.drawImage(img, 0, 0);
        });

        img.addEventListener('mousemove', event => {
            if (!pixelCtx) return;

            // The <img> is displayed scaled, so map the mouse position back to real image pixels.
            const rect = img.getBoundingClientRect();
            const scaleX = img.naturalWidth / rect.width;
            const scaleY = img.naturalHeight / rect.height;
            const u = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor((event.clientX - rect.left) * scaleX)));
            const v = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor((event.clientY - rect.top) * scaleY)));

            const [r, g, b] = pixelCtx.getImageData(u, v, 1, 1).data;
            const value = Math.round((r + g + b) / 3); // grayscale approximation of the RGB triplet
            const percentage = ((value / 255) * 100).toFixed(1);

            statusBar.textContent = `u: ${u}  v: ${v}  value: ${value}  percentage: ${percentage}%`;
        });

        img.addEventListener('mouseleave', () => {
            statusBar.textContent = dimensionsText();
        });
    }

    renderJsonEditor(container, tab) {
        const editorWrapper = document.createElement('div');
        editorWrapper.className = 'json-editor-wrapper';

        const toolbar = document.createElement('div');
        toolbar.className = 'json-editor-toolbar';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'json-editor-btn primary';
        saveBtn.textContent = '💾 Save';
        saveBtn.title = 'Save changes to disk (Cmd+S / Ctrl+S)';

        const formatBtn = document.createElement('button');
        formatBtn.className = 'json-editor-btn';
        formatBtn.textContent = 'Format JSON';
        formatBtn.title = 'Reformat with 2-space indentation';

        const revertBtn = document.createElement('button');
        revertBtn.className = 'json-editor-btn';
        revertBtn.textContent = 'Revert';
        revertBtn.title = 'Discard unsaved changes and reload from disk';

        const statusEl = document.createElement('span');
        statusEl.className = 'json-editor-status';

        toolbar.append(saveBtn, formatBtn, revertBtn, statusEl);
        editorWrapper.appendChild(toolbar);

        const editorBody = document.createElement('div');
        editorBody.className = 'json-editor-body';

        const textarea = document.createElement('textarea');
        textarea.className = 'json-editor-textarea';
        textarea.value = tab.content ?? '';
        textarea.spellcheck = false;
        textarea.setAttribute('autocomplete', 'off');
        textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('autocapitalize', 'off');

        editorBody.appendChild(textarea);
        editorWrapper.appendChild(editorBody);

        const statusBar = document.createElement('div');
        statusBar.className = 'status-bar json-editor-statusbar';
        const fileInfo = document.createElement('span');
        fileInfo.textContent = tab.path ?? tab.label;
        const lineInfo = document.createElement('span');
        statusBar.append(fileInfo, lineInfo);
        editorWrapper.appendChild(statusBar);

        container.appendChild(editorWrapper);

        const updateStatus = () => {
            let syntaxOk = true;
            let parseErr = null;
            try {
                JSON.parse(textarea.value);
            } catch (e) {
                syntaxOk = false;
                parseErr = e.message;
            }

            if (tab.saveError) {
                statusEl.textContent = `⚠ ${tab.saveError}`;
                statusEl.className = 'json-editor-status status-error';
            } else if (!syntaxOk) {
                statusEl.textContent = `⚠ Syntax Error: ${parseErr}`;
                statusEl.className = 'json-editor-status status-error';
            } else if (tab.dirty) {
                statusEl.textContent = '● Modified';
                statusEl.className = 'json-editor-status status-modified';
            } else if (tab.lastSaved) {
                statusEl.textContent = `✓ Saved at ${tab.lastSaved}`;
                statusEl.className = 'json-editor-status status-saved';
            } else {
                statusEl.textContent = 'Valid JSON';
                statusEl.className = 'json-editor-status';
            }

            const lines = textarea.value.split('\n').length;
            const chars = textarea.value.length;
            lineInfo.textContent = `Lines: ${lines}  Characters: ${chars}`;

            const tabHeader = container.closest('.editor-group')?.querySelector(`.tab[data-tab-id="${tab.id}"] span`);
            if (tabHeader) {
                tabHeader.textContent = tab.dirty ? `● ${tab.label}` : tab.label;
            }
        };

        const onInput = () => {
            tab.content = textarea.value;
            tab.dirty = tab.content !== tab.cleanContent;
            tab.saveError = null;
            updateStatus();
        };

        textarea.addEventListener('input', onInput);

        const doSave = async () => {
            tab.saveError = null;
            try {
                JSON.parse(textarea.value);
            } catch (e) {
                tab.saveError = `Cannot save: ${e.message}`;
                updateStatus();
                return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            const res = await this.controller.saveSpecTab(tab.id, textarea.value);
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save';
            if (!res.success && res.error) {
                tab.saveError = res.error;
            }
            updateStatus();
        };

        saveBtn.addEventListener('click', doSave);

        formatBtn.addEventListener('click', () => {
            try {
                const parsed = JSON.parse(textarea.value);
                textarea.value = JSON.stringify(parsed, null, 2) + '\n';
                onInput();
            } catch (e) {
                tab.saveError = `Format error: ${e.message}`;
                updateStatus();
            }
        });

        revertBtn.addEventListener('click', () => {
            textarea.value = tab.cleanContent ?? '';
            onInput();
        });

        textarea.addEventListener('keydown', event => {
            if (event.key === 'Tab') {
                event.preventDefault();
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 2;
                onInput();
            } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                doSave();
            }
        });

        updateStatus();
    }

    renderJsonArtifact(container, tab) {
        const wrapper = document.createElement('div');
        wrapper.className = 'json-editor-wrapper';

        const toolbar = document.createElement('div');
        toolbar.className = 'json-editor-toolbar';
        const title = document.createElement('span');
        title.className = 'json-editor-status';
        title.textContent = tab.type === 'text-artifact' ? 'Text artifact · read only' : 'JSON artifact · read only';
        toolbar.appendChild(title);
        wrapper.appendChild(toolbar);

        const body = document.createElement('div');
        body.className = 'json-editor-body';
        const content = document.createElement('textarea');
        content.className = 'json-editor-textarea';
        content.value = tab.content ?? '';
        content.readOnly = true;
        content.spellcheck = false;
        body.appendChild(content);
        wrapper.appendChild(body);

        const status = document.createElement('div');
        status.className = 'status-bar json-editor-statusbar';
        const path = document.createElement('span');
        path.textContent = tab.path ?? tab.label;
        status.appendChild(path);
        wrapper.appendChild(status);

        container.appendChild(wrapper);
    }

    renderWorkflowCanvas(container, tab) {
        const viewport = document.createElement('div');
        viewport.className = 'workflow-viewport';
        // Focusable so Delete/Escape reach it after a connection is selected.
        viewport.tabIndex = 0;

        const canvas = document.createElement('div');
        canvas.className = 'workflow-canvas';
        canvas.style.width = `${WORKFLOW_CANVAS_SIZE.width}px`;
        canvas.style.height = `${WORKFLOW_CANVAS_SIZE.height}px`;
        const scale = tab.workflowScale ?? 1;
        canvas.style.transform = `scale(${scale})`;
        canvas.style.transformOrigin = 'top left';
        const extent = document.createElement('div');
        extent.style.width = `${WORKFLOW_CANVAS_SIZE.width * scale}px`;
        extent.style.height = `${WORKFLOW_CANVAS_SIZE.height * scale}px`;
        extent.style.position = 'relative';
        canvas.style.position = 'absolute';
        extent.appendChild(canvas);
        viewport.appendChild(extent);

        // Connections live in an SVG layer under the nodes.
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'workflow-edges');
        svg.setAttribute('width', WORKFLOW_CANVAS_SIZE.width);
        svg.setAttribute('height', WORKFLOW_CANVAS_SIZE.height);
        canvas.appendChild(svg);

        for (const node of tab.graph.nodes) {
            canvas.appendChild(this.buildWorkflowNode(tab, node));
        }

        if (tab.graph.nodes.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'workflow-empty';
            hint.textContent = 'Drag sources, transforms and sinks here from the Workflow side bar.';
            viewport.appendChild(hint);
        }

        // Port positions come from the laid-out DOM, so edges are measured rather than computed from node.x/y.
        const portCenter = (nodeId, port, direction) => {
            const dot = canvas.querySelector(
                `.workflow-port[data-node-id="${nodeId}"][data-direction="${direction}"][data-port="${CSS.escape(port)}"] .workflow-port-dot`);
            if (!dot) return null;
            const d = dot.getBoundingClientRect();
            const c = canvas.getBoundingClientRect();
            const scale = tab.workflowScale ?? 1;
            return { x: (d.left + d.width / 2 - c.left) / scale, y: (d.top + d.height / 2 - c.top) / scale };
        };

        const drawEdges = () => {
            svg.querySelectorAll('.workflow-edge-group').forEach(el => el.remove());
            canvas.querySelector('.workflow-edge-remove')?.remove();

            for (const edge of tab.graph.edges) {
                const p1 = portCenter(edge.from.nodeId, edge.from.port, edge.from.direction);
                const p2 = portCenter(edge.to.nodeId, edge.to.port, 'input');
                if (!p1 || !p2) continue;

                const { d, mid } = edgePath(p1, p2, edge.from.direction);
                const selected = edge.id === tab.selectedEdgeId;
                const group = document.createElementNS(SVG_NS, 'g');
                group.setAttribute('class', 'workflow-edge-group');

                const line = document.createElementNS(SVG_NS, 'path');
                line.setAttribute('d', d);
                line.setAttribute('class', `workflow-edge ${edge.from.direction}${selected ? ' selected' : ''}`);

                // A wide invisible stroke makes the thin wire easy to click.
                const hit = document.createElementNS(SVG_NS, 'path');
                hit.setAttribute('d', d);
                hit.setAttribute('class', 'workflow-edge-hit');
                hit.addEventListener('pointerdown', event => event.stopPropagation());
                hit.addEventListener('click', () => this.controller.selectWorkflowEdge(tab.id, edge.id));

                group.append(line, hit);
                svg.appendChild(group);

                if (selected) {
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'workflow-edge-remove';
                    removeBtn.textContent = '✕';
                    removeBtn.title = 'Remove connection (Delete)';
                    removeBtn.style.left = `${mid.x}px`;
                    removeBtn.style.top = `${mid.y}px`;
                    removeBtn.addEventListener('pointerdown', event => event.stopPropagation());
                    removeBtn.addEventListener('click', () => this.controller.removeWorkflowEdge(tab.id, edge.id));
                    canvas.appendChild(removeBtn);
                }
            }
        };

        canvas.workflow = { svg, portCenter, drawEdges };

        // Press on empty canvas to clear the selection, or drag to box-select nodes.
        // Shift/Cmd/Ctrl adds the boxed nodes to the current selection.
        canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0 || (event.target !== canvas && event.target !== svg)) return;
            event.preventDefault();
            viewport.focus({ preventScroll: true });
            const scale = tab.workflowScale ?? 1;
            const toCanvas = pointer => {
                const rect = canvas.getBoundingClientRect();
                return { x: (pointer.clientX - rect.left) / scale, y: (pointer.clientY - rect.top) / scale };
            };
            const start = toCanvas(event);
            const additive = event.shiftKey || event.metaKey || event.ctrlKey;
            const initial = additive ? [...(tab.selectedNodeIds ?? [])] : [];
            const nodeEls = [...canvas.querySelectorAll('.workflow-node')];
            let marquee = null;
            let selection = initial;

            const onMove = moveEvent => {
                if (!marquee && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < 3) return;
                if (!marquee) {
                    marquee = document.createElement('div');
                    marquee.className = 'workflow-marquee';
                    canvas.appendChild(marquee);
                }
                const point = toCanvas(moveEvent);
                const box = {
                    left: Math.min(start.x, point.x), top: Math.min(start.y, point.y),
                    right: Math.max(start.x, point.x), bottom: Math.max(start.y, point.y)
                };
                Object.assign(marquee.style, {
                    left: `${box.left}px`, top: `${box.top}px`,
                    width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px`
                });
                const boxed = nodeEls.filter(nodeEl => nodeEl.offsetLeft < box.right
                    && nodeEl.offsetLeft + nodeEl.offsetWidth > box.left
                    && nodeEl.offsetTop < box.bottom
                    && nodeEl.offsetTop + nodeEl.offsetHeight > box.top).map(nodeEl => nodeEl.dataset.nodeId);
                selection = [...new Set([...initial, ...boxed])];
                for (const nodeEl of nodeEls) nodeEl.classList.toggle('selected', selection.includes(nodeEl.dataset.nodeId));
            };
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                marquee?.remove();
                if (!marquee && !additive) this.model.selectWorkflowEdge(tab.id, null);
                if (marquee || !additive) this.controller.setWorkflowSelection(tab.id, selection);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        });

        viewport.addEventListener('dragover', event => {
            if (!event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            viewport.classList.add('drag-over');
        });
        viewport.addEventListener('dragleave', event => {
            if (!viewport.contains(event.relatedTarget)) viewport.classList.remove('drag-over');
        });
        viewport.addEventListener('drop', event => {
            if (!event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)) return;
            event.preventDefault();
            viewport.classList.remove('drag-over');
            const rect = canvas.getBoundingClientRect();
            this.controller.addWorkflowNode(tab.id, event.dataTransfer.getData(ELEMENT_DRAG_TYPE),
                (event.clientX - rect.left) / (tab.workflowScale ?? 1),
                (event.clientY - rect.top) / (tab.workflowScale ?? 1));
        });

        // Every render rebuilds the canvas, so keep the scroll position on the tab.
        viewport.addEventListener('scroll', () => {
            tab.scroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
        });
        requestAnimationFrame(() => {
            viewport.scrollLeft = tab.scroll?.left ?? 0;
            viewport.scrollTop = tab.scroll?.top ?? 0;
            drawEdges();
            const focusIsFree = !document.activeElement || document.activeElement === document.body;
            if (focusIsFree && (tab.selectedEdgeId || tab.selectedNodeIds?.length)) viewport.focus({ preventScroll: true });
        });

        container.appendChild(viewport);

        const status = document.createElement('div');
        status.className = 'status-bar workflow-status-bar';
        const summary = document.createElement('span');
        const selectedCount = tab.selectedNodeIds?.length ?? 0;
        summary.textContent = `nodes: ${tab.graph.nodes.length}  connections: ${tab.graph.edges.length}`
            + (selectedCount ? `  selected: ${selectedCount}` : '')
            + '  —  drag ports to connect; drag empty space to box-select; ⌘C/⌘X/⌘V/⌘D copy, cut, paste, duplicate;'
            + ' Delete removes; ⌘Z/⇧⌘Z undo/redo';
        status.appendChild(summary);
        const fit = document.createElement('button');
        fit.className = 'plan-btn';
        fit.textContent = 'Fit Workflow';
        fit.addEventListener('click', () => {
            const nodes = [...canvas.querySelectorAll('.workflow-node')];
            if (!nodes.length) return;
            const right = Math.max(...nodes.map(node => node.offsetLeft + node.offsetWidth)) + 24;
            const bottom = Math.max(...nodes.map(node => node.offsetTop + node.offsetHeight)) + 24;
            tab.workflowScale = fitScale(right, bottom, viewport.clientWidth, viewport.clientHeight);
            tab.scroll = { left: 0, top: 0 };
            this.render();
        });
        const actual = document.createElement('button');
        actual.className = 'plan-btn';
        actual.textContent = '100%';
        actual.title = 'Reset workflow scale';
        actual.addEventListener('click', () => { tab.workflowScale = 1; this.render(); });
        status.append(fit, actual);

        const save = document.createElement('button');
        save.className = 'plan-btn';
        save.textContent = 'Save';
        save.title = tab.workflowPath ? 'Save workflow (Cmd/Ctrl+S)' : 'Save workflow to a new file (Cmd/Ctrl+S)';
        save.addEventListener('click', () => this.controller.saveWorkflow(tab.id));
        status.appendChild(save);

        const saveAs = document.createElement('button');
        saveAs.className = 'plan-btn';
        saveAs.textContent = 'Save As';
        saveAs.title = 'Save workflow to another file (Cmd/Ctrl+Shift+S)';
        saveAs.addEventListener('click', () => this.controller.saveWorkflow(tab.id, true));
        status.appendChild(saveAs);

        if (tab.saveError) {
            const saveError = document.createElement('span');
            saveError.className = 'plan-problem';
            saveError.textContent = `save failed: ${tab.saveError}`;
            saveError.title = tab.saveError;
            status.appendChild(saveError);
        } else if (tab.lastSaved) {
            const saved = document.createElement('span');
            saved.className = 'plan-ok';
            saved.textContent = `saved ${tab.lastSaved}`;
            status.appendChild(saved);
        }

        const plan = document.createElement('button');
        plan.className = 'plan-btn';
        plan.textContent = 'Plan run';
        plan.title = 'Work out the execution order and where each step will write';
        plan.addEventListener('click', () => this.controller.planWorkflowRun(tab.id));
        status.appendChild(plan);

        const running = Boolean(tab.running);
        const runBtn = document.createElement('button');
        runBtn.className = 'plan-btn';
        runBtn.textContent = running ? 'Stop' : 'Run';
        runBtn.title = running ? 'Stop after the current frame' : 'Run the graph frame by frame';
        runBtn.addEventListener('click', () => running
            ? this.controller.stopWorkflowRun(tab.id)
            : this.controller.runWorkflow(tab.id));
        status.appendChild(runBtn);

        if (tab.runProgress) {
            const progress = document.createElement('span');
            progress.className = tab.runProgress.failed ? 'plan-problem' : 'plan-ok';
            progress.textContent = tab.runProgress.text;
            progress.title = tab.runProgress.detail ?? '';
            status.appendChild(progress);
        } else if (tab.runPlan) {
            const report = document.createElement('span');
            report.className = tab.runPlan.runnable ? 'plan-ok' : 'plan-problem';
            report.textContent = tab.runPlan.runnable
                ? `plan: ${tab.runPlan.steps.map(step => step.name).join(' → ')}  in  ${tab.runPlan.runDir}`
                : `cannot run: ${tab.runPlan.problems.join(' ')}`;
            report.title = tab.runPlan.runnable
                ? tab.runPlan.steps.flatMap(step => Object.values(step.outputs)).join('\n')
                : tab.runPlan.problems.join('\n');
            status.appendChild(report);
        }

        container.appendChild(status);
    }

    // Toggles the executing pulse and color highlight on the node currently processing a frame.
    highlightExecutingNode(tabId, nodeId) {
        const tab = this.model.getTab(tabId);
        if (tab) tab.activeNodeId = nodeId;

        const allNodes = this.editorArea.querySelectorAll('.workflow-node');
        for (const el of allNodes) {
            if (nodeId && el.dataset.nodeId === nodeId) {
                el.classList.add('executing');
            } else {
                el.classList.remove('executing');
            }
        }
    }

    buildWorkflowNode(tab, node) {
        const el = document.createElement('div');
        el.className = `workflow-node wf-${node.kind}`;
        el.dataset.nodeId = node.id;
        if (tab.selectedNodeIds?.includes(node.id)) el.classList.add('selected');
        if (tab.activeNodeId === node.id) {
            el.classList.add('executing');
        }
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;

        const header = document.createElement('div');
        header.className = 'workflow-node-header';

        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'workflow-node-settings';
        settingsBtn.title = `${node.name} parameters`;
        settingsBtn.appendChild(createIcon('gear', 'wf-kind-icon'));
        settingsBtn.addEventListener('pointerdown', event => event.stopPropagation());
        settingsBtn.addEventListener('click', () => this.controller.openNodeParams(tab.id, node.id));
        header.appendChild(settingsBtn);

        const title = document.createElement('span');
        title.textContent = node.name;
        header.appendChild(title);

        for (const artifact of tab.latestArtifacts?.[node.id] ?? []) {
            const isImage = artifact.type === 'image' || artifact.type === 'disparity';
            const isJson = ['text', 'keypoints', 'matches'].includes(artifact.type);
            if (!isImage && !isJson) continue;

            const artifactBtn = document.createElement('button');
            artifactBtn.className = 'workflow-node-artifact';
            artifactBtn.type = 'button';
            artifactBtn.title = `Open ${isImage ? 'image' : 'JSON'} artifact: ${artifact.port}`;
            artifactBtn.setAttribute('aria-label', artifactBtn.title);
            artifactBtn.appendChild(createIcon(isImage ? 'eye' : 'file'));
            artifactBtn.addEventListener('pointerdown', event => event.stopPropagation());
            artifactBtn.addEventListener('click', event => {
                event.stopPropagation();
                this.controller.openWorkflowArtifact(tab.id, node.id, artifact.port);
            });
            header.appendChild(artifactBtn);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'workflow-node-remove';
        removeBtn.textContent = '✕';
        removeBtn.title = `Remove ${node.name}`;
        removeBtn.addEventListener('pointerdown', event => event.stopPropagation());
        removeBtn.addEventListener('click', () => this.controller.removeWorkflowNode(tab.id, node.id));
        header.appendChild(removeBtn);
        el.appendChild(header);

        const body = document.createElement('div');
        body.className = 'workflow-node-body';
        const inputs = document.createElement('div');
        inputs.className = 'workflow-ports inputs';
        const outputs = document.createElement('div');
        outputs.className = 'workflow-ports outputs';
        for (const port of node.inputs) inputs.appendChild(this.buildPort(tab, node, port, 'input'));
        for (const port of node.outputs) outputs.appendChild(this.buildPort(tab, node, port, 'output'));
        body.append(inputs, outputs);
        el.appendChild(body);
        const parameterText = nodeParameterSummary(node);
        if (parameterText) {
            const summary = document.createElement('div');
            summary.className = 'workflow-node-summary';
            summary.textContent = parameterText;
            summary.title = parameterText;
            el.appendChild(summary);
        }

        if (node.telemetry.length > 0) {
            const telemetry = document.createElement('div');
            telemetry.className = 'workflow-ports telemetry';
            for (const port of node.telemetry) telemetry.appendChild(this.buildPort(tab, node, port, 'telemetry'));
            el.appendChild(telemetry);
        }

        // Press anywhere on the node (buttons and ports handle their own presses) to select it, and drag
        // to move it together with the rest of the selection. Shift/Cmd/Ctrl-click toggles membership.
        // Nothing re-renders mid-drag: only element positions change until the pointer is released.
        el.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const canvas = el.closest('.workflow-canvas');
            canvas?.closest('.workflow-viewport')?.focus({ preventScroll: true });
            const additive = event.shiftKey || event.metaKey || event.ctrlKey;
            const wasSelected = (tab.selectedNodeIds ?? []).includes(node.id);
            let selection;
            if (additive) {
                selection = wasSelected
                    ? tab.selectedNodeIds.filter(id => id !== node.id)
                    : [...(tab.selectedNodeIds ?? []), node.id];
            } else {
                selection = wasSelected ? [...tab.selectedNodeIds] : [node.id];
            }
            for (const nodeEl of canvas?.querySelectorAll('.workflow-node') ?? []) {
                nodeEl.classList.toggle('selected', selection.includes(nodeEl.dataset.nodeId));
            }
            // A toggle-off press never drags.
            const dragging = selection.includes(node.id);
            const movers = dragging
                ? tab.graph.nodes.filter(item => selection.includes(item.id)).map(item => ({
                    item, el: canvas?.querySelector(`.workflow-node[data-node-id="${CSS.escape(item.id)}"]`)
                })).filter(mover => mover.el)
                : [];
            const scale = tab.workflowScale ?? 1;
            const startX = event.clientX;
            const startY = event.clientY;
            // Clamp the group as a whole so it keeps its shape against the canvas edge.
            const minX = Math.min(...movers.map(m => m.item.x));
            const minY = Math.min(...movers.map(m => m.item.y));
            let dx = 0;
            let dy = 0;
            let moved = false;

            const onMove = moveEvent => {
                if (!dragging) return;
                if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return;
                if (!moved) for (const mover of movers) mover.el.classList.add('dragging');
                moved = true;
                dx = Math.max(-minX, (moveEvent.clientX - startX) / scale);
                dy = Math.max(-minY, (moveEvent.clientY - startY) / scale);
                for (const mover of movers) {
                    mover.el.style.left = `${mover.item.x + dx}px`;
                    mover.el.style.top = `${mover.item.y + dy}px`;
                }
                canvas?.workflow?.drawEdges();
            };
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                if (moved) {
                    this.model.setWorkflowSelection(tab.id, selection);
                    this.controller.moveWorkflowNodes(tab.id, Object.fromEntries(movers.map(mover =>
                        [mover.item.id, { x: mover.item.x + dx, y: mover.item.y + dy }])));
                } else {
                    // A plain click on an already-selected node narrows the selection to that node.
                    this.controller.setWorkflowSelection(tab.id,
                        !additive && wasSelected ? [node.id] : selection);
                }
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        });

        return el;
    }

    // A port is also a connection handle: drag from it to a compatible port on another node.
    buildPort(tab, node, port, direction) {
        const row = document.createElement('div');
        row.className = `workflow-port ${direction} port-${port.type}`;
        row.title = `${port.name}: ${port.type}${port.optional ? ' (optional; uses configured file/preset when disconnected)' : ''}`;
        row.dataset.nodeId = node.id;
        row.dataset.port = port.name;
        row.dataset.direction = direction;

        const dot = document.createElement('span');
        dot.className = 'workflow-port-dot';
        const label = document.createElement('span');
        label.textContent = port.name + (port.optional ? ' (optional)' : '');
        row.append(dot, label);

        row.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();

            const canvas = row.closest('.workflow-canvas');
            const workflow = canvas?.workflow;
            const anchor = workflow?.portCenter(node.id, port.name, direction);
            if (!anchor) return;

            const startsAtInput = direction === 'input';
            const pairWith = other => {
                const otherDirection = other.dataset.direction;
                if (startsAtInput === (otherDirection === 'input')) return null;
                const own = { nodeId: node.id, port: port.name, direction };
                const theirs = { nodeId: other.dataset.nodeId, port: other.dataset.port, direction: otherDirection };
                return startsAtInput ? { from: theirs, to: own } : { from: own, to: theirs };
            };

            const others = [...canvas.querySelectorAll('.workflow-port')].filter(el => el !== row);
            for (const other of others) {
                const pair = pairWith(other);
                const ok = pair && this.model.canConnectWorkflow(tab.id, pair.from, pair.to).ok;
                other.classList.add(ok ? 'connect-candidate' : 'connect-disabled');
            }
            row.classList.add('connect-origin');
            canvas.classList.add('connecting');

            const preview = document.createElementNS(SVG_NS, 'path');
            preview.setAttribute('class', `workflow-edge preview ${startsAtInput ? 'output' : direction}`);
            workflow.svg.appendChild(preview);

            let hovered = null;
            const onMove = moveEvent => {
                const c = canvas.getBoundingClientRect();
                const scale = tab.workflowScale ?? 1;
                const p = { x: (moveEvent.clientX - c.left) / scale, y: (moveEvent.clientY - c.top) / scale };
                preview.setAttribute('d', startsAtInput ? edgePath(p, anchor, 'output').d : edgePath(anchor, p, direction).d);

                const over = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('.workflow-port.connect-candidate');
                if (over !== hovered) {
                    hovered?.classList.remove('connect-hover');
                    over?.classList.add('connect-hover');
                    hovered = over;
                }
            };
            const finish = upEvent => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', finish);
                window.removeEventListener('pointercancel', finish);

                const target = upEvent.type === 'pointerup'
                    ? document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('.workflow-port.connect-candidate')
                    : null;

                preview.remove();
                canvas.classList.remove('connecting');
                row.classList.remove('connect-origin');
                for (const other of others) other.classList.remove('connect-candidate', 'connect-disabled', 'connect-hover');

                const pair = target && pairWith(target);
                if (pair) this.controller.connectWorkflowPorts(tab.id, pair.from, pair.to);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', finish);
            window.addEventListener('pointercancel', finish);
        });

        return row;
    }

    buildStatusBar(tab) {
        const statusBar = document.createElement('div');
        statusBar.className = 'status-bar';
        statusBar.textContent = `height: -  width: -  type: ${tab.pixelType}`;
        return statusBar;
    }

    buildZoomBar(tab) {
        const zoomBar = document.createElement('div');
        zoomBar.className = 'zoom-bar';

        const addButton = (text, title, zoom, className) => {
            const btn = document.createElement('button');
            btn.textContent = text;
            btn.title = title;
            if (className) btn.className = className;
            btn.addEventListener('click', () => this.controller.setZoom(tab.id, zoom));
            zoomBar.appendChild(btn);
        };

        addButton('−', 'Zoom out', tab.zoom - 25);
        addButton(`${tab.zoom}%`, 'Reset to 100%', 100, 'zoom-level');
        addButton('+', 'Zoom in', tab.zoom + 25);
        const fit = document.createElement('button');
        fit.textContent = 'Fit Image';
        fit.title = 'Fit image within the editor pane';
        fit.addEventListener('click', () => { tab.fitImage = true; this.render(); });
        zoomBar.appendChild(fit);

        return zoomBar;
    }

    buildToolbar(tab) {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';

        this.toolbarActions.forEach(action => {
            const btn = document.createElement('button');
            btn.textContent = action;
            btn.className = action === 'RESET' ? 'reset-btn' : action === tab.activeAction ? 'active' : '';
            btn.addEventListener('click', () => {
                if (action === 'RESET') this.controller.resetTab(tab.id);
                else if (action === 'STRETCH') this.showStretchDialog(tab);
                else if (action === 'SURFACE') this.controller.openSurface(tab.id);
                else if (action === 'UNDISTORT') this.controller.openUndistortDialog(tab.id);
                else if (action === 'DISPARITY') this.controller.openDisparityDialog(tab.id);
                else if (action === 'FOURIER') this.controller.runFourier(tab.id);
                // Everything else is driven by the parameter declarations from the main process.
                else this.controller.runDeclaredAction(tab.id, action);
            });
            toolbar.appendChild(btn);
        });

        return toolbar;
    }

    showDisparityDialog(activeTab) {
        const backdrop = this.disparityModal;
        if (!activeTab || this.model.getAllTabs().filter(tab => tab.type !== 'workflow').length < 2 || !this.specs.cameras.specs?.some(item => item.spec)) {
            return;
        }
        backdrop.innerHTML = '';
        backdrop.hidden = false;

        const tabs = this.model.getAllTabs().filter(tab => tab.type !== 'workflow');
        const cameras = this.specs.cameras.specs?.filter(item => item.spec) ?? [];
        const defaultRight = tabs.find(tab => tab.id !== activeTab.id);

        const modal = document.createElement('form');
        modal.className = 'modal stereo-modal';
        modal.addEventListener('submit', event => {
            event.preventDefault();
            const leftTab = tabs.find(tab => tab.id === leftSelect.value);
            const rightTab = tabs.find(tab => tab.id === rightSelect.value);
            const leftCamera = cameras.find(item => item.file === leftCameraSelect.value);
            const rightCamera = cameras.find(item => item.file === rightCameraSelect.value);
            if (!leftTab || !rightTab || leftTab.id === rightTab.id || !leftCamera || !rightCamera) return;

            const leftT = leftMatrix.values();
            const rightT = rightMatrix.values();
            const leftK = leftIntrinsic.values();
            const rightK = rightIntrinsic.values();
            if ([...leftT, ...rightT, ...leftK, ...rightK].some(value => !Number.isFinite(value))) return;

            backdrop.hidden = true;
            this.controller.runDisparity({
                leftTabId: leftTab.id,
                rightTabId: rightTab.id,
                leftCameraFile: leftCamera.file,
                rightCameraFile: rightCamera.file,
                leftCamera: leftCamera.spec,
                rightCamera: rightCamera.spec,
                leftK,
                rightK,
                leftT,
                rightT
            });
        });

        const title = document.createElement('h2');
        title.textContent = 'Stereo disparity';
        modal.appendChild(title);
        modal.appendChild(this.selectRow('Left image', tabs, activeTab.id, tab => tab.label, tab => tab.id, value => value));
        const leftSelect = modal.lastChild.querySelector('select');
        modal.appendChild(this.selectRow('Right image', tabs, defaultRight?.id ?? '', tab => tab.label, tab => tab.id));
        const rightSelect = modal.lastChild.querySelector('select');
        modal.appendChild(this.selectRow('Left camera', cameras, cameras[0]?.file ?? '', item => item.spec.name ?? item.file, item => item.file));
        const leftCameraSelect = modal.lastChild.querySelector('select');
        modal.appendChild(this.selectRow('Right camera', cameras, cameras[1]?.file ?? cameras[0]?.file ?? '', item => item.spec.name ?? item.file, item => item.file));
        const rightCameraSelect = modal.lastChild.querySelector('select');

        const leftCamera = cameras.find(item => item.file === leftCameraSelect.value)?.spec;
        const rightCamera = cameras.find(item => item.file === rightCameraSelect.value)?.spec;
        const flattenMatrix = value => Array.isArray(value?.[0]) ? value.flat() : (value ?? []);
        const matrixValues = (camera, name) => flattenMatrix(camera?.intrinsics?.[name] ?? camera?.extrinsics?.[name]);
        const identity4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const identity3 = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
        const leftIntrinsic = this.matrixEditor('Left K', matrixValues(leftCamera, 'K').length === 9 ? matrixValues(leftCamera, 'K') : identity3, 3, 'k');
        const rightIntrinsic = this.matrixEditor('Right K', matrixValues(rightCamera, 'K').length === 9 ? matrixValues(rightCamera, 'K') : identity3, 3, 'k');
        const leftMatrix = this.matrixEditor('Left T', matrixValues(leftCamera, 'T').length === 16 ? matrixValues(leftCamera, 'T') : identity4, 4, 't');
        const rightMatrix = this.matrixEditor('Right T', matrixValues(rightCamera, 'T').length === 16 ? matrixValues(rightCamera, 'T') : identity4, 4, 't');
        modal.append(leftIntrinsic.element, rightIntrinsic.element, leftMatrix.element, rightMatrix.element);

        const updateCameraMatrices = (select, intrinsicEditor, extrinsicEditor) => {
            const camera = cameras.find(item => item.file === select.value)?.spec;
            const k = matrixValues(camera, 'K');
            const t = matrixValues(camera, 'T');
            intrinsicEditor.setValues(k.length === 9 ? k : identity3);
            extrinsicEditor.setValues(t.length === 16 ? t : identity4);
        };
        leftCameraSelect.addEventListener('change', () => updateCameraMatrices(leftCameraSelect, leftIntrinsic, leftMatrix));
        rightCameraSelect.addEventListener('change', () => updateCameraMatrices(rightCameraSelect, rightIntrinsic, rightMatrix));

        const help = document.createElement('p');
        help.className = 'modal-help';
        help.textContent = 'K is the editable 3x3 intrinsic matrix and T is the editable row-major 4x4 extrinsic transform. Images must be different; rectification and disparity execution will be added next.';
        modal.appendChild(help);

        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => { backdrop.hidden = true; });
        const apply = document.createElement('button');
        apply.type = 'submit'; apply.className = 'primary'; apply.textContent = 'Prepare disparity';
        actions.append(cancel, apply); modal.appendChild(actions);
        backdrop.appendChild(modal);
    }

    selectRow(labelText, items, selected, label, value) {
        const row = document.createElement('label'); row.className = 'form-row'; row.textContent = labelText;
        const select = document.createElement('select');
        items.forEach(item => { const option = document.createElement('option'); option.value = value(item); option.textContent = label(item); option.selected = option.value === selected; select.appendChild(option); });
        row.appendChild(select); return row;
    }

    matrixEditor(labelText, initialValues, size, symbol) {
        const section = document.createElement('fieldset');
        section.className = 'matrix-editor';
        const legend = document.createElement('legend');
        legend.textContent = `${labelText} (row-major ${size} x ${size})`;
        section.appendChild(legend);

        const grid = document.createElement('div');
        grid.className = 'matrix-grid';
        grid.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;
        const inputs = [];
        for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
            for (let columnIndex = 0; columnIndex < size; columnIndex += 1) {
                const cell = document.createElement('label');
                cell.className = 'matrix-cell';
                const cellLabel = document.createElement('span');
                cellLabel.className = 'matrix-label';
                cellLabel.textContent = `${symbol}${rowIndex + 1}${columnIndex + 1}`;
                cell.appendChild(cellLabel);
                const input = document.createElement('input');
                input.type = 'number';
                input.step = 'any';
                input.required = true;
                input.value = initialValues[rowIndex * 4 + columnIndex] ?? 0;
                input.title = `${symbol}${rowIndex + 1}${columnIndex + 1}`;
                inputs.push(input);
                cell.appendChild(input);
                grid.appendChild(cell);
            }
        }
        section.appendChild(grid);
        return {
            element: section,
            values: () => inputs.map(input => Number(input.value)),
            setValues: values => inputs.forEach((input, index) => { input.value = values[index] ?? 0; })
        };
    }

    // Builds a dialog from parameter declarations. Used for both toolbar actions (declarations from
    // the main process) and workflow nodes (declarations from the element file), so the form code
    // exists once. `specs` is an array of { name, label, type, default, min, max, step, values, hint }.
    showSchemaDialog({ title: titleText, specs, values: initial = {}, applyLabel = 'Apply', onApply, wide = false }) {
        const backdrop = this.thresholdModal;
        backdrop.innerHTML = '';
        backdrop.hidden = false;

        const modal = document.createElement('form');
        modal.className = 'modal' + (wide ? ' modal-wide' : '');
        const title = document.createElement('h2');
        title.textContent = titleText;
        modal.appendChild(title);

        const inputs = {};
        for (const spec of specs) {
            const value = initial[spec.name] ?? spec.default;
            const row = document.createElement('label');
            row.className = 'form-row';
            row.textContent = spec.label ?? spec.name;

            let input;
            if (spec.type === 'boolean') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = Boolean(value);
            } else if (spec.type === 'folder' || spec.type === 'file') {
                input = document.createElement('input');
                input.type = 'text';
                input.placeholder = spec.placeholder ?? (spec.type === 'file' ? 'Enter path or preset (identity, flip_h, ...), or Browse…' : 'Enter folder path, or Browse…');
                input.value = value ?? '';
                input.title = value ?? '';
                input.addEventListener('input', () => { input.title = input.value; });
                const browse = document.createElement('button');
                browse.type = 'button';
                browse.className = 'browse-btn';
                browse.textContent = 'Browse…';
                browse.addEventListener('click', async () => {
                    const chosen = spec.type === 'file'
                        ? await window.explorer.chooseFile()
                        : await window.explorer.chooseFolder({ create: Boolean(spec.create) });
                    if (!chosen) return;
                    input.value = chosen.file ?? chosen.folder;
                    input.title = input.value;
                });
                const clear = document.createElement('button');
                clear.type = 'button';
                clear.className = 'browse-btn';
                clear.textContent = '✕';
                clear.title = 'Clear path';
                clear.addEventListener('click', () => {
                    input.value = spec.default ?? '';
                    input.title = input.value;
                });
                row.append(input, browse, clear);
                modal.appendChild(row);
                if (spec.hint) {
                    const hint = document.createElement('p');
                    hint.className = 'modal-help';
                    hint.textContent = spec.hint;
                    modal.appendChild(hint);
                }
                inputs[spec.name] = { input, spec };
                continue;
            } else if (spec.type === 'code') {
                input = document.createElement('textarea');
                input.className = 'workflow-code-editor';
                input.rows = 20;
                input.required = true;
                input.spellcheck = false;
                input.value = value ?? '';
                input.setAttribute('aria-label', spec.label ?? spec.name);
            } else if (spec.type === 'text') {
                input = document.createElement('input');
                input.type = 'text';
                input.value = value ?? '';
            } else if (spec.type === 'enum') {
                input = document.createElement('select');
                for (const option of spec.values) {
                    const optionValue = option?.value ?? option;
                    const item = document.createElement('option');
                    item.value = optionValue ?? '';
                    item.textContent = option?.label ?? option;
                    item.selected = optionValue === value;
                    input.appendChild(item);
                }
            } else {
                input = document.createElement('input');
                input.type = 'number';
                input.required = true;
                input.value = value;
                input.step = spec.step ?? 'any';
                if (spec.min !== undefined) input.min = spec.min;
                if (spec.max !== undefined) input.max = spec.max;
            }

            row.appendChild(input);
            modal.appendChild(row);
            if (spec.hint) {
                const hint = document.createElement('p');
                hint.className = 'modal-help';
                hint.textContent = spec.hint;
                modal.appendChild(hint);
            }
            inputs[spec.name] = { input, spec };
        }

        if (inputs.camera && inputs.fx && inputs.fy && inputs.cx && inputs.cy) {
            inputs.camera.input.addEventListener('change', () => {
                const select = inputs.camera.input;
                select.setCustomValidity('');
                if (!select.value) return;
                const camera = this.specs.cameras.specs?.find(item => item.file === select.value);
                const parameters = cameraParameters(camera?.spec);
                if (!parameters) {
                    select.setCustomValidity('This profile has no supported K/distortion values. Choose another profile or enter values manually.');
                    select.reportValidity();
                    return;
                }
                for (const [name, value] of Object.entries(parameters)) {
                    if (inputs[name]) inputs[name].input.value = value;
                }
            });
        }

        if (specs.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'modal-help';
            empty.textContent = 'This element has no parameters.';
            modal.appendChild(empty);
        }

        modal.addEventListener('submit', event => {
            event.preventDefault();
            const values = Object.fromEntries(Object.entries(inputs).map(([name, { input, spec }]) => {
                if (spec.type === 'boolean') return [name, input.checked];
                if (spec.type === 'folder' || spec.type === 'file' || spec.type === 'text' || spec.type === 'code') return [name, input.value === '' ? null : input.value];
                if (spec.type === 'enum') return [name, input.value === '' ? null : input.value];
                return [name, Number(input.value)];
            }));
            backdrop.hidden = true;
            onApply(values);
        });

        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = 'Defaults';
        reset.addEventListener('click', () => {
            for (const { input, spec } of Object.values(inputs)) {
                input.setCustomValidity('');
                if (spec.type === 'boolean') input.checked = Boolean(spec.default);
                else input.value = spec.default ?? '';
            }
        });
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => { backdrop.hidden = true; });
        const apply = document.createElement('button');
        apply.type = 'submit';
        apply.className = 'primary';
        apply.textContent = applyLabel;
        actions.append(reset, cancel, apply);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
    }

    // Toolbar action: declarations come from the main process, values are remembered per action.
    showActionDialog(action, specs, tab) {
        this.showSchemaDialog({
            title: `${action} parameters`,
            specs,
            values: this.dialogDefaults[action] ?? {},
            applyLabel: 'Run',
            wide: action === 'REMAP',
            onApply: values => {
                this.dialogDefaults[action] = values;
                this.controller.runAction(tab.id, action, values);
            }
        });
    }

    // Workflow node: declarations come from the element file, values are stored on the node.
    showNodeParamsDialog(tab, node, element) {
        if (element?.id === 'synthetic_scene_source') return showSceneDialog(this, tab, node, element);
        const isWide = element?.id === 'process_text' || node.elementId === 'process_text' ||
                       element?.id === 'remap' || node.elementId === 'remap' ||
                       element?.id === 'sync_camera_source' || node.elementId === 'sync_camera_source';
        this.showSchemaDialog({
            title: `${node.name} parameters`,
            specs: this.elementParamSpecs(element),
            values: node.params ?? {},
            applyLabel: 'Save',
            wide: isWide,
            onApply: values => this.controller.setWorkflowNodeParams(tab.id, node.id, values)
        });
    }

    // Modal alert when a workflow completes or is stopped.
    showWorkflowFinishedAlert(tab, summary) {
        const backdrop = this.thresholdModal;
        backdrop.innerHTML = '';
        backdrop.hidden = false;

        const modal = document.createElement('div');
        modal.className = 'modal workflow-alert';

        const title = document.createElement('h2');
        title.textContent = summary.stopped ? 'Workflow Stopped' : 'Workflow Finished';
        modal.appendChild(title);

        const msg = document.createElement('p');
        msg.className = 'workflow-alert-msg';
        const lateNote = summary.late ? ` (${summary.late} late)` : '';
        msg.textContent = summary.stopped
            ? `"${tab.label}" was stopped after ${summary.frames} frame(s).`
            : `"${tab.label}" completed ${summary.frames} frame(s)${lateNote}.`;
        modal.appendChild(msg);

        const pathInfo = document.createElement('div');
        pathInfo.className = 'workflow-alert-path';
        const pathLabel = document.createElement('span');
        pathLabel.textContent = 'Results directory:';
        const pathVal = document.createElement('code');
        pathVal.textContent = summary.runDir;
        pathInfo.append(pathLabel, pathVal);
        modal.appendChild(pathInfo);

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        const viewResultsBtn = document.createElement('button');
        viewResultsBtn.type = 'button';
        viewResultsBtn.textContent = 'View Results';
        viewResultsBtn.addEventListener('click', () => {
            backdrop.hidden = true;
            if (this.sideBarModel.activeView !== 'results') {
                this.controller.toggleSideBarView('results');
            } else {
                this.controller.reloadResults();
            }
        });

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'primary';
        okBtn.textContent = 'OK';
        const close = () => {
            backdrop.hidden = true;
            window.removeEventListener('keydown', onKeyDown);
        };
        okBtn.addEventListener('click', close);

        actions.append(viewResultsBtn, okBtn);
        modal.appendChild(actions);
        backdrop.appendChild(modal);

        const onKeyDown = event => {
            if (event.key === 'Escape' || event.key === 'Enter') {
                event.preventDefault();
                close();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        okBtn.focus();
    }

    // Element files describe parameters as an object; the dialog wants an array of specs.
    elementParamSpecs(element) {
        return Object.entries(element?.params ?? {}).map(([name, spec]) => {
            const common = { name, label: spec.label ?? name, hint: spec.description, default: spec.default };
            if (spec.type === 'code') return { ...common, type: 'code', default: spec.default ?? '' };
            if (spec.type === 'boolean') return { ...common, type: 'boolean' };
            if (spec.type === 'folder') {
                return { ...common, type: 'folder', create: spec.create ?? false, default: spec.default ?? '' };
            }
            if (spec.type === 'path' || spec.type === 'file') return { ...common, type: 'file', default: spec.default ?? '' };
            if (spec.type === 'string' || spec.type === 'text') return { ...common, type: 'text', default: spec.default ?? '' };
            if (spec.type === 'enum') return { ...common, type: 'enum', values: spec.values ?? spec.options ?? [] };
            if (spec.type === 'camera') {
                const cameras = this.specs.cameras.specs?.filter(item => item.spec) ?? [];
                return {
                    ...common,
                    type: 'enum',
                    values: [{ value: '', label: '(none)' }, ...cameras.map(item => ({ value: item.file, label: item.spec.name ?? item.file }))],
                    default: spec.default ?? ''
                };
            }
            return { ...common, type: 'number', min: spec.min, max: spec.max, step: spec.step };
        });
    }

    // Shared parameter dialog. `fields` are numeric inputs; the browser enforces min/max/step before submit.
    // Returns the inputs by name so a caller can fill them in later (e.g. from a camera spec).
    showParamDialog(titleText, fields, onApply, { addBeforeFields } = {}) {
        const backdrop = this.thresholdModal;
        backdrop.innerHTML = '';
        backdrop.hidden = false;

        const modal = document.createElement('form');
        modal.className = 'modal';
        const title = document.createElement('h2');
        title.textContent = titleText;
        modal.appendChild(title);
        addBeforeFields?.(modal);

        const inputs = {};
        for (const field of fields) {
            const row = document.createElement('label');
            row.className = 'form-row';
            row.textContent = field.label;
            const input = document.createElement('input');
            input.type = 'number';
            input.required = true;
            input.step = field.step ?? 'any';
            if (field.min !== undefined) input.min = field.min;
            if (field.max !== undefined) input.max = field.max;
            input.value = field.value;
            row.appendChild(input);
            modal.appendChild(row);
            inputs[field.name] = input;
        }

        modal.addEventListener('submit', event => {
            event.preventDefault();
            const values = Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, Number(input.value)]));
            if (Object.values(values).some(value => !Number.isFinite(value))) return;
            backdrop.hidden = true;
            onApply(values);
        });

        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => { backdrop.hidden = true; });
        const apply = document.createElement('button');
        apply.type = 'submit';
        apply.className = 'primary';
        apply.textContent = 'Apply';
        actions.append(cancel, apply);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        return inputs;
    }

    showStretchDialog(tab) {
        const last = this.dialogDefaults.STRETCH ?? { mode: 'percentile', low: 0.5, high: 99.5, bits: 12 };
        const modes = [
            { value: 'percentile', label: 'Percentile (ignores outliers)' },
            { value: 'minmax', label: 'Min to max (uses every pixel)' },
            { value: 'bits', label: 'Sensor bit depth' }
        ];

        let modeSelect;
        let hint;
        const inputs = this.showParamDialog('Stretch contrast', [
            { name: 'low', label: 'Low percentile', value: last.low, min: 0, max: 100 },
            { name: 'high', label: 'High percentile', value: last.high, min: 0, max: 100 },
            { name: 'bits', label: 'Sensor bits', value: last.bits, min: 1, max: 16, step: 1 }
        ], values => {
            const chosen = { ...values, mode: modeSelect.value };
            this.dialogDefaults.STRETCH = chosen;
            this.controller.runAction(tab.id, 'STRETCH', chosen);
        }, {
            addBeforeFields: modal => {
                const row = this.selectRow('Mode', modes, last.mode, item => item.label, item => item.value);
                modeSelect = row.querySelector('select');
                modal.appendChild(row);
                hint = document.createElement('p');
                hint.className = 'modal-help';
                modal.appendChild(hint);
            }
        });

        const hints = {
            percentile: 'Clips the darkest and brightest few pixels, then stretches what is left over the full range. Best default: hot pixels do not flatten the rest.',
            minmax: 'Stretches the darkest pixel to black and the brightest to white. A single hot pixel will limit the result.',
            bits: 'Scales a fixed range to full white: use 12 for a 12-bit sensor stored in 16 bits. Keeps relative brightness between frames comparable.'
        };
        // Disabled inputs are skipped by form validation, so the unused fields cannot block submit.
        const syncMode = () => {
            const mode = modeSelect.value;
            const show = { low: mode === 'percentile', high: mode === 'percentile', bits: mode === 'bits' };
            for (const [name, input] of Object.entries(inputs)) {
                input.disabled = !show[name];
                input.parentElement.hidden = !show[name];
            }
            hint.textContent = hints[mode];
        };
        syncMode();
        modeSelect.addEventListener('change', syncMode);
    }

    showUndistortDialog(tab) {
        const cameras = this.specs.cameras.specs?.filter(item => item.spec) ?? [];

        // K and distortion (k1, k2, p1, p2, k3) from a camera spec, or null when it has no intrinsics.
        const fromCamera = cameraParameters;
        const withK = cameras.find(item => fromCamera(item.spec));
        const initial = this.dialogDefaults.UNDISTORT
            ?? fromCamera(withK?.spec)
            ?? { fx: 1000, fy: 1000, cx: 0, cy: 0, k1: 0, k2: 0, p1: 0, p2: 0, k3: 0 };

        let cameraSelect;
        let cameraHint;
        const inputs = this.showParamDialog('Undistort', [
            { name: 'fx', label: 'fx (pixels)', value: initial.fx, min: 0.000001 },
            { name: 'fy', label: 'fy (pixels)', value: initial.fy, min: 0.000001 },
            { name: 'cx', label: 'cx (pixels)', value: initial.cx },
            { name: 'cy', label: 'cy (pixels)', value: initial.cy },
            { name: 'k1', label: 'k1 (radial)', value: initial.k1 },
            { name: 'k2', label: 'k2 (radial)', value: initial.k2 },
            { name: 'p1', label: 'p1 (tangential)', value: initial.p1 },
            { name: 'p2', label: 'p2 (tangential)', value: initial.p2 },
            { name: 'k3', label: 'k3 (radial)', value: initial.k3 }
        ], values => {
            this.dialogDefaults.UNDISTORT = values;
            this.controller.runAction(tab.id, 'UNDISTORT', values);
        }, {
            addBeforeFields: modal => {
                const options = [{ file: '', spec: { name: '(enter values)' } }, ...cameras];
                const row = this.selectRow('Fill from camera', options, this.dialogDefaults.UNDISTORT ? '' : (withK?.file ?? ''),
                    item => item.spec.name ?? item.file, item => item.file);
                cameraSelect = row.querySelector('select');
                modal.appendChild(row);
                cameraHint = document.createElement('p');
                cameraHint.className = 'modal-help';
                modal.appendChild(cameraHint);
            }
        });

        const describe = spec => {
            const res = spec?.intrinsics?.resolution;
            if (!spec) return 'Values are used as entered.';
            if (!fromCamera(spec)) return `${spec.name} has no intrinsics yet; enter values manually.`;
            const distortion = Array.isArray(spec.intrinsics.distortion) ? '' : ' No distortion coefficients in the spec, so k/p start at 0.';
            return `${spec.intrinsics.calibrated ? 'Calibrated' : 'Nominal (uncalibrated)'} values for ${res?.width}×${res?.height}; scale fx, fy, cx, cy if the image size differs.${distortion}`;
        };
        cameraHint.textContent = describe(cameras.find(item => item.file === cameraSelect.value)?.spec);
        cameraSelect.addEventListener('change', () => {
            const spec = cameras.find(item => item.file === cameraSelect.value)?.spec;
            const values = fromCamera(spec);
            if (values) for (const [name, value] of Object.entries(values)) inputs[name].value = value;
            cameraHint.textContent = describe(spec);
        });
    }
}
