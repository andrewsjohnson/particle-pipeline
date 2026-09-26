export function encodeRGBE(
  data: Float32Array,
  width: number,
  height: number
): Uint8Array {
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const headerBytes = new TextEncoder().encode(header);
  const pixels = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const maxc = Math.max(r, g, b);
    if (maxc < 1e-9 || !Number.isFinite(maxc)) {
      pixels.set([0, 0, 0, 0], i * 4);
      continue;
    }
    const e = Math.ceil(Math.log2(maxc));
    const scale = Math.pow(2, e - 8);
    pixels[i * 4 + 0] = Math.min(255, Math.max(0, Math.round(r / scale)));
    pixels[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(g / scale)));
    pixels[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(b / scale)));
    pixels[i * 4 + 3] = e + 128;
  }

  const out = new Uint8Array(headerBytes.length + pixels.length);
  out.set(headerBytes, 0);
  out.set(pixels, headerBytes.length);
  return out;
}

