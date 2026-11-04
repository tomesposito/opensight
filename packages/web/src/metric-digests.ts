export interface MetricSubscriptionInput { cadence?: 'weekly' | 'daily'; timeColumn: string; dimensions: string[]; destination?: { kind: 'self' } | { kind: 'shared'; recipientIds: string[] } }
export interface MetricSubscription extends Omit<MetricSubscriptionInput, 'destination'> { id: string; metricId: string; subscriberId: string; cadence: 'weekly' | 'daily'; nextRun: string | null; stopped: boolean; destination: { kind: 'self' } | { kind: 'shared'; recipients: string[] } }
export interface MetricDigestPreview {
  emptyIntersection?: boolean; withheldDimensions?: string[];
  current: number | null; previous: number | null; change: number | null; percentChange: number | null;
  periods: { current: { start: string; end: string }; previous: { start: string; end: string } };
  drivers: { dimension: string; value: string | number | null; current: number | null; previous: number | null; change: number | null }[];
}
