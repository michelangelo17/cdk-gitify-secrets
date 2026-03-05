import { Command } from 'commander'
import { SDK_MOCKS, DEFAULT_TEST_CONFIG } from './_helpers'

jest.mock('@aws-sdk/client-secrets-manager', () => SDK_MOCKS.secretsManager())
jest.mock('@aws-sdk/client-cloudformation', () => SDK_MOCKS.cloudformation())
jest.mock('@aws-sdk/client-cognito-identity-provider', () => SDK_MOCKS.cognito())

const mockApiRequest = jest.fn()
jest.mock('../../src/cli/auth', () => ({
  ...jest.requireActual('../../src/cli/auth'),
  apiRequest: mockApiRequest,
  requireConfig: jest.fn(() => ({ ...DEFAULT_TEST_CONFIG })),
  awsCredentials: jest.fn(() => undefined),
}))

const mockResolveChangeId = jest.fn()
jest.mock('../../src/cli/change-id', () => ({
  resolveChangeId: mockResolveChangeId,
}))

const mockConfirm = jest.fn()
jest.mock('../../src/cli/prompt', () => ({
  confirm: mockConfirm,
  prompt: jest.fn(),
}))

const mockReviewChange = jest.fn()
const mockPrintReview = jest.fn()
jest.mock('../../src/cli/commands/review', () => ({
  reviewChange: mockReviewChange,
  printReview: mockPrintReview,
}))

import { registerApproveCommand } from '../../src/cli/commands/approve'

describe('sr approve', () => {
  let program: Command

  beforeEach(() => {
    jest.clearAllMocks()
    program = new Command()
    program.exitOverride()
    registerApproveCommand(program)
    mockResolveChangeId.mockResolvedValue('change-1')
  })

  test('shows review, asks for confirmation, calls approve API', async () => {
    mockReviewChange.mockResolvedValue({
      changeId: 'change-1',
      status: 'pending',
      project: 'api',
      env: 'dev',
    })
    mockConfirm.mockResolvedValue(true)
    mockApiRequest.mockResolvedValue({ message: 'Change change-1 approved and applied' })

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await program.parseAsync(['node', 'sr', 'approve', '--change-id', 'change-1'])
    consoleSpy.mockRestore()

    expect(mockResolveChangeId).toHaveBeenCalledWith(
      expect.objectContaining({ changeId: 'change-1' }),
      expect.any(Object),
    )
    expect(mockReviewChange).toHaveBeenCalledWith('change-1', expect.any(Object))
    expect(mockPrintReview).toHaveBeenCalled()
    expect(mockConfirm).toHaveBeenCalled()
    expect(mockApiRequest).toHaveBeenCalledWith(
      'POST',
      '/changes/change-1/approve',
      expect.any(Object),
      {},
    )
  })

  test('supports --latest flag', async () => {
    mockResolveChangeId.mockResolvedValue('resolved-latest-id')
    mockReviewChange.mockResolvedValue({
      changeId: 'resolved-latest-id',
      status: 'pending',
      project: 'api',
      env: 'dev',
    })
    mockConfirm.mockResolvedValue(true)
    mockApiRequest.mockResolvedValue({ message: 'Approved' })

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await program.parseAsync(['node', 'sr', 'approve', '--latest'])
    consoleSpy.mockRestore()

    expect(mockResolveChangeId).toHaveBeenCalledWith(
      expect.objectContaining({ latest: true }),
      expect.any(Object),
    )
    expect(mockApiRequest).toHaveBeenCalledWith(
      'POST',
      '/changes/resolved-latest-id/approve',
      expect.any(Object),
      {},
    )
  })

  test('aborts when user declines confirmation', async () => {
    mockReviewChange.mockResolvedValue({
      changeId: 'change-1',
      status: 'pending',
      project: 'api',
      env: 'dev',
    })
    mockConfirm.mockResolvedValue(false)

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await program.parseAsync(['node', 'sr', 'approve', '--change-id', 'change-1'])
    consoleSpy.mockRestore()

    expect(mockApiRequest).not.toHaveBeenCalledWith(
      'POST',
      expect.stringContaining('approve'),
      expect.anything(),
      expect.anything(),
    )
  })

  test('skips review with --skip-review', async () => {
    mockConfirm.mockResolvedValue(true)
    mockApiRequest.mockResolvedValue({ message: 'Approved' })

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await program.parseAsync(['node', 'sr', 'approve', '--change-id', 'change-1', '--skip-review', '-y'])
    consoleSpy.mockRestore()

    expect(mockReviewChange).not.toHaveBeenCalled()
  })

  test('skips confirmation with -y', async () => {
    mockReviewChange.mockResolvedValue({
      changeId: 'change-1',
      status: 'pending',
      project: 'api',
      env: 'dev',
    })
    mockApiRequest.mockResolvedValue({ message: 'Approved' })

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await program.parseAsync(['node', 'sr', 'approve', '--change-id', 'change-1', '-y'])
    consoleSpy.mockRestore()

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockApiRequest).toHaveBeenCalled()
  })

  test('refuses to approve non-pending change', async () => {
    mockReviewChange.mockResolvedValue({
      changeId: 'change-1',
      status: 'approved',
      project: 'api',
      env: 'dev',
    })

    await expect(
      program.parseAsync(['node', 'sr', 'approve', '--change-id', 'change-1']),
    ).rejects.toThrow('Cannot approve')

    expect(mockApiRequest).not.toHaveBeenCalledWith(
      'POST',
      expect.stringContaining('approve'),
      expect.anything(),
      expect.anything(),
    )
  })
})
