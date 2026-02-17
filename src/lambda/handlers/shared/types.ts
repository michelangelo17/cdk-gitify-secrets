export interface ChangeRequest {
  pk: string
  sk: string
  changeId: string
  project: string
  env: string
  status: 'pending' | 'approved' | 'rejected'
  proposedBy: string
  stagingSecretName: string
  diff: DiffEntry[]
  diffCount: number
  reason: string
  comment?: string
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
  ttl?: number
  /** Secrets Manager VersionId of the real secret at proposal time (for optimistic concurrency) */
  secretVersionId?: string
  /** Secrets Manager VersionId of the real secret before an approval write (for rollback) */
  previousVersionId?: string
  /** Key names of the real secret after approval (avoids reading full secret for history) */
  currentKeys?: string[]
}

export interface DiffEntry {
  type: 'added' | 'removed' | 'modified'
  key: string
}

export interface ProposeRequestBody {
  project: string
  env: string
  stagingSecretName: string
  reason: string
}

export interface ApproveRejectBody {
  comment?: string
}

export interface RollbackBody {
  changeId: string
  reason: string
}

export interface StagingSecretPayload {
  proposed: Record<string, string>
  previous: Record<string, string>
  project: string
  env: string
}
