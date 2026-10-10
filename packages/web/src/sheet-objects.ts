import type { BundleSheet } from '@opensight/bundle-parser';

export const EMBEDDED_IMAGE_LIMIT = 4 * 1024 * 1024;
export const IMAGE_TOO_LARGE = 'IMAGE_TOO_LARGE: Choose an image of 4 MiB or less. Images are embedded on this device; nothing was uploaded or downscaled.';
export interface TextStyle { fontSize: number; bold: boolean; italic: boolean; underline: boolean; color: string; alignment: 'left' | 'center' | 'right' }
interface ObjectIdentity { id: string; importedId?: string }
export interface TextObject extends ObjectIdentity { kind: 'text'; content: string; style: TextStyle }
export interface ImageObject extends ObjectIdentity { kind: 'image'; dataUri: string; alt: string; keepAspectRatio: boolean; opacity: number }
export type SheetObject = TextObject | ImageObject;
export const defaultTextStyle = (): TextStyle => ({ fontSize: 20, bold: false, italic: false, underline: false, color: '#202938', alignment: 'left' });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export function textStyleValid(value: unknown): value is TextStyle {
  return record(value) && keys(value, ['fontSize', 'bold', 'italic', 'underline', 'color', 'alignment']) && Number.isInteger(value.fontSize) && Number(value.fontSize) >= 8 && Number(value.fontSize) <= 96
    && ['bold', 'italic', 'underline'].every(key => typeof value[key] === 'boolean') && typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) && ['left', 'center', 'right'].includes(String(value.alignment));
}
export function imageFileProblem(file: { size: number; type: string }): string | undefined {
  if (file.size > EMBEDDED_IMAGE_LIMIT) return IMAGE_TOO_LARGE;
  if (file.size <= 0 || !/^image\/[a-z0-9.+-]+$/i.test(file.type)) return 'IMAGE_TYPE_UNSUPPORTED: Choose a nonempty image file from this device.';
}
/** Only embedded bytes are accepted, including on import/storage reload. Never load a URL. */
export function imageDataProblem(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'IMAGE_DATA_INVALID: An embedded image data URI is required.';
  if (value.length > Math.ceil(EMBEDDED_IMAGE_LIMIT / 3) * 4 + 100) return IMAGE_TOO_LARGE;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match || match[2]!.length % 4 !== 0) return 'IMAGE_DATA_INVALID: Only base64 embedded image data is supported; remote image URLs are unavailable.';
  const bytes = match[2]!.length / 4 * 3 - (match[2]!.endsWith('==') ? 2 : match[2]!.endsWith('=') ? 1 : 0);
  if (bytes > EMBEDDED_IMAGE_LIMIT) return IMAGE_TOO_LARGE;
}
export async function readEmbeddedImage(file: File): Promise<string> {
  const problem = imageFileProblem(file); if (problem) throw new Error(problem);
  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('IMAGE_READ_FAILED: This device could not read the image. Choose the file again.'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('IMAGE_READ_FAILED: No image bytes were read.'));
    reader.readAsDataURL(file);
  });
  const invalid = imageDataProblem(dataUri); if (invalid) throw new Error(invalid);
  // The browser decodes locally; SVG is used only in the isolated <img> context.
  await new Promise<void>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(); img.onerror = () => reject(new Error('IMAGE_DECODE_FAILED: This browser cannot display that image. Choose another image format.')); img.src = dataUri; });
  return dataUri;
}
export function sheetObjectValid(value: unknown): value is SheetObject {
  if (!record(value) || typeof value.id !== 'string' || !/^object-[1-9][0-9]*$/.test(value.id) || value.importedId !== undefined && (typeof value.importedId !== 'string' || !value.importedId)) return false;
  if (value.kind === 'text') return keys(value, ['id', 'importedId', 'kind', 'content', 'style']) && typeof value.content === 'string' && value.content.length <= 20000 && !value.content.includes('\0') && textStyleValid(value.style);
  return value.kind === 'image' && keys(value, ['id', 'importedId', 'kind', 'dataUri', 'alt', 'keepAspectRatio', 'opacity']) && !imageDataProblem(value.dataUri) && typeof value.alt === 'string' && value.alt.length <= 512 && typeof value.keepAspectRatio === 'boolean' && typeof value.opacity === 'number' && Number.isFinite(value.opacity) && value.opacity >= 0 && value.opacity <= 1;
}
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const objectElementType = (object?: SheetObject) => object?.kind === 'text' ? 'TEXT_BOX' : object?.kind === 'image' ? 'IMAGE' : 'VISUAL';
export function serializeObject(object: SheetObject): Record<string, unknown> {
  const id = object.importedId ?? object.id;
  if (object.kind === 'image') return { sheetImageId: id, source: { opensightDataUri: object.dataUri }, scaling: { scalingType: object.keepAspectRatio ? 'SCALE_TO_FIT' : 'SCALE_TO_FILL' }, imageContentAltText: object.alt, opensightOpacity: object.opacity };
  const s = object.style;
  return { sheetTextBoxId: id, content: `<text-box><p style="font-size:${s.fontSize}px;font-weight:${s.bold ? 'bold' : 'normal'};font-style:${s.italic ? 'italic' : 'normal'};text-decoration:${s.underline ? 'underline' : 'none'};color:${s.color};text-align:${s.alignment}">${escapeHtml(object.content).replace(/\n/g, '<br/>')}</p></text-box>`, opensightText: { content: object.content, style: object.style } };
}
export function serializeObjects(objects: readonly SheetObject[] = []): Partial<Pick<BundleSheet, 'textBoxes' | 'images'>> {
  return { ...(objects.some(o => o.kind === 'text') ? { textBoxes: objects.filter(o => o.kind === 'text').map(serializeObject) } : {}), ...(objects.some(o => o.kind === 'image') ? { images: objects.filter(o => o.kind === 'image').map(serializeObject) } : {}) };
}
/** Unsupported foreign markup and URL-backed images remain opaque in the original
 * bundle and import report. No HTML is injected and no remote URL is rendered. */
export function importObjects(sheet: BundleSheet, nextId: () => string, messages: string[]): SheetObject[] {
  const objects: SheetObject[] = [];
  for (const [key, kind] of [['textBoxes', 'text'], ['images', 'image']] as const) {
    const raw = sheet[key]; if (raw === undefined) continue;
    if (!Array.isArray(raw)) { messages.push(`${key}: unsupported shape retained, read-only.`); continue; }
    for (const entry of raw) {
      if (!record(entry)) { messages.push(`${key}: unsupported element retained, read-only.`); continue; }
      const id = nextId(), importedId = entry[kind === 'text' ? 'sheetTextBoxId' : 'sheetImageId'];
      const text = record(entry.opensightText) ? entry.opensightText : typeof entry.content === 'string' && !/[<>]/.test(entry.content) ? { content: entry.content, style: defaultTextStyle() } : {};
      const source = record(entry.source) ? entry.source : {};
      const scaling = record(entry.scaling) ? entry.scaling : {};
      const object = kind === 'text' ? { id, importedId, kind, content: text.content, style: text.style }
        : { id, importedId, kind, dataUri: source.opensightDataUri, alt: entry.imageContentAltText ?? '', keepAspectRatio: scaling.scalingType !== 'SCALE_TO_FILL', opacity: entry.opensightOpacity ?? 1 };
      if (typeof importedId === 'string' && sheetObjectValid(object)) objects.push(object);
      else messages.push(`${key}.${String(importedId ?? '(missing ID)')}: ${kind === 'image' ? imageDataProblem(source.opensightDataUri) ?? 'Unsupported image settings.' : 'Unsupported rich text markup.'} Retained read-only; not rendered.`);
    }
  }
  return objects;
}
