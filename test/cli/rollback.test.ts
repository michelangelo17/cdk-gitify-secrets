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

import { registerRollbackCommand } from '../../src/cli/commands/rollback'

describe('sr rollback', () => {
  let program: Command

  beforeEach(() => {
    jest.clearAllMocks()
    program = new Command()
    program.exitOverride()
    registerRollbackCommand(program)
    mockResolveChangeId.mockResolvedValue('change-1')
  })

  test('shows summary, asks for confirmation, calls rollback API', async () => {
    mockApiRequest
      .mockResolvedValueOnce({
        changeId: 'change-1',
        status: 'approved',
        project: 'api',
        env: 'dev',
        proposedBy: 'alice@co.com',
        reason: 'Add key',
      })
      .mockResolvedValueOnce({ message: 'Rolled back change change-1' })
    mockConfirm.mockResolvedValue(true)

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await program.parseAsync(['node', 'sr', 'rollback', '--id', 'change-1', '-r', 'Wrong values'])
    consoleSpy.mockRestore()

    expect(mockResolveChangeId).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'change-1' }),
      expect.any(Object),
    )
    expect(mockConfirm).toHaveBeenCalled()
    expect(mockApiRequest).toHaveBeenCalledWith(
      'POST',
      '/rollback',
      expect.any(Object),
      { changeId: 'change-1', reason: 'Wrong values' },
    )
  })

  test('supports --latest flag', async () => {
    mockResolveChangeId.mockResolvedValue('resolved-latest-id')
    mockApiRequest
      .mockResolvedValueOnce({
        changeId: 'resolved-latest-id',
        status: 'approved',
        project: 'api',
        env: 'dev',
      })
      .mockResolvedValueOnce({ message: 'Rolled back' })
    mockConfirm.mockResolvedValue(true)

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await program.parseAsync(['node', 'sr', 'rollback', '--latest', '-r', 'Revert'])
    consoleSpy.mockRestore()

    expect(mockResolveChangeId).toHaveBeenCalledWith(
      expect.objectContaining({ latest: true }),
      expect.any(Object),
    )
    expect(mockApiRequest).toHaveBeenCalledWith(
      'POST',
      '/rollback',
      expect.any(Object),
      { changeId: 'resolved-latest-id', reason: 'Revert' },
    )
  })

  test('aborts when user declines confirmation', async () => {
    mockApiRequest.mockResolvedValueOnce({
      changeId: 'change-1',
      status: 'approved',
      project: 'api',
      env: 'dev',
    })
    mockConfirm.mockResolvedValue(false)

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await program.parseAsync(['node', 'sr', 'rollback', '--id', 'change-1', '-r', 'Revert'])
    consoleSpy.mockRestore()

    expect(mockApiRequest).not.toHaveBeenCalledWith(
      'POST',
      '/rollback',
      expect.anything(),
      expect.anything(),
    )
  })

  test('skips confirmation with -y', async () => {
    mockApiRequest
      .mockResolvedValueOnce({
        changeId: 'change-1',
        status: 'approved',
        project: 'api',
        env: 'dev',
      })
      .mockResolvedValueOnce({ message: 'Rolled back' })

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    await program.parseAsync(['node', 'sr', 'rollback', '--id', 'change-1', '-r', 'Revert', '-y'])
    consoleSpy.mockRestore()

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockApiRequest).toHaveBeenCalledWith(
      'POST',
      '/rollback',
      expect.any(Object),
      expect.objectContaining({ changeId: 'change-1' }),
    )
  })

  test('refuses to roll back non-approved change', async () => {
    mockApiRequest.mockResolvedValueOnce({
      changeId: 'change-1',
      status: 'pending',
      project: 'api',
      env: 'dev',
    })

    await expect(
      program.parseAsync(['node', 'sr', 'rollback', '--id', 'change-1', '-r', 'Revert']),
    ).rejects.toThrow('Can only roll back approved changes')

    expect(mockApiRequest).not.toHaveBeenCalledWith(
      'POST',
      '/rollback',
      expect.anything(),
      expect.anything(),
    )
  })
})
