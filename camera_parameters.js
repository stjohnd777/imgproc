export function cameraParameters(spec) {
    const K = spec?.intrinsics?.K;
    if (!Array.isArray(K) || K.length !== 3 ||
        !K.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite)) ||
        K[0][0] <= 0 || K[1][1] <= 0 ||
        K[0][1] !== 0 || K[1][0] !== 0 ||
        K[2][0] !== 0 || K[2][1] !== 0 || K[2][2] !== 1) return null;
    const d = spec.intrinsics.distortion ?? [];
    if (!Array.isArray(d) || d.length > 5 || !d.every(Number.isFinite)) return null;
    return {
        fx: K[0][0], fy: K[1][1], cx: K[0][2], cy: K[1][2],
        k1: d[0] ?? 0, k2: d[1] ?? 0, p1: d[2] ?? 0, p2: d[3] ?? 0, k3: d[4] ?? 0
    };
}
