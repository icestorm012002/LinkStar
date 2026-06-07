import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fsPromises from 'fs/promises'
import fs from 'fs'
import path from 'path'
import child_process from 'child_process'
import { applyMonkeyPatches } from './monkey-patch.js'
import * as rpc from './rpc.js'

describe('Monkey Patching', () => {
  const WORKSPACE = path.resolve('/tmp/test-workspace')

  beforeEach(() => {
    // Reset patches
    vi.restoreAllMocks()
    vi.spyOn(rpc, 'sendRpcRequest').mockResolvedValue(true)
  })

  afterEach(() => {
    // It's a bit tricky to un-patch globally, but we can just clear mocks
    vi.clearAllMocks()
  })

  it('should intercept fsPromises.writeFile for workspace files', async () => {
    applyMonkeyPatches(WORKSPACE)
    const targetFile = path.join(WORKSPACE, 'test.txt')
    
    await fsPromises.writeFile(targetFile, 'hello')
    
    expect(rpc.sendRpcRequest).toHaveBeenCalledWith('fs', 'writeFile', targetFile, 'hello')
  })

  it('should not intercept fsPromises.writeFile for outside files', async () => {
    const originalWriteFile = vi.spyOn(fsPromises, 'writeFile').mockResolvedValue()
    
    applyMonkeyPatches(WORKSPACE)
    const outsideFile = path.resolve('/tmp/other/test.txt')
    
    await fsPromises.writeFile(outsideFile, 'hello')
    
    expect(rpc.sendRpcRequest).not.toHaveBeenCalled()
    // It should call the original
  })

  it('should intercept child_process.spawn for workspace cwd', async () => {
    applyMonkeyPatches(WORKSPACE)
    
    const mockChild = child_process.spawn('echo', ['hello'], { cwd: WORKSPACE })
    
    expect(rpc.sendRpcRequest).toHaveBeenCalledWith('child_process', 'spawn', 'echo', ['hello'], expect.objectContaining({ cwd: WORKSPACE }))
    expect(mockChild).toBeDefined()
    expect(mockChild.stdout).toBeDefined()
  })
})
