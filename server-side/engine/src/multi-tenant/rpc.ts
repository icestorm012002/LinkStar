import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'

// Global RPC dispatcher map
const rpcEvents = new EventEmitter()

export type RpcRequest = {
  id: string
  type: 'RPC_REQUEST'
  target: 'fs' | 'child_process'
  method: string
  args: any[]
}

export type RpcResponse = {
  id: string
  type: 'RPC_RESPONSE'
  success: boolean
  result?: any
  error?: {
    message: string
    code?: string
    stack?: string
  }
}

/**
 * Send an RPC request over the IPC channel to the orchestrator (which forwards it to the WebSocket).
 */
export async function sendRpcRequest(target: 'fs' | 'child_process', method: string, ...args: any[]): Promise<any> {
  const id = randomUUID()
  
  const req: RpcRequest = {
    id,
    type: 'RPC_REQUEST',
    target,
    method,
    args
  }

  // Promise that resolves when we get a matching RPC_RESPONSE
  const responsePromise = new Promise<any>((resolve, reject) => {
    const handler = (res: RpcResponse) => {
      if (res.success) {
        resolve(res.result)
      } else {
        const err = new Error(res.error?.message || 'Unknown RPC Error')
        if (res.error?.code) (err as any).code = res.error.code
        reject(err)
      }
    }
    rpcEvents.once(id, handler)
  })

  // Send to orchestrator via IPC
  if (process.send) {
    process.send(req)
  } else {
    // Fallback if not running in a child process (shouldn't happen in our architecture)
    throw new Error('No IPC channel available to send RPC request.')
  }

  return responsePromise
}

/**
 * Dispatch an incoming RPC response to the waiting Promise.
 */
export function handleRpcResponse(res: RpcResponse) {
  rpcEvents.emit(res.id, res)
}

// Automatically listen for IPC messages from the orchestrator
if (typeof process !== 'undefined' && process.on) {
  process.on('message', (msg: any) => {
    if (msg && msg.type === 'RPC_RESPONSE') {
      handleRpcResponse(msg)
    }
  })
}
