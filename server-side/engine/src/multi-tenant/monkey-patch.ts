import fs from 'fs'
import fsPromises from 'fs/promises'
import child_process from 'child_process'
import path from 'path'
import { sendRpcRequest } from './rpc.js'

/**
 * Apply monkey-patches to fs and child_process to reroute local tool executions to the remote client.
 * This should be called BEFORE any claude-code core modules are imported.
 * @param remoteCwd The absolute path to the user's workspace on the cloud (shadow workspace)
 */
export function applyMonkeyPatches(cloudWorkspaceDir: string) {
  // Normalize the workspace path so we can do prefix matching reliably
  const workspacePrefix = path.resolve(cloudWorkspaceDir) + path.sep

  // Helper to check if a target path is inside the intercepted workspace
  const isInterceptedPath = (targetPath: fs.PathLike | undefined): boolean => {
    if (!targetPath) return false
    const absolutePath = path.resolve(targetPath.toString())
    // Allow operations on the workspace dir itself, and anything inside it
    return absolutePath === workspacePrefix.slice(0, -1) || absolutePath.startsWith(workspacePrefix)
  }

  // --- Patch fs.writeFileSync ---
  const originalWriteFileSync = fs.writeFileSync
  fs.writeFileSync = function(
    file: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    options?: fs.WriteFileOptions
  ): void {
    if (typeof file === 'string' && isInterceptedPath(file)) {
      // It's a workspace path, route it to the client!
      // This is blocking since writeFileSync is sync, but we are using async RPC.
      // Wait, Node.js sync methods CANNOT easily await async RPCs.
      // If CLAUDE uses writeFileSync, we have a problem.
      throw new Error(`[MonkeyPatch] Synchronous fs.writeFileSync on workspace path is not supported in RPC mode: ${file}`)
    }
    return originalWriteFileSync.apply(this, [file, data, options])
  }

  // --- Patch fs.promises.writeFile ---
  const originalPromisesWriteFile = fsPromises.writeFile
  fsPromises.writeFile = async function(
    file: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView | Iterable<string | NodeJS.ArrayBufferView> | AsyncIterable<string | NodeJS.ArrayBufferView>,
    options?: fs.WriteFileOptions
  ): Promise<void> {
    if (typeof file === 'string' && isInterceptedPath(file)) {
      // Send the write request via RPC
      const content = data.toString() // simplified for text tools
      await sendRpcRequest('fs', 'writeFile', file, content)
      return
    }
    return originalPromisesWriteFile.apply(this, [file, data, options])
  }

  // --- Patch child_process.spawn ---
  // CLAUDE's Shell.ts uses spawn to run commands.
  const originalSpawn = child_process.spawn
  ;(child_process as any).spawn = function(
    command: string,
    args?: readonly string[],
    options?: child_process.SpawnOptions
  ): child_process.ChildProcess {
    const cwd = options?.cwd?.toString()
    if (cwd && isInterceptedPath(cwd)) {
      // Intercept the spawn!
      // Since spawn returns a ChildProcess immediately, we must return a mock ChildProcess
      // and stream the RPC results to it.
      
      const { EventEmitter } = require('events')
      const { PassThrough } = require('stream')
      
      const mockChild = new EventEmitter() as child_process.ChildProcess
      mockChild.stdout = new PassThrough()
      mockChild.stderr = new PassThrough()
      mockChild.stdin = new PassThrough()
      mockChild.pid = 999999
      
      // Fire the RPC asynchronously
      sendRpcRequest('child_process', 'spawn', command, args, options)
        .then(result => {
          // Mock filling the stdout and exiting
          if (result.stdout) mockChild.stdout?.write(result.stdout)
          if (result.stderr) mockChild.stderr?.write(result.stderr)
          mockChild.emit('close', result.code ?? 0)
          mockChild.emit('exit', result.code ?? 0)
        })
        .catch(err => {
          mockChild.stderr?.write(err.message)
          mockChild.emit('error', err)
          mockChild.emit('close', 1)
        })

      return mockChild
    }
    
    return originalSpawn.apply(this, [command, args, options])
  }

  // ... (Further overrides for readFile, stat, readdir, etc. would be added here)
}
