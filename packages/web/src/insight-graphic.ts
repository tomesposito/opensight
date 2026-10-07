import { format } from 'echarts/core';
import type { EChartsOption } from 'echarts';
import type { InsightNarrative } from './insight-narrative.js';
import type { AnalysisTheme } from './themes.js';

type Run = { text: string; weight: number };
/** KPI's graphic-text pipeline. Words span emphasis boundaries, including punctuation. */
export function insightGraphic(narrative: InsightNarrative, theme: AnalysisTheme, fontSize = 16, width = 560): { graphic: EChartsOption['graphic']; height: number } {
  const graphic: NonNullable<EChartsOption['graphic']> = [];
  const maxWidth = Math.max(32, width - 32), lineHeight = Math.ceil(fontSize * 1.6);
  const measure = (run: Run) => format.getTextRect(run.text, `${run.weight} ${fontSize}px ${theme.fontFamily}`).width;
  let y = 16;
  for (const paragraph of narrative.paragraphs) {
    const tokens: Run[][] = [];
    let whitespace: boolean | undefined;
    for (const part of paragraph.parts) for (const char of part.text) {
      const space = /\s/.test(char), weight = part.value !== undefined ? 700 : 400;
      if (space !== whitespace) { tokens.push([]); whitespace = space; }
      const token = tokens.at(-1)!, previous = token.at(-1);
      if (previous?.weight === weight) previous.text += char; else token.push({ text: char, weight });
    }
    let x = 16;
    const draw = (run: Run) => {
      graphic.push({ type: 'text', x, y, silent: true, style: { text: run.text, fontSize, fontWeight: run.weight, fontFamily: theme.fontFamily, fill: theme.textColor, verticalAlign: 'top' } });
      x += measure(run);
    };
    for (const token of tokens) {
      const space = /^\s+$/.test(token[0]!.text), w = token.reduce((sum, run) => sum + measure(run), 0);
      if (x > 16 && x + w > maxWidth + 16) { x = 16; y += lineHeight; }
      if (space && x === 16) continue;
      if (w <= maxWidth) token.forEach(draw);
      else for (const run of token) {
        // Overlong identifiers wrap by character without interpreting data as markup.
        let fragment = '';
        for (const char of run.text) {
          if (x + measure({ ...run, text: fragment + char }) > maxWidth + 16 && (fragment || x > 16)) {
            if (fragment) draw({ ...run, text: fragment }); fragment = ''; x = 16; y += lineHeight;
          }
          fragment += char;
        }
        if (fragment) draw({ ...run, text: fragment });
      }
    }
    y += lineHeight + 12;
  }
  return { graphic, height: y + 4 };
}
