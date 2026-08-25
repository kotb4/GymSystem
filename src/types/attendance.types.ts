export type ChartMode = "bars" | "area";

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartDataset {
  mode: ChartMode;
  points: ChartPoint[];
}
