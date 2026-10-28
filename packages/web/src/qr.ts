/*!
 * QR parameter tables adapted from QRCode for JavaScript.
 * Copyright (c) 2009 Kazuhiko Arase. MIT License.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
// Model 2 QR, byte mode, level L, versions 1–40. Input is ASCII: otpauth
// account labels are percent-encoded. No network, canvas, or runtime dependency.
const blocks: readonly (readonly number[])[] = [
  [1,26,19],
  [1,44,34],
  [1,70,55],
  [1,100,80],
  [1,134,108],
  [2,86,68],
  [2,98,78],
  [2,121,97],
  [2,146,116],
  [2,86,68,2,87,69],
  [4,101,81],
  [2,116,92,2,117,93],
  [4,133,107],
  [3,145,115,1,146,116],
  [5,109,87,1,110,88],
  [5,122,98,1,123,99],
  [1,135,107,5,136,108],
  [5,150,120,1,151,121],
  [3,141,113,4,142,114],
  [3,135,107,5,136,108],
  [4,144,116,4,145,117],
  [2,139,111,7,140,112],
  [4,151,121,5,152,122],
  [6,147,117,4,148,118],
  [8,132,106,4,133,107],
  [10,142,114,2,143,115],
  [8,152,122,4,153,123],
  [3,147,117,10,148,118],
  [7,146,116,7,147,117],
  [5,145,115,10,146,116],
  [13,145,115,3,146,116],
  [17,145,115],
  [17,145,115,1,146,116],
  [13,145,115,6,146,116],
  [12,151,121,7,152,122],
  [6,151,121,14,152,122],
  [17,152,122,4,153,123],
  [4,152,122,18,153,123],
  [20,147,117,4,148,118],
  [19,148,118,6,149,119],
];
const alignment: readonly (readonly number[])[] = [
  [],
  [6,18],
  [6,22],
  [6,26],
  [6,30],
  [6,34],
  [6,22,38],
  [6,24,42],
  [6,26,46],
  [6,28,50],
  [6,30,54],
  [6,32,58],
  [6,34,62],
  [6,26,46,66],
  [6,26,48,70],
  [6,26,50,74],
  [6,30,54,78],
  [6,30,56,82],
  [6,30,58,86],
  [6,34,62,90],
  [6,28,50,72,94],
  [6,26,50,74,98],
  [6,30,54,78,102],
  [6,28,54,80,106],
  [6,32,58,84,110],
  [6,30,58,86,114],
  [6,34,62,90,118],
  [6,26,50,74,98,122],
  [6,30,54,78,102,126],
  [6,26,52,78,104,130],
  [6,30,56,82,108,134],
  [6,34,60,86,112,138],
  [6,30,58,86,114,142],
  [6,34,62,90,118,146],
  [6,30,54,78,102,126,150],
  [6,24,50,76,102,128,154],
  [6,28,54,80,106,132,158],
  [6,32,58,84,110,136,162],
  [6,26,54,82,110,138,166],
  [6,30,58,86,114,142,170],
];

function multiply(a: number, b: number): number {
  let result = 0;
  for (; b; b >>>= 1) {
    if (b & 1) result ^= a;
    a <<= 1; if (a & 256) a ^= 0x11d;
  }
  return result;
}
function parity(data: number[], count: number): number[] {
  let generator = [1], root = 1;
  for (let degree = 0; degree < count; degree++) {
    const next = Array<number>(generator.length + 1).fill(0);
    generator.forEach((value, i) => { next[i] = next[i]! ^ value; next[i + 1] = next[i + 1]! ^ multiply(value, root); });
    generator = next; root = multiply(root, 2);
  }
  const remainder = [...data, ...Array<number>(count).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i]!;
    generator.forEach((value, j) => { remainder[i + j] = remainder[i + j]! ^ multiply(value, factor); });
  }
  return remainder.slice(data.length);
}
function bch(value: number, shift: number, polynomial: number): number {
  let remainder = value << shift;
  while (remainder && Math.clz32(remainder) <= Math.clz32(polynomial)) remainder ^= polynomial << (Math.clz32(polynomial) - Math.clz32(remainder));
  return (value << shift) | remainder;
}
function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return x * y % 2 + x * y % 3 === 0;
    case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
    default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
  }
}
function matrix(version: number, words: number[], mask: number): boolean[][] {
  const size = version * 4 + 17;
  const cells = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));
  const set = (x: number, y: number, dark: boolean) => { if (x >= 0 && y >= 0 && x < size && y < size) cells[y]![x] = dark; };
  for (const [left, top] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
      set(left + x, top + y, x >= 0 && x <= 6 && y >= 0 && y <= 6 && (x === 0 || x === 6 || y === 0 || y === 6 || x >= 2 && x <= 4 && y >= 2 && y <= 4));
    }
  }
  for (const y of alignment[version - 1]!) for (const x of alignment[version - 1]!) {
    if (cells[y]![x] !== null) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  for (let i = 8; i < size - 8; i++) {
    if (cells[i]![6] === null) set(6, i, i % 2 === 0);
    if (cells[6]![i] === null) set(i, 6, i % 2 === 0);
  }
  const format = bch((1 << 3) | mask, 10, 0x537) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = ((format >>> i) & 1) === 1;
    set(8, i < 6 ? i : i < 8 ? i + 1 : size - 15 + i, bit);
    set(i < 8 ? size - i - 1 : i === 8 ? 7 : 14 - i, 8, bit);
  }
  set(8, size - 8, true);
  if (version >= 7) {
    const info = bch(version, 12, 0x1f25);
    for (let i = 0; i < 18; i++) {
      const bit = ((info >>> i) & 1) === 1;
      set(size - 11 + i % 3, Math.floor(i / 3), bit);
      set(Math.floor(i / 3), size - 11 + i % 3, bit);
    }
  }
  let bit = 0, upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let row = 0; row < size; row++) {
      const y = upward ? size - 1 - row : row;
      for (let x = right; x >= right - 1; x--) {
        if (cells[y]![x] !== null) continue;
        const dark = (((words[Math.floor(bit / 8)] ?? 0) >>> (7 - bit % 8)) & 1) === 1;
        set(x, y, dark !== masked(mask, x, y)); bit++;
      }
    }
    upward = !upward;
  }
  return cells.map(row => row.map(cell => cell === true));
}
function penalty(cells: boolean[][]): number {
  const size = cells.length;
  let score = 0, dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (cells[y]![x]) dark++;
    if (x && y && cells[y]![x] === cells[y - 1]![x] && cells[y]![x] === cells[y]![x - 1] && cells[y]![x] === cells[y - 1]![x - 1]) score += 3;
  }
  for (let direction = 0; direction < 2; direction++) for (let i = 0; i < size; i++) {
    const line = direction ? cells.map(row => row[i]!) : cells[i]!;
    let run = 1;
    for (let j = 1; j < size; j++) {
      if (line[j] === line[j - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
    }
    const bits = line.map(value => value ? '1' : '0').join('');
    for (let j = 0; j <= size - 11; j++) if (['00001011101', '10111010000'].includes(bits.slice(j, j + 11))) score += 40;
  }
  return score + Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
}
export function encodeQr(text: string): { modules: boolean[][]; version: number; mask: number } {
  if (!text || /[^\x00-\x7f]/.test(text)) throw new Error('QR_INPUT_INVALID');
  const version = blocks.findIndex((groups, i) => {
    let capacity = 0;
    for (let j = 0; j < groups.length; j += 3) capacity += groups[j]! * groups[j + 2]!;
    return text.length * 8 + 4 + (i < 9 ? 8 : 16) <= capacity * 8;
  }) + 1;
  if (!version) throw new Error('QR_INPUT_TOO_LONG');
  const specs: { total: number; data: number }[] = [], groups = blocks[version - 1]!;
  for (let i = 0; i < groups.length; i += 3) for (let j = 0; j < groups[i]!; j++) specs.push({ total: groups[i + 1]!, data: groups[i + 2]! });
  const capacity = specs.reduce((sum, block) => sum + block.data, 0), bits: number[] = [];
  const put = (value: number, count: number) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(4, 4); put(text.length, version < 10 ? 8 : 16);
  for (let i = 0; i < text.length; i++) put(text.charCodeAt(i), 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((value, bit) => value * 2 + bit, 0));
  for (let pad = 0; data.length < capacity; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  let offset = 0;
  const parts = specs.map(block => {
    const bytes = data.slice(offset, offset + block.data); offset += block.data;
    return { data: bytes, ecc: parity(bytes, block.total - block.data) };
  });
  const words: number[] = [];
  for (const kind of ['data', 'ecc'] as const) for (let i = 0; i < Math.max(...parts.map(part => part[kind].length)); i++) for (const part of parts) {
    if (i < part[kind].length) words.push(part[kind][i]!);
  }
  let best = matrix(version, words, 0), mask = 0, score = penalty(best);
  for (let candidate = 1; candidate < 8; candidate++) {
    const modules = matrix(version, words, candidate), next = penalty(modules);
    if (next < score) { best = modules; mask = candidate; score = next; }
  }
  return { modules: best, version, mask };
}
