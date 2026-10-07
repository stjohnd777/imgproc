// Handles user actions: updates the models, then asks the view to redraw. Vision actions go through
// a runner, which decides *how* they run (local CLI vs REST).
import { appendLog } from './tab_console.js';
export class Controller {

    constructor(model, view, runner, { sideBar, explorer, results, specs }) {
        this.model = model;
        this.view = view;
        this.runner = runner;
        this.sideBar = sideBar;
        this.explorer = explorer;
        this.results = results;
        this.specs = specs;   // { cameras: SpecModel, algorithms: SpecModel }
        this.removeConsoleListener = globalThis.window?.tabConsole?.onLog(entry => {
            const tab = this.model.getTab(entry.tabId);
            if (tab) {
                appendLog(tab, entry);
                this.scheduleConsoleRefresh(tab);
            }
        });
    }

    scheduleConsoleRefresh(tab) {
        if (tab.consoleRefresh) return;
        tab.consoleRefresh = setTimeout(() => {
            tab.consoleRefresh = null;
            this.view.refreshConsole?.(tab);
        }, 100);
    }

    log(tab, label, text, stream = 'system') {
        appendLog(tab, { label, text, stream });
        this.scheduleConsoleRefresh(tab);
    }

    setRunner(runner) {
        this.runner = runner;
    }

    async toggleSideBarView(viewName) {
        this.sideBar.toggle(viewName);
        if (this.sideBar.activeView === 'scenes') this.openSceneComposer(false);
        if (this.sideBar.activeView === 'elements' && !this.model.getAllTabs().some(tab => tab.type === 'workflow')) {
            this.model.addWorkflowTab();
        }
        this.view.render();

        const specModel = this.specs[this.sideBar.activeView];
        if (specModel && specModel.specs === null) {
            await this.reloadSpecs(this.sideBar.activeView);
        }
        // Results change on disk between visits, so they are read each time the view opens.
        if (this.sideBar.activeView === 'results') await this.reloadResults();
    }

    openSceneComposer(render = true) {
        let tab = this.model.getAllTabs().find(item => item.type === 'scene-composer');
        if (tab) this.model.selectTab(tab.id);
        else {
            const id = this.model.addTab({ label: 'Scene Composer', type: 'scene-composer', path: null });
            tab = this.model.getTab(id);
        }
        if (render) this.view.render();
        return tab;
    }

    async reloadResults() {
        try {
            const folder = await window.results.list();
            // Keep which folders are open, so a refresh doesn't collapse the tree.
            const collapsed = this.results.collapsedFolders;
            this.results.setFolder(folder);
            this.results.collapsedFolders = collapsed;
        } catch (err) {
            this.results.setFolder({ folder: '', name: `Results unavailable: ${err.message}`, tree: [] });
        }
        this.view.render();
    }

    toggleResultsFolder(path) {
        this.results.selectedPath = path;
        this.results.toggleFolder(path);
        this.view.render();
    }

    selectResultFolder(path) {
        this.results.selectedPath = path;
        this.view.render();
    }

    async deleteResult(path, kind) {
        const label = kind === 'workflow' ? 'workflow and all of its runs' : 'run';
        if (!window.confirm(`Delete this ${label} permanently? Its files cannot be recovered.`)) return;
        try {
            await window.results.delete(path);
            this.results.selectedPath = null;
            await this.reloadResults();
        } catch (err) {
            window.alert(`Could not delete result: ${err.message}`);
        }
    }

    async reloadSpecs(kind) {
        const specModel = this.specs[kind];
        try {
            specModel.setSpecs(await window.specs.list(kind));
        } catch (err) {
            specModel.setSpecs([{ file: kind, error: err.message }]);
        }
        this.view.render();
    }

    // Opens a JSON spec file (camera or algorithm) in an editor tab.
    async openSpec(kind, file) {
        try {
            const res = await window.specs.read(kind, file);
            const existing = this.model.findTabByPath(this.model.activeGroupId, res.path);
            if (existing) {
                this.model.selectTab(existing.id);
            } else {
                this.model.addTab({
                    label: file,
                    path: res.path,
                    type: 'json',
                    specKind: kind,
                    specFile: file,
                    content: res.content,
                    cleanContent: res.content
                });
            }
            this.view.render();
        } catch (err) {
            console.error('Failed to open spec:', err);
        }
    }

    // Saves changes to a JSON spec file back to disk and refreshes the spec model.
    async saveSpecTab(tabId, content) {
        const tab = this.model.getTab(tabId);
        if (!tab || tab.type !== 'json') return { success: false, error: 'Not a spec tab' };
        try {
            tab.content = content;
            await window.specs.save(tab.specKind, tab.specFile, tab.content);
            tab.cleanContent = tab.content;
            tab.dirty = false;
            tab.saveError = null;
            tab.lastSaved = new Date().toLocaleTimeString();
            await this.reloadSpecs(tab.specKind);
            this.view.render();
            return { success: true };
        } catch (err) {
            tab.saveError = err.message;
            this.view.render();
            return { success: false, error: err.message };
        }
    }

    async openDisparityDialog(tabId) {
        if (this.specs.cameras.specs === null) await this.reloadSpecs('cameras');
        this.view.showDisparityDialog(this.model.getTab(tabId));
    }

    // Shows the parameter dialog for an action, or runs it directly when it takes none.
    async runDeclaredAction(tabId, action) {
        this.actionParams ??= await window.vision.actions();
        const specs = this.actionParams[action] ?? [];
        if (specs.length === 0) {
            this.runAction(tabId, action);
            return;
        }
        this.view.showActionDialog(action, specs, this.model.getTab(tabId));
    }

    async openUndistortDialog(tabId) {
        if (this.specs.cameras.specs === null) await this.reloadSpecs('cameras');
        this.view.showUndistortDialog(this.model.getTab(tabId));
    }

    // Opens the image's intensity as a 3D surface in its own window.
    async openSurface(tabId) {
        const tab = this.model.getTab(tabId);
        if (!tab) return;
        try {
            if (!tab.path) throw new Error(`${tab.label} has no file on disk to plot`);
            tab.serviceError = null;
            await window.vision.surface(tab.path);
        } catch (err) {
            tab.serviceError = err.message;
        }
        this.view.render();
    }

    toggleSpecNode(kind, path) {
        this.specs[kind].toggleNode(path);
        this.view.render();
    }

    newWorkflow() {
        this.model.addWorkflowTab();
        this.view.render();
    }

    workflowDocument(tab) {
        return {
            name: tab.label,
            graph: {
                nodes: tab.graph.nodes.map(({ id, elementId, name, params, x, y }) => ({ id, elementId, name, params, x, y })),
                edges: tab.graph.edges.map(edge => ({
                    id: edge.id,
                    from: { nodeId: edge.from.nodeId, port: edge.from.port, direction: edge.from.direction ?? 'output' },
                    to: { nodeId: edge.to.nodeId, port: edge.to.port }
                }))
            }
        };
    }

    async openWorkflow() {
        try {
            const opened = await window.workflow.open();
            if (!opened) return;

            const existing = this.model.getAllTabs().find(tab => tab.type === 'workflow' && tab.workflowPath === opened.filePath);
            if (existing) {
                this.model.selectTab(existing.id);
            } else {
                this.model.addWorkflowTab({ label: opened.name, graph: opened.graph, workflowPath: opened.filePath });
            }
            this.view.render();
            if (opened.warnings?.length) {
                window.alert(`Workflow opened, but some saved paths are not authorized in this session. Re-select them in node settings before running:\n\n${opened.warnings.join('\n')}`);
            }
        } catch (err) {
            window.alert(`Could not open workflow: ${err.message}`);
        }
    }

    async saveWorkflow(tabId, saveAs = false) {
        const tab = this.model.getTab(tabId);
        if (!tab?.graph || tab.type !== 'workflow') return;

        try {
            const document = this.workflowDocument(tab);
            const saved = !saveAs && tab.workflowPath
                ? await window.workflow.save(tab.workflowPath, document)
                : await window.workflow.saveAs(document);
            if (!saved) return;

            tab.workflowPath = saved.filePath;
            tab.dirty = false;
            tab.saveError = null;
            tab.lastSaved = new Date().toLocaleTimeString();
        } catch (err) {
            tab.saveError = err.message;
        }
        this.view.render();
    }

    markWorkflowDirty(tabId) {
        const tab = this.model.getTab(tabId);
        if (!tab || tab.type !== 'workflow') return;
        tab.dirty = true;
        tab.saveError = null;
    }

    renameTab(tabId, label) {
        const tab = this.model.getTab(tabId);
        const previous = tab?.label;
        this.model.renameTab(tabId, label);
        if (tab?.type === 'workflow' && tab.label !== previous) this.markWorkflowDirty(tabId);
        this.view.render();
    }

    addWorkflowNode(tabId, elementFile, x, y) {
        const element = this.specs.elements.specs?.find(item => item.file === elementFile)?.spec;
        if (!element) return;
        this.model.selectTab(tabId);
        if (this.model.addWorkflowNode(tabId, element, x, y)) this.markWorkflowDirty(tabId);
        this.view.render();
    }

    moveWorkflowNode(tabId, nodeId, x, y) {
        this.model.moveWorkflowNode(tabId, nodeId, x, y);
        this.markWorkflowDirty(tabId);
        this.view.render();
    }

    // Opens the node's parameters, described by its element file.
    async openNodeParams(tabId, nodeId) {
        const tab = this.model.getTab(tabId);
        const node = tab?.graph?.nodes.find(n => n.id === nodeId);
        if (!node) return;
        const element = this.specs.elements.specs?.find(item => item.spec?.id === node.elementId)?.spec;
        if (this.specs.cameras.specs === null && element?.params?.camera) await this.reloadSpecs('cameras');
        this.view.showNodeParamsDialog(tab, node, element ?? { params: {} });
    }

    setWorkflowNodeParams(tabId, nodeId, params) {
        this.model.setWorkflowNodeParams(tabId, nodeId, params);
        this.markWorkflowDirty(tabId);
        this.view.render();
    }

    // Works out execution order and output paths without running anything.
    async planWorkflowRun(tabId) {
        const tab = this.model.getTab(tabId);
        if (!tab?.graph) return;
        try {
            tab.runPlan = await window.workflow.prepareRun({ name: tab.label, graph: tab.graph });
        } catch (err) {
            tab.runPlan = { runnable: false, problems: [err.message], steps: [] };
        }
        tab.runProgress = null;
        this.view.render();
    }

    // Runs the graph frame by frame, reporting progress as it goes.
    async runWorkflow(tabId) {
        const tab = this.model.getTab(tabId);
        if (!tab?.graph || tab.running) return;

        tab.running = true;
        this.log(tab, 'Workflow', `Starting ${tab.label}`);
        tab.activeNodeId = null;
        tab.runProgress = { text: 'starting…' };
        this.view.render();

        let viewQueue = Promise.resolve();
        let lastDisplayedFrame = 0;
        const displayFrame = info => {
            if (info.frame <= lastDisplayedFrame) return;
            lastDisplayedFrame = info.frame;
            tab.activeNodeId = null;
            tab.latestArtifacts = Object.fromEntries(info.steps
                .filter(step => step.nodeId)
                .map(step => [step.nodeId, step.artifacts ?? []]));
            const images = info.steps.filter(step => step.uiView)
                .flatMap(step => (step.artifacts ?? []).map(artifact => ({
                    artifact, previewKey: step.reuseTab ? `${tabId}:${step.nodeId}` : null
                })));
            viewQueue = viewQueue.then(async () => {
                for (const { artifact, previewKey } of images) await this.openWorkflowArtifactInTab(tabId, artifact, previewKey);
            });
            this.view.highlightExecutingNode(tab.id, null);
            tab.runProgress = {
                text: `frame ${info.frame}/${info.frames}  ${info.ms}ms${info.late ? '  (late)' : ''}`,
                detail: info.steps.map(step => `${step.order} ${step.name} ${step.ms}ms`).join('\n')
            };
            this.view.render();
        };
        const listeners = [
            window.workflow.on('started', info => {
                tab.runProgress = { text: `running ${info.frames} frame(s) at ${info.fps} fps`, detail: info.runDir };
                this.view.render();
            }),
            window.workflow.on('step', info => {
                tab.activeNodeId = info.nodeId;
                this.view.highlightExecutingNode(tab.id, info.nodeId);
            }),
            window.workflow.on('frame', displayFrame)
        ];

        let runSummary = null;
        try {
            runSummary = await window.workflow.run({ name: tab.label, graph: tab.graph, logTabId: tab.id });
            if (runSummary.lastFrame) displayFrame(runSummary.lastFrame);
            this.log(tab, 'Workflow', `${runSummary.stopped ? 'Stopped' : 'Completed'} ${runSummary.frames} frame(s)`);
            tab.runProgress = {
                text: `${runSummary.stopped ? 'stopped after' : 'finished'} ${runSummary.frames} frame(s)`
                    + `${runSummary.late ? `, ${runSummary.late} late` : ''}  in  ${runSummary.runDir}`,
                detail: runSummary.runDir
            };
        } catch (err) {
            this.log(tab, 'Workflow', err.message, 'error');
            tab.runProgress = { failed: true, text: `run failed: ${err.message}`, detail: err.message };
        } finally {
            await viewQueue;
            tab.activeNodeId = null;
            this.view.highlightExecutingNode(tab.id, null);
            for (const remove of listeners) remove();
            tab.running = false;
            this.view.render();
            if (runSummary) {
                setTimeout(() => this.view.showWorkflowFinishedAlert(tab, runSummary), 50);
            }
        }
    }

    async stopWorkflowRun() {
        await window.workflow.stop();
    }

    removeWorkflowNode(tabId, nodeId) {
        const tab = this.model.getTab(tabId);
        const count = tab?.graph?.nodes.length;
        this.model.removeWorkflowNode(tabId, nodeId);
        if (tab?.graph?.nodes.length !== count) this.markWorkflowDirty(tabId);
        this.view.render();
    }

    connectWorkflowPorts(tabId, from, to) {
        if (this.model.addWorkflowEdge(tabId, from, to)) this.markWorkflowDirty(tabId);
        this.view.render();
    }

    selectWorkflowEdge(tabId, edgeId) {
        this.model.selectWorkflowEdge(tabId, edgeId);
        this.view.render();
    }

    removeWorkflowEdge(tabId, edgeId) {
        const tab = this.model.getTab(tabId);
        const count = tab?.graph?.edges.length;
        this.model.removeWorkflowEdge(tabId, edgeId);
        if (tab?.graph?.edges.length !== count) this.markWorkflowDirty(tabId);
        this.view.render();
    }

    async openFolder() {
        const folder = await window.explorer.openFolder();
        if (!folder) return;
        this.explorer.setFolder(folder);
        this.view.render();
    }

    toggleExplorerFolder(path) {
        this.explorer.toggleFolder(path);
        this.view.render();
    }

    // Opens an Explorer file in the focused group, or switches to it if that group already has it open.
    openImage(file) {
        const existing = this.model.findTabByPath(this.model.activeGroupId, file.path);
        if (existing) {
            this.model.selectTab(existing.id);
        } else {
            this.model.addTab({ label: file.name, src: file.url, path: file.path });
        }
        this.view.render();
    }

    async openWorkflowArtifact(tabId, nodeId, portName) {
        const workflowTab = this.model.getTab(tabId);
        const artifact = workflowTab?.latestArtifacts?.[nodeId]?.find(item => item.port === portName);
        return this.openWorkflowArtifactInTab(tabId, artifact);
    }

    async openWorkflowArtifactInTab(tabId, artifact, previewKey = null) {
        const group = this.model.findGroupOfTab(tabId);
        if (!artifact?.path || !group) return;

        try {
            const opened = await window.workflow.openArtifact(artifact.path,
                ['text', 'keypoints', 'matches'].includes(artifact.type) ? 'text' : undefined);
            if (!opened) return;
            const preview = previewKey && group.tabs.find(tab => tab.previewKey === previewKey);
            if (preview && opened.kind === 'image') {
                Object.assign(preview, {
                    label: opened.name, src: opened.url, path: opened.path,
                    resultSrc: null, resultMeta: null, serviceError: null, activeAction: null
                });
                this.model.selectTab(preview.id);
                this.view.render();
                return;
            }
            if (preview && ['text', 'json'].includes(opened.kind)) {
                Object.assign(preview, {
                    label: opened.name, path: opened.path,
                    content: opened.content, cleanContent: opened.content
                });
                this.model.selectTab(preview.id);
                this.view.render();
                return;
            }
            const existing = this.model.findTabByPath(group.id, opened.path);
            if (existing && !previewKey) {
                this.model.selectTab(existing.id);
            } else if (opened.kind === 'image') {
                const id = this.model.addTab({ label: opened.name, src: opened.url, path: opened.path }, group.id);
                if (previewKey) this.model.getTab(id).previewKey = previewKey;
            } else if (opened.kind === 'json' || opened.kind === 'text') {
                const id = this.model.addTab({
                    label: opened.name,
                    path: opened.path,
                    type: opened.kind === 'text' ? 'text-artifact' : 'json-artifact',
                    content: opened.content,
                    cleanContent: opened.content
                }, group.id);
                if (previewKey) this.model.getTab(id).previewKey = previewKey;
            }
            this.view.render();
        } catch (err) {
            window.alert(`Could not open ${artifact.port}: ${err.message}`);
        }
    }

    selectTab(id) {
        const group = this.model.findGroupOfTab(id);
        if (group && group.id === this.model.activeGroupId && group.activeTabId === id) {
            return;
        }
        this.model.selectTab(id);
        this.view.render();
    }

    closeTab(id) {
        const tab = this.model.getTab(id);
        if (tab?.type === 'scene-composer' && tab.dirty && !window.confirm('Close Scene Composer and discard unsaved changes?')) return;
        this.model.closeTab(id);
        this.view.render();
    }

    setZoom(id, zoom) {
        const tab = this.model.getTab(id);
        if (tab) tab.fitImage = false;
        this.model.setZoom(id, zoom);
        this.view.render();
    }

    resetTab(id) {
        this.model.resetTab(id);
        this.view.render();
    }

    moveTab(tabId, toGroupId, index) {
        this.model.moveTab(tabId, toGroupId, index);
        this.view.render();
    }

    splitGroup(groupId) {
        this.model.splitGroup(groupId);
        this.view.render();
    }

    splitWithTab(tabId, besideGroupId, side) {
        this.model.splitWithTab(tabId, besideGroupId, side);
        this.view.render();
    }

    resizeGroups(leftId, rightId, leftSize, rightSize) {
        this.model.resizeGroups(leftId, rightId, leftSize, rightSize);
        this.view.render();
    }

    // Takes the tab explicitly: with several groups, the toolbar clicked may not be in the active group.
    async runAction(tabId, action, params = {}) {
        const tab = this.model.getTab(tabId);
        if (!tab) return;

        this.model.selectTab(tabId);
        tab.activeAction = action;
        this.log(tab, action, 'Operation requested');
        tab.serviceError = null;
        this.view.render();

        try {
            const result = await this.runner.run(tab, action, params);
            tab.resultSrc = result.image;
            tab.resultMeta = result;
            this.log(tab, action, 'Operation completed');
        } catch (err) {
            console.warn(err.message);
            tab.serviceError = err.message;
            this.log(tab, action, err.message, 'error');
        }

        this.view.render();
    }

    async runFourier(tabId) {
        const sourceTab = this.model.getTab(tabId);
        if (!sourceTab) return;

        sourceTab.serviceError = null;
        this.log(sourceTab, 'FOURIER', 'Operation requested');
        this.view.render();

        try {
            const result = await this.runner.run(sourceTab, 'FOURIER');
            this.log(sourceTab, 'FOURIER', 'Operation completed');
            this.model.addTab({
                label: `Fourier: ${sourceTab.label}`,
                src: result.image,
                path: result.path ?? null,
                pixelType: 'CV_8UC1'
            });
            this.view.render();
        } catch (err) {
            console.warn(err.message);
            sourceTab.serviceError = err.message;
            this.log(sourceTab, 'FOURIER', err.message, 'error');
            this.view.render();
        }
    }

    async runDisparity(request) {
        const left = this.model.getTab(request.leftTabId);
        const right = this.model.getTab(request.rightTabId);
        if (!left || !right) return;

        left.serviceError = null;
        this.log(left, 'DISPARITY', 'Operation requested');
        this.view.render();

        try {
            const result = await this.runner.runStereo({ ...request, left, right });
            this.log(left, 'DISPARITY', 'Operation completed');
            this.model.addTab({
                label: `Disparity: ${left.label} / ${right.label}`,
                src: result.image,
                path: result.path ?? null,
                pixelType: 'CV_32FC1'
            });
            this.view.render();
        } catch (err) {
            console.warn(err.message);
            left.serviceError = err.message;
            this.log(left, 'DISPARITY', err.message, 'error');
            this.view.render();
        }
    }
}

// Local mode: the page asks the main process (via preload bridge) to execFile the matching cv-cli tool.
export class LocalRunner {
    async run(tab, action, params = {}) {
        if (!tab.path) throw new Error(`${tab.label} has no file on disk to process`);
        return window.vision.run(action, tab.path, params, tab.id);
    }

    async runStereo(request) {
        throw new Error('Disparity processing is not implemented yet; stereo request validated.');
    }
}

// Remote mode: POST to the Crow REST server; uploads bytes since the server can't see our disk.
export class RestRunner {

    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async run(tab, action, params = {}) {
        const endpoint = `${this.baseUrl}/${action.toLowerCase().replace(/\s+/g, '-')}`;

        const imageBlob = await (await fetch(tab.src)).blob();
        const formData = new FormData();
        formData.append('image', imageBlob, tab.label);
        formData.append('params', JSON.stringify(params));

        const response = await fetch(endpoint, { method: 'POST', body: formData });
        if (!response.ok) {
            throw new Error(`${action} failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
}