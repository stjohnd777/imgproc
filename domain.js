/**
 * A point feature in an image, shared by SIFT, SURF, ORB, FAST, KAZE,
 * BRISK and Shi–Tomasi corners. Coordinates retain subpixel precision.
 *
 * Image dimensions, coordinate space, detector name and parameters belong to
 * the containing feature set. Descriptors belong to its descriptor matrix:
 * descriptorRow links this point to a row without assuming a descriptor type.
 * Missing detector attributes are null, rather than fabricated values.
 */
export class KeyPoint {
    /**
     * @param {object} values
     * @param {number} values.u Horizontal pixel coordinate, increasing rightward.
     * @param {number} values.v Vertical pixel coordinate, increasing downward.
     * @param {number|null} [values.id=null] Nonnegative integer ID within a feature set;
     *   not a cross-image match or tracking ID.
     * @param {number|null} [values.sizePx=null] Positive neighborhood diameter in pixels.
     * @param {number|null} [values.angleDeg=null] Clockwise orientation in [0, 360).
     * @param {number|null} [values.response=null] Detector-specific strength, not a probability.
     * @param {number|null} [values.octave=null] Raw detector-specific pyramid metadata.
     * @param {number|null} [values.descriptorRow=null] Nonnegative descriptor matrix row.
     */
    constructor({
        u, v, id = null, sizePx = null, angleDeg = null,
        response = null, octave = null, descriptorRow = null
    } = {}) {
        for (const [name, value] of Object.entries({ u, v })) {
            if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
        }
        for (const [name, value] of Object.entries({ id, descriptorRow })) {
            if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
                throw new TypeError(`${name} must be a nonnegative safe integer or null`);
            }
        }
        if (sizePx !== null && (!Number.isFinite(sizePx) || sizePx <= 0)) {
            throw new TypeError('sizePx must be a positive finite number or null');
        }
        if (angleDeg !== null && (!Number.isFinite(angleDeg) || angleDeg < 0 || angleDeg >= 360)) {
            throw new TypeError('angleDeg must be in [0, 360) or null');
        }
        if (response !== null && !Number.isFinite(response)) {
            throw new TypeError('response must be a finite number or null');
        }
        if (octave !== null && !Number.isSafeInteger(octave)) {
            throw new TypeError('octave must be a safe integer or null');
        }

        this.id = id;
        this.u = u;
        this.v = v;
        this.sizePx = sizePx;
        this.angleDeg = angleDeg;
        this.response = response;
        this.octave = octave;
        this.descriptorRow = descriptorRow;
    }
}
/**
 * Ideal pinhole intrinsics, in pixels at the calibrated image resolution.
 * Lens distortion is separate; it is not represented by K.
 * Matrices use nested row arrays and multiply column vectors.
 *
 * K = [ fx  skew  cx ]
 *     [  0    fy  cy ]
 *     [  0     0   1 ]
 */
export class CameraIntrinsics {
    /**
     * @param {object} values
     * @param {number} values.fx Positive horizontal focal length in pixels.
     * @param {number} values.fy Positive vertical focal length in pixels.
     * @param {number} values.cx Principal point horizontal coordinate in pixels.
     * @param {number} values.cy Principal point vertical coordinate in pixels.
     * @param {number} [values.skew=0] Intrinsic skew in pixels.
     * @param {number|null} [values.imageWidth=null] Calibration image width.
     * @param {number|null} [values.imageHeight=null] Calibration image height.
     */
    constructor({ fx, fy, cx, cy, skew = 0, imageWidth = null, imageHeight = null } = {}) {
        for (const [name, value] of Object.entries({ fx, fy, cx, cy, skew })) {
            if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
        }
        if (fx <= 0 || fy <= 0) throw new RangeError('fx and fy must be positive');
        for (const [name, value] of Object.entries({ imageWidth, imageHeight })) {
            if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
                throw new TypeError(`${name} must be a positive safe integer or null`);
            }
        }
        this.fx = fx;
        this.fy = fy;
        this.cx = cx;
        this.cy = cy;
        this.skew = skew;
        this.imageWidth = imageWidth;
        this.imageHeight = imageHeight;
    }

    /**
     * Estimates intrinsics from lens/sensor specifications:
     * fx = focalLengthMm * 1000 / pixelPitchUm.x (and likewise for fy).
     * A scalar pitch assumes square pixels; { x, y } supports unequal pitch.
     *
     * Unless supplied, the principal point is estimated at the image center,
     * ((width - 1) / 2, (height - 1) / 2), using integer pixel centers.
     * This is a nominal estimate, not a replacement for camera calibration.
     * Pitch must correspond to the image sampling: account for binning/resizing
     * before using this factory. Cropping can also shift the principal point.
     *
     * @param {object} values
     * @param {number} values.focalLengthMm Positive lens focal length in millimeters.
     * @param {number|{x: number, y: number}} values.pixelPitchUm Positive pitch in micrometers.
     * @param {number|null} [values.imageWidth=null] Required when cx is omitted.
     * @param {number|null} [values.imageHeight=null] Required when cy is omitted.
     * @param {number} [values.cx] Explicit principal point horizontal coordinate.
     * @param {number} [values.cy] Explicit principal point vertical coordinate.
     * @param {number} [values.skew=0] Intrinsic skew in pixels.
     * @returns {CameraIntrinsics}
     */
    static fromFocalLengthAndPixelPitch({
        focalLengthMm, pixelPitchUm,
        imageWidth = null, imageHeight = null, cx, cy, skew = 0
    } = {}) {
        const pitchX = typeof pixelPitchUm === 'number' ? pixelPitchUm : pixelPitchUm?.x;
        const pitchY = typeof pixelPitchUm === 'number' ? pixelPitchUm : pixelPitchUm?.y;
        for (const [name, value] of Object.entries({ focalLengthMm, pitchX, pitchY })) {
            if (!Number.isFinite(value) || value <= 0) {
                throw new TypeError(`${name} must be a positive finite number`);
            }
        }
        if (cx === undefined && (!Number.isSafeInteger(imageWidth) || imageWidth <= 0)) {
            throw new TypeError('Provide cx or a positive integer imageWidth to estimate it');
        }
        if (cy === undefined && (!Number.isSafeInteger(imageHeight) || imageHeight <= 0)) {
            throw new TypeError('Provide cy or a positive integer imageHeight to estimate it');
        }
        return new CameraIntrinsics({
            fx: focalLengthMm * 1000 / pitchX,
            fy: focalLengthMm * 1000 / pitchY,
            cx: cx === undefined ? (imageWidth - 1) / 2 : cx,
            cy: cy === undefined ? (imageHeight - 1) / 2 : cy,
            skew, imageWidth, imageHeight
        });
    }

    // Derived on access: editing a returned matrix does not change the intrinsics.
    get K() {
        return [
            [this.fx, this.skew, this.cx],
            [0, this.fy, this.cy],
            [0, 0, 1]
        ];
    }

    /**
     * Returns the 3x4 projection matrix P = K [R | t].
     * For a world point X = [Xw, Yw, Zw, 1], q = P X and
     * (u, v) = (q[0] / q[2], q[1] / q[2]); visible points need camera Z > 0.
     * This ideal projection excludes lens distortion.
     * @param {CameraExtrinsics} extrinsics World-to-camera transform.
     * @returns {number[][]}
     */
    projectionMatrix(extrinsics) {
        if (!(extrinsics instanceof CameraExtrinsics)) {
            throw new TypeError('extrinsics must be a CameraExtrinsics');
        }
        const rt = extrinsics.T.slice(0, 3);
        return this.K.map(row => Array.from({ length: 4 }, (_, col) =>
            row.reduce((sum, value, index) => sum + value * rt[index][col], 0)));
    }
}

/**
 * World-to-camera extrinsics: Xcamera = R Xworld + t.
 * Camera axes: x right, y down, z forward. Translation and world coordinates
 * must use the same length unit (for example meters).
 *
 * T = [ R00 R01 R02 tx ]
 *     [ R10 R11 R12 ty ]
 *     [ R20 R21 R22 tz ]
 *     [   0   0   0  1 ]
 *
 * t is NOT the camera position in world coordinates; that position is -R^T t.
 * R and t are stored once; T is derived. JSON.stringify stores rotation and
 * translation, so new CameraExtrinsics(JSON.parse(json)) restores the object.
 */
export class CameraExtrinsics {
    /**
     * @param {object} [values]
     * @param {number[][]} [values.rotation] Proper 3x3 rotation, defaults to identity.
     * @param {number[]} [values.translation] Length-3 translation, defaults to zero.
     */
    constructor({
        rotation = [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        translation = [0, 0, 0]
    } = {}) {
        if (!Array.isArray(rotation) || rotation.length !== 3 ||
            !rotation.every(row => Array.isArray(row) && row.length === 3 &&
                Array.from(row).every(Number.isFinite))) {
            throw new TypeError('rotation must be a finite 3x3 matrix');
        }
        if (!Array.isArray(translation) || translation.length !== 3 ||
            !Array.from(translation).every(Number.isFinite)) {
            throw new TypeError('translation must contain three finite numbers');
        }
        // Permit small rounding errors in serialized calibration values.
        const tolerance = 1e-5;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const dot = rotation[i].reduce((sum, value, k) => sum + value * rotation[j][k], 0);
                if (Math.abs(dot - (i === j ? 1 : 0)) > tolerance) {
                    throw new RangeError('rotation must be orthonormal');
                }
            }
        }
        const [a, b, c] = rotation;
        const determinant = a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]);
        if (Math.abs(determinant - 1) > tolerance) {
            throw new RangeError('rotation must have determinant +1');
        }
        this.rotation = rotation.map(row => [...row]);
        this.translation = [...translation];
    }

    get T() {
        return [
            ...this.rotation.map((row, index) => [...row, this.translation[index]]),
            [0, 0, 0, 1]
        ];
    }

    /** Camera position in world coordinates: C = -R^T t. */
    get cameraPosition() {
        return [0, 1, 2].map(col =>
            -this.rotation.reduce((sum, row, index) => sum + row[col] * this.translation[index], 0));
    }
}
