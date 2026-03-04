export interface ChangeRequest {
  readonly pk: string
  readonly sk: string
  readonly changeId: string
  readonly project: string
  readonly env: string
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly proposedBy: string
  readonly stagingSecretName: string
  readonly diff: DiffEntry[]
  readonly diffCount: number
  readonly reason: string
  readonly comment?: string
  readonly reviewedBy?: string
  readonly reviewedAt?: string
  readonly createdAt: string
  readonly ttl?: number
  /** Secrets Manager VersionId of the real secret at proposal time (for optimistic concurrency) */
  readonly secretVersionId?: string
  /** Secrets Manager VersionId of the real secret before an approval write (for rollback) */
  readonly previousVersionId?: string
  /** Key names of the real secret after approval (avoids reading full secret for history) */
  readonly currentKeys?: string[]
}

export interface DiffEntry {
  readonly type: 'added' | 'removed' | 'modified'
  readonly key: string
}

export interface ProposeRequestBody {
  readonly project: string
  readonly env: string
  readonly stagingSecretName: string
  readonly reason: string
}

export interface ApproveRejectBody {
  readonly comment?: string
}

export interface RollbackBody {
  readonly changeId: string
  readonly reason: string
}
