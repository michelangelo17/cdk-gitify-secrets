import { Command } from 'commander';
import { requireConfig, apiRequest } from '../auth';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('View change history for a project/environment')
    .requiredOption('-p, --project <project>', 'Project name')
    .requiredOption('-e, --env <env>', 'Environment name')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region']);

      const data = await apiRequest(
        'GET',
        `/history/${opts.project}/${opts.env}`,
        config,
      );

      const history = data.history as Array<Record<string, unknown>>;
      if (!history || history.length === 0) {
        console.log(`No history for ${opts.project}/${opts.env}`);
        return;
      }

      console.log(`History for ${opts.project}/${opts.env}\n`);
      console.log(
        `  ${'ID'.padEnd(14)} ${'Status'.padEnd(10)} ${'By'.padEnd(25)} Reason`,
      );
      console.log(
        `  ${'─'.repeat(14)} ${'─'.repeat(10)} ${'─'.repeat(25)} ${'─'.repeat(30)}`,
      );

      for (const h of history) {
        const cid = String(h.changeId ?? '?').substring(0, 12);
        const status = String(h.status ?? '?');
        const by = String(h.proposedBy ?? '?').substring(0, 24);
        const reason = String(h.reason ?? '').substring(0, 40);
        console.log(
          `  ${cid.padEnd(14)} ${status.padEnd(10)} ${by.padEnd(25)} ${reason}`,
        );
      }
    });
}
