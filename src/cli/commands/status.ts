import { Command } from 'commander';
import { requireConfig, apiRequest } from '../auth';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Check pending changes or inspect a specific change')
    .option('--change-id <id>', 'Specific change ID to inspect')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region']);

      if (opts.changeId) {
        const data = await apiRequest(
          'GET',
          `/changes/${opts.changeId}/diff`,
          config,
        );

        if (data.error) {
          console.error(data.error);
          return;
        }

        console.log(`Change: ${data.changeId}`);
        console.log(`Status: ${data.status}`);
        console.log(`Project: ${data.project}/${data.env}`);
        console.log(`By: ${data.proposedBy}`);
        console.log(`Reason: ${data.reason}`);

        const diff = data.diff as Array<{ type: string; key: string }>;
        if (diff && diff.length > 0) {
          console.log('\nChanges:');
          for (const d of diff) {
            const sym =
              { added: '+', removed: '-', modified: '~' }[d.type] ?? '?';
            console.log(`  ${sym} ${d.key}`);
          }
        }
      } else {
        const data = await apiRequest('GET', '/changes?status=pending', config);
        const changes = data.changes as Array<Record<string, unknown>>;

        if (!changes || changes.length === 0) {
          console.log('No pending changes');
          return;
        }

        console.log(`${changes.length} pending change(s):\n`);
        for (const c of changes) {
          const cid = String(c.changeId ?? '').substring(0, 12);
          console.log(
            `  ${cid}  ${c.project}/${c.env}  ${String(c.reason ?? '').substring(0, 40)}`,
          );
        }
      }
    });
}
