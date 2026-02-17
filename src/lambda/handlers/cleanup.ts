import { getChangeById } from './shared/dynamo'
import { listStagingSecrets, deleteStagingSecret } from './shared/secrets'

const MAX_AGE_DAYS = 7

export async function handler(): Promise<void> {
  console.log('Starting staging secret cleanup...')

  const stagingSecrets = await listStagingSecrets()
  const now = new Date()
  let deletedCount = 0

  for (const secret of stagingSecrets) {
    let shouldDelete = false
    let reason = ''

    // Check age
    if (secret.createdAt) {
      const createdAt = new Date(secret.createdAt)
      const ageDays =
        (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)

      if (ageDays > MAX_AGE_DAYS) {
        shouldDelete = true
        reason = `older than ${MAX_AGE_DAYS} days (${ageDays.toFixed(1)} days)`
      }
    }

    // Check if the associated DynamoDB change has been resolved
    if (!shouldDelete && secret.changeId) {
      const change = await getChangeById(secret.changeId)
      if (change && change.status !== 'pending') {
        shouldDelete = true
        reason = `change ${secret.changeId} is ${change.status}`
      }
      if (!change) {
        shouldDelete = true
        reason = `change ${secret.changeId} not found in DynamoDB`
      }
    }

    if (shouldDelete) {
      console.log(`Deleting staging secret ${secret.name}: ${reason}`)
      try {
        await deleteStagingSecret(secret.changeId ?? secret.name)
      } catch (e) {
        console.error(`Failed to delete ${secret.name}:`, e)
      }
      deletedCount++
    }
  }

  console.log(
    `Cleanup complete. Deleted ${deletedCount} of ${stagingSecrets.length} staging secrets.`,
  )
}
