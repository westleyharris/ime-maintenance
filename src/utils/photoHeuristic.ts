// ── Which of a row's photos is the machine, not the nameplate? ────────────────
//
// Every asset row carries a wide shot of the machine and a close-up of its spec
// nameplate, in no reliable order (position alone is only ~70% right). Nothing in
// the file says which is which — no EXIF, generic picture names, no alt text.
//
// What does separate them is FRAMING. The nameplate shots are cropped in on the
// plate, so they carry fewer pixels and compress smaller, and they are brighter
// (a pale metal plate filling the frame) than a wide shot of a plant floor.
//
// Measured against 46 hand-labelled pairs from the Alsip L1 workbook:
//
//   larger file                              93%
//   more pixels                              93%
//   2-of-3: bigger + more pixels + darker    96%
//   "always the second photo"                70%   ← position is not a signal
//   colour saturation                        52%   ← no signal at all
//
// So this is a framing heuristic, not image understanding: it never "recognises"
// a nameplate. It pre-selects, and a human confirms — at 96% expect roughly 5
// wrong in 125, which is why every card is still shown for review.

import type { WorkbookImage } from './mappingWorkbook';

export interface PhotoMetrics {
  bytes: number;
  pixels: number;
  /** Mean luminance 0-255. Nameplate close-ups run brighter. */
  brightness: number;
}

/** Decode small — only summary statistics are needed, never the full bitmap. */
async function measure(img: WorkbookImage): Promise<PhotoMetrics> {
  const base: PhotoMetrics = { bytes: img.bytes.byteLength, pixels: 0, brightness: 128 };
  try {
    const blob = new Blob([img.bytes as unknown as BlobPart], { type: img.mime });
    const bmp = await createImageBitmap(blob, { resizeWidth: 32, resizeHeight: 32, resizeQuality: 'low' });
    const full = await createImageBitmap(blob).catch(() => null);
    base.pixels = full ? full.width * full.height : 0;
    full?.close();

    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(32, 32)
      : Object.assign(document.createElement('canvas'), { width: 32, height: 32 });
    const ctx = (canvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (ctx) {
      ctx.drawImage(bmp, 0, 0, 32, 32);
      const { data } = ctx.getImageData(0, 0, 32, 32);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      base.brightness = sum / (data.length / 4);
    }
    bmp.close();
  } catch {
    /* fall back to bytes alone — still ~93% on its own */
  }
  return base;
}

export async function measureAll(
  images: WorkbookImage[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, PhotoMetrics>> {
  const unique = [...new Map(images.map(i => [i.path, i])).values()];
  const out = new Map<string, PhotoMetrics>();
  let done = 0;
  const CONCURRENCY = 8;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= unique.length) return;
      out.set(unique[i].path, await measure(unique[i]));
      onProgress?.(++done, unique.length);
    }
  }));
  return out;
}

/** True when a beats b on the 2-of-3 vote. */
function beats(a: PhotoMetrics, b: PhotoMetrics): boolean {
  let v = 0;
  v += a.bytes > b.bytes ? 1 : -1;
  v += a.pixels > b.pixels ? 1 : -1;
  v += a.brightness < b.brightness ? 1 : -1;
  return v > 0;
}

/**
 * Index of the photo most likely to be the machine. Rows almost always hold two
 * photos; the round-robin generalises the same vote to the rare third.
 */
export function pickAssetPhoto(images: WorkbookImage[], metrics: Map<string, PhotoMetrics>): number {
  if (images.length <= 1) return 0;
  const m = images.map(i => metrics.get(i.path) ?? { bytes: i.bytes.byteLength, pixels: 0, brightness: 128 });
  let best = 0, bestWins = -1;
  for (let i = 0; i < m.length; i++) {
    let wins = 0;
    for (let j = 0; j < m.length; j++) if (i !== j && beats(m[i], m[j])) wins++;
    if (wins > bestWins) { bestWins = wins; best = i; }
  }
  return best;
}

/**
 * How lopsided the call was, 0-1. Small gaps mean the two photos are framed
 * alike and the pick is closer to a coin flip.
 */
export function pickConfidence(images: WorkbookImage[], metrics: Map<string, PhotoMetrics>): number {
  if (images.length <= 1) return 1;
  const sizes = images.map(i => (metrics.get(i.path)?.bytes ?? i.bytes.byteLength));
  const hi = Math.max(...sizes), lo = Math.min(...sizes);
  if (lo <= 0) return 0;
  return Math.min(1, (hi / lo - 1) / 1.5);   // 2.5x gap or more reads as certain
}
