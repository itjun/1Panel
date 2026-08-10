/**
 * 1Panel 同款 ECharts 按需注册
 * 源：github.com/1Panel-dev/1Panel/frontend/src/utils/echarts.ts
 */
import * as echarts from "echarts/core";
import { LineChart, BarChart, PieChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  PolarComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  PolarComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export default echarts;
