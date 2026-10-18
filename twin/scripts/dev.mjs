// Runs the server (:4317) and the web app (:5173) together; stopping one stops both.
import { spawn } from 'node:child_process'

const procs = [
  ['server', ['run', 'dev', '-w', '@twin/server']],
  ['web', ['run', 'dev', '-w', '@twin/web']],
].map(([name, args]) => {
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) if (line) out.write(`[${name}] ${line}\n`)
    })
  prefix(child.stdout, process.stdout)
  prefix(child.stderr, process.stderr)
  return child
})

let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  for (const child of procs) child.kill('SIGTERM')
  process.exitCode = code
}

for (const child of procs) child.on('exit', (code) => stop(code ?? 0))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
