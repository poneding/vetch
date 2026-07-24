import { spawn } from 'node:child_process'
import net from 'node:net'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 1420
const MAX_PORT_SCAN = 100
const configuredPort = Number(process.env.VITE_PORT)
const startPort =
  Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : DEFAULT_PORT

const isPortAvailable = (port) =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, HOST, () => {
      server.close(() => resolve(true))
    })
  })

const findAvailablePort = async () => {
  for (let offset = 0; offset < MAX_PORT_SCAN; offset += 1) {
    const port = startPort + offset
    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error(
    `No available development port found from ${startPort} to ${startPort + MAX_PORT_SCAN - 1}`
  )
}

const port = await findAvailablePort()
const config = JSON.stringify({
  build: {
    beforeDevCommand: `pnpm dev:vite --host ${HOST} --port ${port}`,
    devUrl: `http://${HOST}:${port}`
  }
})

console.log(`Starting Vetch development server on ${HOST}:${port}`)

const child = spawn(
  'pnpm',
  ['exec', 'tauri', 'dev', '--config', config, ...process.argv.slice(2)],
  {
    env: process.env,
    stdio: 'inherit'
  }
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1)
})
