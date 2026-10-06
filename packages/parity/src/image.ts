import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { ParityError, ERR } from './types.js';

export interface RgbaImage {
  w: number;
  h: number;
  /** Row-major RGBA bytes. */
  data: Buffer;
}

/** Decode a PNG file into RGBA. Only PNG is supported: reference JPEGs
 *  are converted to PNG once during reference preparation (see
 *  docs/parity-measurement.md), keeping the dependency set MIT-only. */
export async function decodePng(path: string): Promise<RgbaImage> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (cause) {
    throw new ParityError(ERR.READ_FAILED, `cannot read ${path}: ${(cause as Error).message}`);
  }
  if (!path.toLowerCase().endsWith('.png')) {
    throw new ParityError(
      ERR.UNSUPPORTED_FORMAT,
      `only .png is supported (got ${path}); convert references during preparation`,
    );
  }
  let png: PNG;
  try {
    png = PNG.sync.read(bytes);
  } catch (cause) {
    throw new ParityError(ERR.DECODE_FAILED, `cannot decode ${path}: ${(cause as Error).message}`);
  }
  if (png.width <= 0 || png.height <= 0 || png.data.length !== png.width * png.height * 4) {
    throw new ParityError(ERR.INVALID_IMAGE, `${path} decoded to an invalid image`);
  }
  return { w: png.width, h: png.height, data: Buffer.from(png.data) };
}

export interface Normalization {
  image: RgbaImage;
  scale: number;
  crop: { x: number; y: number };
  aspectMismatch: boolean;
}

const ASPECT_TOLERANCE = 0.15;

function sampleBilinear(img: RgbaImage, fx: number, fy: number, channel: number): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, img.w - 1);
  const y1 = Math.min(y0 + 1, img.h - 1);
  const dx = fx - x0;
  const dy = fy - y0;
  const at = (x: number, y: number): number => img.data[(y * img.w + x) * 4 + channel] ?? 0;
  const top = at(x0, y0) * (1 - dx) + at(x1, y0) * dx;
  const bottom = at(x0, y1) * (1 - dx) + at(x1, y1) * dx;
  return top * (1 - dy) + bottom * dy;
}

/**
 * Normalize a capture to the reference canvas: the reference is the
 * authority. The capture is scaled with cover-fit (uniform scale, no
 * aspect distortion), top-left aligned, and cropped to the reference
 * size. Report records scale/crop so any run is reproducible.
 */
export function normalizeToReference(ref: RgbaImage, cap: RgbaImage): Normalization {
  const scale = Math.max(ref.w / cap.w, ref.h / cap.h);
  const sw = Math.max(1, Math.round(cap.w * scale));
  const sh = Math.max(1, Math.round(cap.h * scale));
  const scaled = Buffer.alloc(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const fx = (x / sw) * cap.w - 0.5;
      const fy = (y / sh) * cap.h - 0.5;
      const cx = Math.min(Math.max(fx, 0), cap.w - 1);
      const cy = Math.min(Math.max(fy, 0), cap.h - 1);
      const o = (y * sw + x) * 4;
      for (let c = 0; c < 4; c++) scaled[o + c] = Math.round(sampleBilinear(cap, cx, cy, c));
    }
  }
  // Top-left aligned crop: chrome (header/toolbar/panels) aligns at the
  // top, excess is cropped from the bottom/right.
  const cropX = 0;
  const cropY = 0;
  const out = Buffer.alloc(ref.w * ref.h * 4);
  for (let y = 0; y < ref.h; y++) {
    const sy = Math.min(y + cropY, sh - 1);
    scaled.copy(out, y * ref.w * 4, (sy * sw + cropX) * 4, (sy * sw + cropX + ref.w) * 4);
  }
  const aspectRef = ref.w / ref.h;
  const aspectCap = cap.w / cap.h;
  const aspectMismatch = Math.abs(aspectRef - aspectCap) / aspectRef > ASPECT_TOLERANCE;
  return { image: { w: ref.w, h: ref.h, data: out }, scale, crop: { x: cropX, y: cropY }, aspectMismatch };
}

/** Convert a fractional rect to pixel bounds, clamped to the canvas. */
export function fracToPixels(rect: { x: number; y: number; w: number; h: number }, w: number, h: number): {
  x0: number; y0: number; x1: number; y1: number; clamped: boolean;
} {
  const x0 = Math.floor(rect.x * w);
  const y0 = Math.floor(rect.y * h);
  const x1 = Math.ceil((rect.x + rect.w) * w);
  const y1 = Math.ceil((rect.y + rect.h) * h);
  const cx0 = Math.min(Math.max(x0, 0), w);
  const cy0 = Math.min(Math.max(y0, 0), h);
  const cx1 = Math.min(Math.max(x1, 0), w);
  const cy1 = Math.min(Math.max(y1, 0), h);
  return { x0: cx0, y0: cy0, x1: cx1, y1: cy1, clamped: cx0 !== x0 || cy0 !== y0 || cx1 !== x1 || cy1 !== y1 };
}
