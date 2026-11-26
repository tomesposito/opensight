import { QuickSightClient, ListAnalysesCommand, ListDashboardsCommand, ListDataSetsCommand, DescribeAnalysisDefinitionCommand,
  DescribeDashboardDefinitionCommand, DescribeDataSetCommand, DescribeDataSourceCommand } from '@aws-sdk/client-quicksight';
import type { QuickSightReader } from './index.js';
export type ExtractionCommand = ListAnalysesCommand | ListDashboardsCommand | ListDataSetsCommand | DescribeAnalysisDefinitionCommand
  | DescribeDashboardDefinitionCommand | DescribeDataSetCommand | DescribeDataSourceCommand;
export interface CommandSender { send(command: ExtractionCommand): Promise<unknown> }
/** Deliberately no credentials option: use the customer's standard SDK chain. */
export function awsReader(accountId: string, region: string, sender?: CommandSender): QuickSightReader & { close(): void } {
  const client = sender ? undefined : new QuickSightClient({ region, maxAttempts: 3 });
  const send = (command: ExtractionCommand): Promise<unknown> => {
    if (sender) return sender.send(command);
    if (command instanceof ListAnalysesCommand) return client!.send(command);
    if (command instanceof ListDashboardsCommand) return client!.send(command);
    if (command instanceof ListDataSetsCommand) return client!.send(command);
    if (command instanceof DescribeAnalysisDefinitionCommand) return client!.send(command);
    if (command instanceof DescribeDashboardDefinitionCommand) return client!.send(command);
    if (command instanceof DescribeDataSetCommand) return client!.send(command);
    return client!.send(command);
  };
  return {
    list(kind, nextToken) {
      const input = { AwsAccountId: accountId, MaxResults: 100, ...(nextToken === undefined ? {} : { NextToken: nextToken }) };
      return send(kind === 'analysis' ? new ListAnalysesCommand(input) : kind === 'dashboard' ? new ListDashboardsCommand(input) : new ListDataSetsCommand(input));
    },
    describe(kind, id) {
      const input = { AwsAccountId: accountId };
      switch (kind) {
        case 'analysis': return send(new DescribeAnalysisDefinitionCommand({ ...input, AnalysisId: id }));
        case 'dashboard': return send(new DescribeDashboardDefinitionCommand({ ...input, DashboardId: id }));
        // QuickSight has no DescribeDataSetDefinition API: DescribeDataSet
        // returns the definition, including physical/logical table maps.
        case 'dataset': return send(new DescribeDataSetCommand({ ...input, DataSetId: id }));
        case 'datasource': return send(new DescribeDataSourceCommand({ ...input, DataSourceId: id }));
      }
    },
    close() { client?.destroy(); },
  };
}
