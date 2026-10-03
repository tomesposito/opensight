import { graphic, registerUpdateLifecycle } from 'echarts/core';

/** ECharts 6 closes missing radar vertices through the center. Preserve actual
 * gaps after its native layout, retaining its scales, labels and interactions.
 * This adapter relies on the native radar item's line/fill/symbol group order;
 * rendered-geometry tests guard that contract when upgrading ECharts. */
export function installRadarGaps(): void {
  registerUpdateLifecycle('series:afterupdate', model => {
    model.eachSeriesByType('radar', series => {
      const data = series.getData();
      data.eachItemGraphicEl((item, index) => {
        if (!(item instanceof graphic.Group)) return;
        const line = item.childAt(0), fill = item.childAt(1), symbols = item.childAt(2);
        if (!(line instanceof graphic.Polyline) || !(fill instanceof graphic.Polygon) || !(symbols instanceof graphic.Group)) return;
        const points = line.shape.points;
        const present = points.slice(0, -1).map((_, i) => Number.isFinite(data.get(data.dimensions[i]!, index)));
        const complete = present.every(Boolean);
        // Incomplete polygons have no defensible filled area. Invisible also
        // holds in hover/selection states, unlike a normal-state opacity alone.
        fill.invisible = !complete;
        symbols.eachChild((symbol, i) => { symbol.ignore = i === undefined || !present[i]; });
        line.buildPath = complete ? graphic.Polyline.prototype.buildPath : (context, shape) => {
          for (let i = 0; i < present.length; i++) {
            const next = (i + 1) % present.length;
            if (!present[i] || !present[next]) continue;
            const from = shape.points[i]!, to = shape.points[next]!;
            context.moveTo(from[0]!, from[1]!);
            context.lineTo(to[0]!, to[1]!);
          }
        };
        line.dirtyShape();
      });
    });
  });
}
