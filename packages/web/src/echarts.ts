import { init, use, registerMap } from 'echarts/core';
import { SankeyChart, RadarChart, BarChart, LineChart, PieChart, ScatterChart, FunnelChart, GaugeChart, TreemapChart, HeatmapChart, BoxplotChart, MapChart } from 'echarts/charts';
import { GeoComponent, VisualMapComponent, BrushComponent, ToolboxComponent, AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { SVGRenderer } from 'echarts/renderers';

import { installRadarGaps } from './radar-gaps.js';
import { world, WORLD_MAP } from './geo/world.js';

// Shared registration for the browser and Node SVG smoke tests.
use([SankeyChart, RadarChart, BarChart, LineChart, PieChart, ScatterChart, FunnelChart, GaugeChart, TreemapChart, HeatmapChart, BoxplotChart, MapChart, GeoComponent, VisualMapComponent, BrushComponent, ToolboxComponent, AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent, LabelLayout, SVGRenderer]);
installRadarGaps();
registerMap(WORLD_MAP, world as Parameters<typeof registerMap>[1]);
export { init };
