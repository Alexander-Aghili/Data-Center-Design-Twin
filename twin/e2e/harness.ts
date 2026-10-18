import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, type WebSocket as PlaywrightSocket } from '@playwright/test'
import type { ServerMsg } from '@twin/schema'
import { createServer as createViteServer, type ViteDevServer } from 'vite'

/** `twin/`, where the workspaces live. */
export const TWIN_DIR = fileURLToPath(new URL('..', import.meta.url))
const WEB_DIR = join(TWIN_DIR, 'apps/web')
const SERVER_MAIN = join(TWIN_DIR, 'apps/server/src/main.ts')

/** The real Claude API only for `RUN_LIVE_AGENT=1`; everything else talks to the scripted client. */
export const LIVE_AGENT = process.env.RUN_LIVE_AGENT === '1'

/** A port the OS says is free right now, so parallel runs and other dev servers never collide. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('No port'))))
    })
  })
}

async function waitForHealth(url: string, server: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`The server exited with ${server.exitCode}:\n${log()}`)
    try {
      if ((await fetch(`${url}/api/health`)).ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`The server did not answer /api/health within 30 s:\n${log()}`)
}

/**
 * One isolated copy of the app: the real server entry (`apps/server/src/main.ts`) on its own port and data
 * directory, and the Vite dev server for the web app proxying `/api` and `/ws` to it.
 */
export class Twin {
  readonly dataDir = mkdtempSync(join(tmpdir(), 'twin-e2e-'))
  serverPort = 0
  webPort = 0
  private server: ChildProcess | null = null
  private web: ViteDevServer | null = null
  private output = ''

  constructor(private readonly opts: { liveAgent?: boolean } = {}) {}

  get url(): string {
    return `http://127.0.0.1:${this.webPort}/`
  }

  get serverUrl(): string {
    return `http://127.0.0.1:${this.serverPort}`
  }

  async start(): Promise<this> {
    this.serverPort = await freePort()
    this.webPort = await freePort()
    await this.startServer()
    const target = this.serverUrl
    this.web = await createViteServer({
      root: WEB_DIR,
      configFile: join(WEB_DIR, 'vite.config.ts'),
      logLevel: 'warn',
      clearScreen: false,
      server: {
        host: '127.0.0.1',
        port: this.webPort,
        strictPort: true,
        proxy: { '/api': target, '/ws': { target, ws: true } },
      },
    })
    await this.web.listen()
    return this
  }

  /** Starts (or restarts) the server on the same port and data directory. */
  async startServer(): Promise<void> {
    this.output = ''
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(this.serverPort), TWIN_DATA_DIR: this.dataDir }
    if (this.opts.liveAgent) delete env.TWIN_FAKE_AGENT
    else env.TWIN_FAKE_AGENT = '1'
    const server = spawn(process.execPath, ['--import', 'tsx', SERVER_MAIN], { cwd: TWIN_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const keep = (chunk: Buffer) => {
      this.output = (this.output + chunk.toString()).slice(-20_000)
    }
    server.stdout?.on('data', keep)
    server.stderr?.on('data', keep)
    this.server = server
    await waitForHealth(this.serverUrl, server, () => this.output)
  }

  async stopServer(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server || server.exitCode !== null) return
    const exited = new Promise((resolve) => server.once('exit', resolve))
    server.kill('SIGTERM')
    await exited
  }

  async close(): Promise<void> {
    await this.stopServer()
    await this.web?.close()
    rmSync(this.dataDir, { recursive: true, force: true })
  }
}

/** Server messages the page received over `/ws`, collected from the moment the page opens the socket. */
export function recordServerMessages(page: Page): ServerMsg[] {
  const messages: ServerMsg[] = []
  page.on('websocket', (socket: PlaywrightSocket) => {
    if (!socket.url().endsWith('/ws')) return
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') messages.push(JSON.parse(payload) as ServerMsg)
    })
  })
  return messages
}

/** Opens the app and waits until the plan totals are on screen. */
export async function openApp(page: Page, twin: Twin): Promise<void> {
  await page.goto(twin.url)
  await expect(totals(page).getByRole('table')).toBeVisible({ timeout: 30_000 })
}

export const totals = (page: Page) => page.getByRole('region', { name: 'Plan totals' })
export const agent = (page: Page) => page.getByRole('region', { name: 'Design agent' })
export const decisions = (page: Page) => page.getByRole('complementary', { name: 'Layers and decisions' })

/** The value cell of one row of the totals table, e.g. "IT load". */
export const totalsValue = (page: Page, label: string) =>
  totals(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) }).getByRole('cell')

/** Everything the totals panel says: the headline, the key numbers and the checks. */
export const totalsText = async (page: Page) => (await totals(page).innerText()).replace(/\s+/g, ' ').trim()

/** Makes a layer active through the layer list (the button's name starts with the layer's name). */
export async function openLayer(page: Page, name: string): Promise<void> {
  await decisions(page).getByRole('button', { name: new RegExp(`^${name},`) }).click()
  await expect(decisions(page).getByRole('heading', { name: `${name} decisions` })).toBeVisible()
}

/** A titled field group in the decisions column, e.g. a rack group ("Training block") or "Facility plant". */
export const fieldGroup = (page: Page, name: string) => decisions(page).getByRole('region', { name, exact: true })

/** Picks a catalog entry with the one catalog picker of a field group. Picking closes the list, so it clicks rather than checks. */
export async function pickCatalogEntry(page: Page, group: string, option: string | RegExp): Promise<void> {
  const scope = fieldGroup(page, group)
  await scope.getByRole('button', { name: 'Change' }).click()
  await scope.getByRole('radiogroup').getByRole('radio', { name: option }).click()
}
