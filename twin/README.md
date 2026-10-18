# Data Center Design Twin

A localhost app for planning one AI data-center hall. The site, workload, compute, layout, cooling, power and network layers all edit one shared plan, and every edit re-evaluates the whole plan at once. A GPU swap in Compute shows up straight away as rack heat in Cooling, weight on the floor bays, water use, grid headroom on the hottest hours of a typical Dallas year and, in the end, how much compute the hall can run. A design agent (Claude) watches the plan. It flags problems as they appear, explains the cause chain across layers, proposes fixes without applying them, and can operate every part of the app when asked in chat.

Screenshots from the final visual QA pass are in `e2e/screens/final/`.

## Run it

You need Node 20 (npm workspaces; pnpm and bun are not used).

```sh
cd twin
npm install
npm run dev
```

Open http://localhost:5173. `npm run dev` starts the API and WebSocket server on port 4317 and the Vite dev server on 5173, which proxies `/api` and `/ws` to it. Stopping one stops both. The plan, the conversation and generated files are kept in `twin/.data/` (git-ignored), so a restart picks up where you left off.

The design agent calls the Claude API. Put your key in a `.env` file at the repository root (one level above `twin/`):

```
ANTHROPIC_API_KEY=sk-ant-...
```

The file is git-ignored. Never commit it. The server reads it from a fixed path in `apps/server/src/env.ts`, so on another machine change `ENV_PATH` there. Without a key everything except the agent works, and a chat message gets the reply "The agent needs an API key in .env". For a demo without a key, `TWIN_FAKE_AGENT=1 npm run dev` runs the scripted agent the end-to-end tests use.

To run without the server at all, open http://localhost:5173/?local=1. The browser then runs commands and the evaluation itself, and chat is disabled. The app also falls back to this mode when the server is unreachable.

## Demo script

This is the cascade the build is tuned for. `packages/engine/test/demo.test.ts` pins the numbers, and `e2e/demo.spec.ts` drives every step except 6 in a browser.

1. Open the default plan: Dallas, a 10.6 MW grid cap, a 48 × 30 m hall on a raised floor, two rack groups of air-cooled 8-GPU racks with CRAHs, hot-aisle containment and an air-cooled chiller at 18 °C. All checks pass, and the agent is quiet. The placed racks hold 1,280 GPUs and 5,760 PFLOPS.
2. In Compute, switch the Training block (rows 3 to 5) to NVIDIA GB300 NVL72. Rack power goes from 28 kW to 132 kW. Rack heat fails against the 40 kW air limit and two CRAH zones fail. The grid still holds: the worst hour peaks at 10.48 MW against 10.6 MW.
3. The agent posts a red warning, marks rows 3 to 5 with a revision cloud and proposes single-phase direct-to-chip cooling with auto-sized CDUs. The card lists the owner's "Water is scarce" note as respected.
4. Preview the proposal (a ghost overlay of the CDUs and piping), then apply it. The Training block moves to direct-to-chip and heat rejection to dry coolers.
5. The effects ripple out:
   - Three floor bays under the GB300 rows go to 101 % of their 7.3 kN/m² rating, because the racks now carry coolant and manifolds.
   - Dry coolers use no water, so the water check passes.
   - On the hottest hours the dry coolers need trim cooling. The worst hour peaks at 10.71 MW, the plan runs 88 hours a year over the grid cap, and usable compute drops from 19,584 to 19,326 PFLOPS.
   - Ride-through fails because the plan has no buffer tank.
6. In Cooling, raise the facility supply temperature to 32 °C (ASHRAE W32). Coolant then reaches the GB300 racks at 36 °C, within their 45 °C limit. The 88 hours over the cap stay, because the hottest hours run on trim at any setpoint. The Inference block is still air cooled and its CRAHs share the facility loop, so its racks now get 38 °C inlet air against the 32 °C ASHRAE A1 allowable limit. `packages/engine/test/demo.test.ts` evaluates steps 4 and 6 together.
7. Ask the agent in chat to fix the floor. It spreads the racks or raises the floor rating through its tools, the camera follows, and the floor bays pass again. The engine test moves two racks per GB300 row into empty slots further down the row; the scripted agent in the browser test raises the rating. The grid, ride-through and air-inlet problems are left for the next decisions.
8. Ask for a simulation brief. The agent writes the OpenFOAM (`buoyantSimpleFoam`) brief and links it for download.
9. Export the plan as JSON, re-import it, and the evaluation comes back identical.

## Architecture

TypeScript end to end, as npm workspaces under `twin/`.

| Package | What it holds |
|---|---|
| `packages/schema` | Zod schemas and types for the plan, catalog entries, commands, the evaluation, the agent protocol and the server messages. |
| `packages/catalog` | Built-in catalog JSON (GPUs, racks, cooling methods, heat rejection, coolants, equipment, climate presets), `rules.json` with the engine's coefficients, the default plan, and the loader and validator. |
| `packages/commands` | The command registry: each command's schema, how it applies to the plan and its inverse for undo. |
| `packages/engine` | The pure `evaluate(plan, catalogs)`: metrics, checks, cause chains, auto-sizing, the 8,760-hour series, N-1 checks and the what-if diff. The default plan evaluates in about 7 ms. |
| `apps/server` | Fastify server. It holds the plan, dispatches commands, keeps undo and redo, pushes state over a WebSocket, runs the design agent and serves the knowledge base, simulation briefs and import/export. |
| `apps/web` | Vite, React and React Three Fiber: the 3D hall, camera moves, overlays and flow particles, the layer panels, totals and checks, the inspector and the agent thread. |
| `apps/mcp` | A stdio MCP server, `twin-dc`, that proxies the agent's tools to the running server. |

Every state change is a command from the one registry. The UI sends commands, the agent's act tools are generated from the registry (one `cmd_<type>` tool per command), and the MCP server lists the same tools from `GET /api/tools`. A command added to the registry is therefore available in the UI, to the agent and over MCP without further wiring.

## The design agent

The agent runs in the server on `claude-opus-5-5` through `@anthropic-ai/sdk`, with streaming, adaptive thinking and prompt caching. Effort is low for observation turns and high for chat. Its system prompt is in `apps/server/src/agent/prompt/system.ts`.

It has 56 tools:

- Read: `get_plan`, `get_evaluation`, `explain_check`, `get_hourly`, `list_catalog`, `get_catalog_entry`, `get_notes`, `search_knowledge`, `read_knowledge`.
- Act: `undo`, `redo` and one `cmd_` tool per registry command (`cmd_setRackType`, `cmd_moveRack`, `cmd_setCoolingMethod` and so on).
- Propose: `propose_change` and `what_if`.
- View: `set_layer`, `focus`, `set_overlay`, `annotate`, `clear_annotations`.
- Documents: `generate_simulation_brief`, `export_plan`.

After each of your edits the server compares the new evaluation with the previous one. If a check gets worse or the headline moves, it sends the agent an observation (debounced about 1.5 s, so a burst of edits is one turn). The agent stays silent when nothing is worth saying. When something fails, it explains the cause chain, marks the objects with a revision cloud and posts a proposal.

A proposal is a card with the evaluation diff (headline, checks, cost, build time, water) that you can preview, apply or dismiss. The agent never applies its own ideas. When you ask for a change in chat, it makes the change directly with the command tools, and each change shows in the thread and can be undone.

Owners can attach notes with an importance of must, prefer or fyi to any decision, rack group or layer. The agent reads them before it proposes anything, and each proposal lists the notes it respects and the ones it breaks. It does not break a must note without saying so first.

Every number the agent states has to come from a tool result: the engine, the catalog or the knowledge base. The knowledge base is 32 Markdown files with sources in `apps/server/knowledge/`, covering the layers, each cooling and heat-rejection method, the GPU and rack families, coolants, layout patterns, power distribution, network media, cost and lead times, demand problems, liquid-cooling operations and the simulation boundary.

`generate_simulation_brief` writes an OpenFOAM brief. The geometry, heat loads, boundary conditions, flows and temperatures are filled in from the plan by code. The agent adds the narrative: what to simulate first, mesh guidance, which estimates to compare against and what to watch for.

### Cost

The cached prefix (system prompt plus 56 tool schemas) is about 87,000 characters, roughly 25,000 tokens. `get_plan` now returns a compact plan of about 7 KB. It used to return 112 KB with the climate series. At the prices in `apps/server/test/agent-evals.test.ts` ($4 input, $20 output, $5 cache write and $0.20 cache read per million tokens), a chat turn with a few tool calls comes to roughly $0.10 once the cache is warm. The first turn of a conversation, or the first after five idle minutes, also writes the prefix to the cache and comes to about $0.25. Low-effort observation turns cost less. These are estimates from token counts. The last measured run, before `get_plan` was trimmed, averaged $0.36 per turn. Command and `what_if` results now carry the check counts and worst problems after the change, and the system prompt asks the agent not to re-read the plan or the evaluation to confirm a change.

### Spending limits

The server records the `usage` of every Claude API response (input, output, cache write and cache read tokens), prices it at the `claude-opus-5-5` rates above, adds it to the day's total in `.data/usage.json`, and logs each request's tokens and cost at info level. The agent panel shows today's spend against the daily budget and, while a turn runs, its cost so far next to a Stop button. Stop aborts the stream: the text so far stays, a "Stopped" line follows, and the conversation history stays valid.

A turn ends with a plain message, such as "I stopped after 16 tool calls to save your API budget. Say continue to keep going.", when it reaches any per-turn cap. A tool call over the cap is answered as not run. Before each model request the server estimates what it could cost and does not start it if that could take the turn or the day over its limit. The estimate counts the prompt at two characters per token (this agent's JSON measures 2.2), prices the part the previous request already sent within the 5-minute cache lifetime as a cache read and the rest as a cache write, and adds at least 2,000 output tokens. A tool result longer than the size limit is not sent to the model; the agent is told to ask for less. Every later request of a conversation re-sends each result, and one `get_hourly` call at step 1 (164,000 characters, about 77,000 tokens) once made a two-request question cost $0.59. When the day's spend reaches the budget, chat and automatic reviews stop until local midnight, and the thread says how much was spent and how to raise the limit.

Automatic reviews of your edits (observation turns) are paid turns too. They wait at least the minimum gap after the previous one (edits made meanwhile merge into the next review), stop for the hour once the hourly count is reached, and stop when less than the reserve share of the daily budget is left. The "Automatic review" switch in the agent panel turns them off. The setting is kept in `.data/agent-settings.json`.

Each limit can be set in the shell or in the repo-root `.env`; restart the server after changing one.

| Variable | Default | What it limits |
|---|---|---|
| `AGENT_DAILY_BUDGET_USD` | `5` | API spend per local calendar day |
| `AGENT_MAX_REQUESTS_PER_TURN` | `8` | Model requests in one turn |
| `AGENT_MAX_TOOL_CALLS_PER_TURN` | `16` | Tool calls in one turn |
| `AGENT_MAX_TURN_USD` | `0.75` | Spend of one turn |
| `AGENT_REVIEW_MIN_GAP_S` | `120` | Seconds between automatic reviews |
| `AGENT_REVIEWS_PER_HOUR` | `10` | Automatic reviews in any 60 minutes |
| `AGENT_REVIEW_BUDGET_RESERVE` | `0.2` | Share of the daily budget kept for chat; reviews stop below it |
| `AGENT_MAX_TOOL_RESULT_CHARS` | `30000` | Characters of one tool result sent to the model |

## Using the twin from Claude Code (MCP)

Start the app with `npm run dev`, then register the server from `twin/`:

```sh
claude mcp add twin-dc -s project -e TWIN_URL=http://localhost:4317 -- npx tsx apps/mcp/src/main.ts
```

Or copy `.mcp.json.example` to `twin/.mcp.json`. Claude Code then has the same tools as the in-app agent, and changes show up live in the browser. If the app is not running, the tools return an error that says to start it. The server only lists tools when the agent runtime is up, so start it with a key in `.env` or with `TWIN_FAKE_AGENT=1`. An MCP tool call runs in the server and does not call the Claude API. Changes made over MCP are recorded as agent changes, so they do not start observation turns.

## Tests

From `twin/`:

| Command | What it runs |
|---|---|
| `npm test` | Vitest for the packages, the server and MCP, and the web app (jsdom). Includes the golden, demo-cascade and performance tests in `packages/engine/test/`. |
| `npm run typecheck` | `tsc -b` over every workspace. |
| `npm run e2e` | Playwright in Chromium and WebKit: the demo script, an agent turn watched while it runs and stopped, import/export, offline mode and MCP. Each spec starts its own server and Vite on free ports with a throwaway data directory, and uses the scripted agent (`TWIN_FAKE_AGENT_CHUNK_MS` paces its words). Run `npx playwright install chromium webkit` once first. |

The live agent tests call the Claude API and are skipped unless `RUN_LIVE_AGENT=1` is set and the repo-root `.env` exists:

```sh
RUN_LIVE_AGENT=1 npx vitest run apps/server/test/agent-live.test.ts    # about $0.20
RUN_LIVE_AGENT=1 npx vitest run apps/server/test/agent-evals.test.ts   # 7 behavior evals, prints its spend
RUN_LIVE_AGENT=1 npm run e2e -- demo.spec.ts                           # the demo with the real agent, about $1
RUN_LIVE_AGENT=1 npm run e2e -- agent-turn.spec.ts --project=webkit    # one short real turn in WebKit, capped at $0.25
```

The eval run cost $2.50 before `get_plan` was trimmed and should cost less now. Set `AGENT_EVAL_LOG=<file>` to keep the transcripts.

## What is estimated and what is sourced

Every catalog and rules number carries a basis: `vendor`, `oem`, `press`, `textbook`, `estimate` or `user`. Vendor and OEM values need a source URL, and estimates need a note saying how they were estimated. Values the engine computes are labeled `calculated` and list their inputs. The inspector shows the basis of any number you click.

In the built-in catalog and `rules.json` there are 43 vendor, 15 OEM, 25 press and 62 textbook values, and 178 estimates. In `rules.json`, 17 of the 30 engine coefficients are estimates, for example the 6 K CRAH coil approach and the install weeks for raised-floor versus overhead piping. The default plan's tuned inputs (the 10.6 MW grid cap, the 7.3 kN/m² bay rating, equipment position counts) are design choices for the demo, not measurements. The four climate presets are typical-year hourly files (TMYx 2009 to 2023, from NOAA ISD and ERA5), with wet-bulb solved from the ASHRAE psychrometric equations. Custom entries you add get basis `user`.

The engine computes design-stage estimates with textbook algebra: energy balances, simple pressure-drop and floor-load models, and heat rejection hour by hour against the climate year. It does not solve fluid flow. The particles in the 3D view are scaled from computed flows and temperatures and are not a CFD result; the scene carries the label "Illustrative flow, scaled from computed values". Questions only a simulation can answer, such as recirculation, hot spots at row ends or under-floor pressure, go to the simulation brief.
