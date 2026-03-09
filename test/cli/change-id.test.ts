import { DEFAULT_TEST_CONFIG } from './_helpers'

const mockApiRequest = jest.fn()
jest.mock('../../src/cli/auth', () => ({
  apiRequest: mockApiRequest,
}))

import { shortId, resolveChangeId } from '../../src/cli/change-id'

const FULL_UUID_1 = 'bcf9fcc5-4145-4e89-be04-a7db386c0efa'
const FULL_UUID_2 = 'bcf9fcc5-9999-4e89-be04-111111111111'
const FULL_UUID_3 = '64fa4711-cf69-4abc-9012-abcdef123456'

const makeChange = (changeId: string, extra: Record<string, unknown> = {}) => ({
  changeId,
  project: 'my-app',
  env: 'production',
  status: 'pending',
  ...extra,
})

describe('shortId', () => {
  test('returns first 8 characters of a UUID', () => {
    expect(shortId(FULL_UUID_1)).toBe('bcf9fcc5')
  })

  test('handles strings shorter than 8 chars', () => {
    expect(shortId('abc')).toBe('abc')
  })
})

describe('resolveChangeId', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('passes through a full UUID without any API call', async () => {
    const result = await resolveChangeId(
      { id: FULL_UUID_1 },
      DEFAULT_TEST_CONFIG,
    )
    expect(result).toBe(FULL_UUID_1)
    expect(mockApiRequest).not.toHaveBeenCalled()
  })

  test('resolves a short prefix to the full ID', async () => {
    mockApiRequest.mockResolvedValue({
      changes: [makeChange(FULL_UUID_1), makeChange(FULL_UUID_3)],
    })

    const result = await resolveChangeId(
      { id: '64fa' },
      DEFAULT_TEST_CONFIG,
    )
    expect(result).toBe(FULL_UUID_3)
    expect(mockApiRequest).toHaveBeenCalledWith('GET', '/changes', DEFAULT_TEST_CONFIG)
  })

  test('throws for an ambiguous prefix', async () => {
    mockApiRequest.mockResolvedValue({
      changes: [makeChange(FULL_UUID_1), makeChange(FULL_UUID_2)],
    })

    await expect(
      resolveChangeId({ id: 'bcf9fcc5' }, DEFAULT_TEST_CONFIG),
    ).rejects.toThrow('Ambiguous ID "bcf9fcc5" matches 2 changes')
  })

  test('throws when no change matches the prefix', async () => {
    mockApiRequest.mockResolvedValue({ changes: [makeChange(FULL_UUID_1)] })

    await expect(
      resolveChangeId({ id: 'aaaa' }, DEFAULT_TEST_CONFIG),
    ).rejects.toThrow('No change found matching "aaaa"')
  })

  test('resolves --latest to the most recent pending change', async () => {
    mockApiRequest.mockResolvedValue({
      changes: [makeChange(FULL_UUID_1)],
    })

    const result = await resolveChangeId(
      { latest: true },
      DEFAULT_TEST_CONFIG,
    )
    expect(result).toBe(FULL_UUID_1)
    expect(mockApiRequest).toHaveBeenCalledWith(
      'GET',
      '/changes?status=pending&limit=1',
      DEFAULT_TEST_CONFIG,
    )
  })

  test('throws when --latest finds no pending changes', async () => {
    mockApiRequest.mockResolvedValue({ changes: [] })

    await expect(
      resolveChangeId({ latest: true }, DEFAULT_TEST_CONFIG),
    ).rejects.toThrow('No pending changes found')
  })

  test('--latest with latestStatus queries the given status', async () => {
    mockApiRequest.mockResolvedValue({
      changes: [makeChange(FULL_UUID_1, { status: 'approved' })],
    })

    const result = await resolveChangeId(
      { latest: true, latestStatus: 'approved' },
      DEFAULT_TEST_CONFIG,
    )
    expect(result).toBe(FULL_UUID_1)
    expect(mockApiRequest).toHaveBeenCalledWith(
      'GET',
      '/changes?status=approved&limit=1',
      DEFAULT_TEST_CONFIG,
    )
  })

  test('--latest with latestStatus throws with correct status name', async () => {
    mockApiRequest.mockResolvedValue({ changes: [] })

    await expect(
      resolveChangeId({ latest: true, latestStatus: 'approved' }, DEFAULT_TEST_CONFIG),
    ).rejects.toThrow('No approved changes found')
  })

  test('throws when both --id and --latest are provided', async () => {
    await expect(
      resolveChangeId(
        { id: FULL_UUID_1, latest: true },
        DEFAULT_TEST_CONFIG,
      ),
    ).rejects.toThrow('Cannot use both --id and --latest')
  })

  test('throws when neither --id nor --latest is provided', async () => {
    await expect(
      resolveChangeId({}, DEFAULT_TEST_CONFIG),
    ).rejects.toThrow('Specify --id <id> or --latest')
  })

  test('ambiguous error includes project/env context', async () => {
    mockApiRequest.mockResolvedValue({
      changes: [
        makeChange(FULL_UUID_1, { project: 'app-a', env: 'prod' }),
        makeChange(FULL_UUID_2, { project: 'app-b', env: 'staging' }),
      ],
    })

    await expect(
      resolveChangeId({ id: 'bcf9' }, DEFAULT_TEST_CONFIG),
    ).rejects.toThrow('app-a/prod')
  })
})
