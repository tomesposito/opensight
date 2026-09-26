import { init, use } from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { SVGRenderer } from 'echarts/renderers';

// Shared registration for the browser and Node SVG smoke tests.
use([BarChart, LineChart, PieChart, AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent, LabelLayout, SVGRenderer]);
export { init };
