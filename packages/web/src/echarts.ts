import { init, use, registerMap } from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, FunnelChart, GaugeChart, TreemapChart, HeatmapChart, BoxplotChart, MapChart } from 'echarts/charts';
import { GeoComponent, VisualMapComponent, BrushComponent, ToolboxComponent, AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { SVGRenderer } from 'echarts/renderers';

import { world, WORLD_MAP } from './geo/world.js';

// Shared registration for the browser and Node SVG smoke tests.
use([BarChart, LineChart, PieChart, ScatterChart, FunnelChart, GaugeChart, TreemapChart, HeatmapChart, BoxplotChart, MapChart, GeoComponent, VisualMapComponent, BrushComponent, ToolboxComponent, AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent, LabelLayout, SVGRenderer]);
registerMap(WORLD_MAP, world as Parameters<typeof registerMap>[1]);
export { init };
