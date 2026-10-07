import { format } from 'echarts/core';
import type { EChartsOption } from 'echarts';
import type { InsightNarrative } from './insight-narrative.js';
import type { AnalysisTheme } from './themes.js';

/** KPI's graphic-text pipeline, laid out as paragraphs. Plain text avoids rich-text injection. */
export function insightGraphic(narrative: InsightNarrative, theme: AnalysisTheme, fontSize = 16, width = 560): { graphic: EChartsOption['graphic']; height: number } {
  const graphic: NonNullable<EChartsOption['graphic']> = [];
  const maxWidth = Math.max(32, width - 32), lineHeight = Math.ceil(fontSize * 1.6);
  let y = 16;
  for (const paragraph of narrative.paragraphs) {
    let x = 16;
    for (const part of paragraph.parts) {
      const weight = part.value !== undefined ? 700 : 400;
      const font = `${weight} ${fontSize}px ${theme.fontFamily}`;
      for (const word of part.text.split(/(\s+)/).filter(Boolean)) {
        // Split overlong identifiers as well as ordinary word wrapping.
        let fragment = '';
        const flush = () => {
          if (!fragment) return;
          const w = format.getTextRect(fragment, font).width;
          if (x > 16 && x + w > maxWidth + 16) { x = 16; y += lineHeight; }
          if (x !== 16 || fragment.trim()) {
            graphic.push({ type: 'text', x, y, silent: true, style: { text: fragment, fontSize, fontWeight: weight, fontFamily: theme.fontFamily, fill: theme.textColor, verticalAlign: 'top' } });
            x += w;
          }
          fragment = '';
        };
        for (const char of word) {
          if (format.getTextRect(fragment + char, font).width > maxWidth) flush();
          fragment += char;
        }
        flush();
      }
    }
    y += lineHeight + 12;
  }
  return { graphic, height: y + 4 };
}
