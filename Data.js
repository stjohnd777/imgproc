// The data model: editor groups (side-by-side areas, each with its own tabs) and which is active.
// No DOM code lives here.

// Workflow port types and what each one extends. A port of type T can feed any input of T or of an
// ancestor of T, e.g. a disparity map can be saved like an image, but an image isn't a disparity map.
export const PORT_TYPES = {
    image: null,
    disparity: 'image',
    text: null,
    keypoints: 'text',
    matches: 'text',
    pointcloud: null
};

export function isAssignable(fromType, toType) {
    if (fromType === 'any' || toType === 'any') return true;
    for (let type = fromType; type; type = PORT_TYPES[type]) {
        if (type === toType) return true;
    }
    return false;
}

export class TabModel {

    static MIN_ZOOM = 25;
    static MAX_ZOOM = 400;

    constructor() {
        this.groups = [];
        this.activeGroupId = this.createGroup(0, 1).id;
    }

    // --- Groups -----------------------------------------------------------

    getGroups() {
        return this.groups;
    }

    getGroup(id) {
        return this.groups.find(group => group.id === id);
    }

    getActiveGroup() {
        return this.getGroup(this.activeGroupId);
    }

    isActiveGroup(id) {
        return id === this.activeGroupId;
    }

    // `size` is a relative width (flex weight); only the ratios between groups matter.
    createGroup(index, size) {
        const group = { id: crypto.randomUUID(), tabs: [], activeTabId: null, size };
        this.groups.splice(index, 0, group);
        return group;
    }

    // New groups take half of the neighbour's width, so other groups keep their size.
    createGroupBeside(neighbour, side) {
        neighbour.size /= 2;
        const index = this.groups.indexOf(neighbour) + (side === 'right' ? 1 : 0);
        return this.createGroup(index, neighbour.size);
    }

    // Like VS Code's "split right": opens a copy of the group's active tab in a new group to its right.
    splitGroup(groupId) {
        const source = this.getGroup(groupId);
        const tab = source && this.getTab(source.activeTabId);
        if (!tab) return null;

        const target = this.createGroupBeside(source, 'right');
        this.activeGroupId = target.id;
        this.addTab({
            label: tab.label, src: tab.src, path: tab.path, pixelType: tab.pixelType,
            type: tab.type, graph: tab.graph && structuredClone(tab.graph),
            workflowPath: tab.type === 'workflow' ? null : tab.workflowPath
        }, target.id);
        const copy = this.getTab(this.getGroup(target.id).activeTabId);
        if (copy?.type === 'workflow') copy.dirty = Boolean(copy.graph.nodes.length || copy.graph.edges.length);
        if (copy?.type === 'scene-composer') {
            copy.composer = tab.composer && structuredClone(tab.composer);
            // An independent copy must use Save As rather than overwrite the original scene.
            if (copy.composer) copy.composer.file = null;
            copy.dirty = Boolean(copy.composer);
        }
        return target.id;
    }

    // Moves a tab into a new group created on the left or right of `besideGroupId`.
    splitWithTab(tabId, besideGroupId, side) {
        const source = this.findGroupOfTab(tabId);
        const beside = this.getGroup(besideGroupId);
        if (!source || !beside) return null;
        // Splitting a group's only tab off itself would just leave an empty group behind.
        if (source === beside && source.tabs.length === 1) return null;

        const target = this.createGroupBeside(beside, side);
        this.moveTab(tabId, target.id);
        return target.id;
    }

    resizeGroups(leftId, rightId, leftSize, rightSize) {
        const left = this.getGroup(leftId);
        const right = this.getGroup(rightId);
        if (!left || !right || !(leftSize > 0) || !(rightSize > 0)) return;
        left.size = leftSize;
        right.size = rightSize;
    }

    // --- Tabs -------------------------------------------------------------

    getTab(id) {
        for (const group of this.groups) {
            const tab = group.tabs.find(t => t.id === id);
            if (tab) return tab;
        }
        return undefined;
    }

    findGroupOfTab(tabId) {
        return this.groups.find(group => group.tabs.some(t => t.id === tabId));
    }

    // Active tab of the active group.
    getActiveTab() {
        const group = this.getActiveGroup();
        return group && this.getTab(group.activeTabId);
    }

    // Whether the tab is the one shown in its own group.
    isActive(tabId) {
        return this.findGroupOfTab(tabId)?.activeTabId === tabId;
    }

    findTabByPath(groupId, path) {
        return this.getGroup(groupId)?.tabs.find(t => t.path === path);
    }

    // `src` is the URL the <img> displays; `path` is the file on disk the vision tools process.
    // pixelType is a placeholder until the real type is read from the file.
    // Workflow tabs have type 'workflow' and a `graph` instead of an image.
    // JSON spec tabs have type 'json' and store content, specKind and specFile.
    addTab({ label, src = null, path = src, pixelType = 'CV_8UC3', type = 'image', graph = null, content = '', cleanContent = null, specKind = null, specFile = null, workflowPath = null }, groupId = this.activeGroupId) {
        const group = this.getGroup(groupId);
        if (!group) return null;

        const id = crypto.randomUUID();
        group.tabs.push({
            id,
            type,
            label,
            src,
            path,
            pixelType,
            graph: type === 'workflow' ? (graph ?? { nodes: [], edges: [] }) : null,
            workflowPath: type === 'workflow' ? workflowPath : null,
            content,
            cleanContent: cleanContent ?? content,
            specKind,
            specFile,
            dirty: false,
            lastSaved: null,
            saveError: null,
            zoom: 100,
            activeAction: null,
            resultSrc: null,
            resultMeta: null,
            serviceError: null
        });
        group.activeTabId = id;
        this.activeGroupId = group.id;
        return id;
    }

    selectTab(tabId) {
        const group = this.findGroupOfTab(tabId);
        if (!group) return;
        group.activeTabId = tabId;
        this.activeGroupId = group.id;
    }

    closeTab(tabId) {
        const group = this.findGroupOfTab(tabId);
        if (!group) return;
        this.detachTab(group, tabId);
        this.removeGroupIfEmpty(group);
    }

    // Moves a tab to position `index` in another group (or reorders within the same group).
    moveTab(tabId, toGroupId, index = Infinity) {
        const source = this.findGroupOfTab(tabId);
        const target = this.getGroup(toGroupId);
        if (!source || !target) return;

        const fromIndex = source.tabs.findIndex(t => t.id === tabId);
        // Removing the tab first shifts later positions left by one within the same group.
        if (source === target && fromIndex < index) index -= 1;

        const tab = this.detachTab(source, tabId);
        target.tabs.splice(Math.min(Math.max(index, 0), target.tabs.length), 0, tab);
        target.activeTabId = tabId;
        this.activeGroupId = target.id;

        if (source !== target) this.removeGroupIfEmpty(source);
    }

    setZoom(tabId, zoom) {
        const tab = this.getTab(tabId);
        if (tab) tab.zoom = Math.min(TabModel.MAX_ZOOM, Math.max(TabModel.MIN_ZOOM, zoom));
    }

    resetTab(tabId) {
        const tab = this.getTab(tabId);
        if (!tab) return;

        tab.zoom = 100;
        tab.activeAction = null;
        tab.resultSrc = null;
        tab.resultMeta = null;
        tab.serviceError = null;
    }

    getAllTabs() {
        return this.groups.flatMap(group => group.tabs);
    }

    // --- Workflow graphs ------------------------------------------------------

    addWorkflowTab({ label = 'Workflow 1', graph = null, workflowPath = null } = {}) {
        const id = this.addTab({
            label: this.uniqueWorkflowName(label),
            type: 'workflow',
            graph: graph ?? { nodes: [], edges: [] },
            workflowPath
        });
        const tab = this.getTab(id);
        if (tab) tab.dirty = false;
        return id;
    }

    // Workflow names become folder names for run artifacts, so they must be distinct.
    uniqueWorkflowName(wanted, exceptTabId = null) {
        const taken = new Set(this.getAllTabs()
            .filter(tab => tab.type === 'workflow' && tab.id !== exceptTabId)
            .map(tab => tab.label));
        const base = wanted.trim().replace(/\s+\d+$/, '') || 'Workflow';
        if (!taken.has(wanted.trim()) && wanted.trim()) return wanted.trim();
        for (let n = 1; ; n += 1) {
            const candidate = `${base} ${n}`;
            if (!taken.has(candidate)) return candidate;
        }
    }

    renameTab(tabId, label) {
        const tab = this.getTab(tabId);
        if (!tab) return null;
        const wanted = String(label ?? '').trim();
        if (!wanted) return tab.label;
        tab.label = tab.type === 'workflow' ? this.uniqueWorkflowName(wanted, tabId) : wanted;
        return tab.label;
    }

    // Copies the element's ports into the node so the graph stays drawable if elements/ changes later.
    addWorkflowNode(tabId, element, x, y) {
        const graph = this.getTab(tabId)?.graph;
        if (!graph) return null;

        const params = Object.fromEntries(
            Object.entries(element.params ?? {}).map(([name, param]) => [name, param?.default ?? null]));
        const node = {
            id: crypto.randomUUID(),
            elementId: element.id,
            name: element.name,
            kind: element.kind,
            icon: element.icon,
            inputs: element.inputs ?? [],
            outputs: element.outputs ?? [],
            telemetry: element.telemetry ?? [],
            params,
            x: Math.max(0, Math.round(x)),
            y: Math.max(0, Math.round(y))
        };
        graph.nodes.push(node);
        return node.id;
    }

    moveWorkflowNode(tabId, nodeId, x, y) {
        const node = this.getTab(tabId)?.graph?.nodes.find(n => n.id === nodeId);
        if (!node) return;
        node.x = Math.max(0, Math.round(x));
        node.y = Math.max(0, Math.round(y));
    }

    setWorkflowNodeParams(tabId, nodeId, params) {
        const node = this.getTab(tabId)?.graph?.nodes.find(n => n.id === nodeId);
        if (!node) return;
        node.params = { ...node.params, ...params };
    }

    removeWorkflowNode(tabId, nodeId) {
        const graph = this.getTab(tabId)?.graph;
        if (!graph) return;
        graph.nodes = graph.nodes.filter(n => n.id !== nodeId);
        graph.edges = graph.edges.filter(e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId);
    }

    // `from` is { nodeId, port, direction: 'output' | 'telemetry' }; `to` is { nodeId, port }.
    canConnectWorkflow(tabId, from, to) {
        const graph = this.getTab(tabId)?.graph;
        if (!graph) return { ok: false, reason: 'No workflow' };

        const fromNode = graph.nodes.find(n => n.id === from.nodeId);
        const toNode = graph.nodes.find(n => n.id === to.nodeId);
        if (!fromNode || !toNode) return { ok: false, reason: 'Unknown node' };
        if (fromNode === toNode) return { ok: false, reason: 'A node cannot connect to itself' };

        const fromPorts = from.direction === 'telemetry' ? fromNode.telemetry : fromNode.outputs;
        const fromPort = fromPorts.find(p => p.name === from.port);
        const toPort = toNode.inputs.find(p => p.name === to.port);
        if (!fromPort || !toPort) return { ok: false, reason: 'Unknown port' };
        if (!isAssignable(fromPort.type, toPort.type)) {
            return { ok: false, reason: `Type mismatch: ${fromPort.type} → ${toPort.type}` };
        }
        const duplicate = graph.edges.some(e =>
            e.from.nodeId === from.nodeId && e.from.port === from.port && e.to.nodeId === to.nodeId && e.to.port === to.port);
        if (duplicate) return { ok: false, reason: 'Already connected' };

        // Adding from -> to creates a cycle if `from` is already reachable from `to`.
        const reachable = new Set();
        const stack = [toNode.id];
        while (stack.length > 0) {
            const id = stack.pop();
            if (id === fromNode.id) return { ok: false, reason: 'Connection would create a loop' };
            if (reachable.has(id)) continue;
            reachable.add(id);
            for (const edge of graph.edges) if (edge.from.nodeId === id) stack.push(edge.to.nodeId);
        }
        return { ok: true };
    }

    // Sink inputs collect from any number of producers; other inputs take one, so a new edge replaces the old.
    addWorkflowEdge(tabId, from, to) {
        const graph = this.getTab(tabId)?.graph;
        if (!graph || !this.canConnectWorkflow(tabId, from, to).ok) return null;

        const toNode = graph.nodes.find(n => n.id === to.nodeId);
        if (toNode.kind !== 'sink') {
            graph.edges = graph.edges.filter(e => !(e.to.nodeId === to.nodeId && e.to.port === to.port));
        }
        const edge = {
            id: crypto.randomUUID(),
            from: { nodeId: from.nodeId, port: from.port, direction: from.direction ?? 'output' },
            to: { nodeId: to.nodeId, port: to.port }
        };
        graph.edges.push(edge);
        return edge.id;
    }

    removeWorkflowEdge(tabId, edgeId) {
        const tab = this.getTab(tabId);
        if (!tab?.graph) return;
        tab.graph.edges = tab.graph.edges.filter(e => e.id !== edgeId);
        if (tab.selectedEdgeId === edgeId) tab.selectedEdgeId = null;
    }

    selectWorkflowEdge(tabId, edgeId) {
        const tab = this.getTab(tabId);
        if (tab?.graph) tab.selectedEdgeId = edgeId;
    }

    // --- Internal helpers ---------------------------------------------------

    detachTab(group, tabId) {
        const index = group.tabs.findIndex(t => t.id === tabId);
        const [tab] = group.tabs.splice(index, 1);

        if (group.activeTabId === tabId) {
            // Prefer the tab that slid into the closed slot, else the one before it.
            const next = group.tabs[index] ?? group.tabs[index - 1];
            group.activeTabId = next ? next.id : null;
        }
        return tab;
    }

    // An empty group disappears, unless it's the last one (so there's always somewhere to open tabs).
    removeGroupIfEmpty(group) {
        if (group.tabs.length > 0 || this.groups.length === 1) return;

        const index = this.groups.indexOf(group);
        this.groups.splice(index, 1);

        // Hand the freed width to a neighbour so the other groups don't jump around.
        const neighbour = this.groups[index - 1] ?? this.groups[index];
        neighbour.size += group.size;

        if (this.activeGroupId === group.id) {
            this.activeGroupId = (this.groups[index] ?? this.groups[index - 1]).id;
        }
    }
}

// Which view the side bar shows ('explorer', 'cameras'), or null when it's closed.
export class SideBarModel {

    constructor() {
        this.activeView = null;
    }

    // Clicking the open view's Activity Bar icon again closes the side bar, as in VS Code.
    toggle(view) {
        this.activeView = this.activeView === view ? null : view;
    }
}

// The folder the Explorer lists.
export class ExplorerModel {

    constructor() {
        this.folder = null;   // { folder, name, tree: [...] }
        this.collapsedFolders = new Set();
        this.selectedPath = null;
    }

    setFolder(folder) {
        this.folder = folder;
        this.collapsedFolders.clear();
    }

    isExpanded(path) {
        return !this.collapsedFolders.has(path);
    }

    toggleFolder(path) {
        if (this.collapsedFolders.has(path)) this.collapsedFolders.delete(path);
        else this.collapsedFolders.add(path);
    }
}

// A folder of JSON specs (camera_spec/, algo_spec/) and which nodes of its tree are expanded.
export class SpecModel {

    constructor(kind) {
        this.kind = kind;             // 'cameras' or 'algorithms'
        this.specs = null;            // null until loaded; then [{ file, spec }] or [{ file, error }]
        this.expanded = new Set();    // node paths, e.g. 'bfly_pge_13s2m_cs.json/sensor'
    }

    setSpecs(specs) {
        this.specs = specs;
    }

    isExpanded(path) {
        return this.expanded.has(path);
    }

    toggleNode(path) {
        if (this.expanded.has(path)) this.expanded.delete(path);
        else this.expanded.add(path);
    }
}
