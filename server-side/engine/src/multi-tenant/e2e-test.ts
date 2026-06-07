import { SessionOrchestrator } from './orchestrator.js'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

async function runE2E() {
  console.log('Starting E2E Test...')
  const dataRoot = join(process.cwd(), '.test-e2e-data')
  
  if (existsSync(dataRoot)) {
    rmSync(dataRoot, { recursive: true, force: true })
  }

  const orchestrator = new SessionOrchestrator({
    dataRoot,
    // We point to the headless server, using bun if available
    serverScript: join(process.cwd(), 'src', 'headless-server.ts'),
  })

  // Listen to engine events (stdout)
  orchestrator.on('session:event', (sessionId, userId, event) => {
    if (event.type === 'engine_event') {
      console.log(`[Engine] ${JSON.stringify(event.data).slice(0, 200)}...`)
    } else if (event.type === 'error') {
      console.log(`[Event ERROR] ${event.message}`)
    } else {
      console.log(`[Event] ${event.type}`)
    }
  })

  // Listen to RPC requests intercepted from the tools
  orchestrator.on('session:rpc_request', (sessionId, userId, msg) => {
    console.log(`\n=== 🚨 INTERCEPTED RPC REQUEST! ===`)
    console.log(`Target: ${msg.target} | Method: ${msg.method}`)
    console.log(`Args: ${JSON.stringify(msg.args)}`)
    console.log(`==================================\n`)

    // Mock an immediate successful response
    const mockResponse = {
      id: msg.id,
      type: 'RPC_RESPONSE',
      success: true,
      result: msg.target === 'child_process' ? { code: 0, stdout: 'mock stdout', stderr: '' } : undefined
    }

    // Send it back to the process
    setTimeout(() => {
      orchestrator.sendRpcResponse(sessionId, mockResponse)
    }, 100)
  })

  orchestrator.on('session:error', (sessionId, userId, err) => {
    console.error('Session Error:', err)
  })
  
  orchestrator.on('session:stderr', (sessionId, userId, err) => {
    console.error('Session STDERR:', err)
  })

  console.log('Spawning session...')
  // The user prompt instructs the AI to write a file and run a command.
  const sessionId = orchestrator.startSession(
    { userId: 'test-user', clientOS: 'linux' },
    'Please write "hello world" to hello.txt, and then run "ls -la" to verify.'
  )

  // Wait 15 seconds then shutdown
  setTimeout(async () => {
    console.log('Shutting down E2E test...')
    await orchestrator.shutdown()
    console.log('Done.')
    process.exit(0)
  }, 15000)
}

runE2E().catch(console.error)
