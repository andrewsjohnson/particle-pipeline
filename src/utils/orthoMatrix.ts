export function orthoMatrix(left: number, right: number, bottom: number, top: number) {
    return new Float32Array([
        2/(right - left), 0, 0, 0,
        0, 2/(top - bottom), 0, 0,
        0, 0, 1, 0,
        -(right + left)/(right - left), -(top + bottom)/(top - bottom), 0, 1,
    ]);
}