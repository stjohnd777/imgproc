export function fitScale(width, height, availableWidth, availableHeight) {
    if (width <= 0 || height <= 0 || availableWidth <= 0 || availableHeight <= 0) return 1;
    return Math.min(1, availableWidth / width, availableHeight / height);
}

export function nodeParameterSummary(node) {
    const p = node.params ?? {};
    if (node.elementId === 'process_text') return 'JSON -> process(objIn) -> JSON';
    const basename = value => String(value).split(/[\\/]/).at(-1);
    if (node.elementId === 'synthetic_scene_source') {
        let scene;
        try { scene = p.config_json ? JSON.parse(p.config_json) : null; }
        catch { return 'Invalid scene JSON'; }
        const sun = scene?.environment?.sun?.direction;
        return [
            p.params_file && basename(p.params_file),
            `Camera: ${p.camera_name || scene?.camera_rig?.cameras?.[0]?.name || 'first in JSON'}`,
            sun?.representation === 'azimuth_elevation' && `Sun: ${sun.azimuth_deg}° / ${sun.elevation_deg}°`
        ].filter(Boolean).join(' · ');
    }
    if (node.elementId === 'ui_view' || node.elementId === 'ui_view_text') {
        return (p.reuse_tab ?? true) ? 'Reuse preview tab' :
            node.elementId === 'ui_view_text' ? 'Separate text tabs' : 'Separate image tabs';
    }
    return Object.entries(p).filter(([, value]) => value !== null && value !== undefined && value !== '')
        .slice(0, 3).map(([key, value]) => `${key}: ${typeof value === 'string' ? basename(value) : value}`).join(' · ');
}
export const ELEMENT_CATEGORIES = [
    { category: 'source', title: 'Sources' },
    { category: 'enhancement', title: 'Image Enhancement' },
    { category: 'geometry', title: 'Geometry & Calibration' },
    { category: 'segmentation', title: 'Segmentation & Edges' },
    { category: 'feature', title: 'Features' },
    { category: 'stereo', title: 'Stereo & 3D' },
    { category: 'analysis', title: 'Analysis' },
    { category: 'simulation', title: 'Simulation' },
    { category: 'utility', title: 'Utilities' },
    { category: 'sink', title: 'Sinks & Viewers' }
];

export function elementCategory(element) {
    // Keep older/custom definitions in the palette without obsolete sections.
    if (element.category === 'filter') return 'enhancement';
    if (element.category === 'flow') return 'utility';
    if (element.category) return element.category;
    return element.kind === 'transform' ? 'utility' : element.kind;
}
