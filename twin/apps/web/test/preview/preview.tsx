/**
 * Screenshot harness: renders the real App with the fixture plan and evaluation, so the shell can be
 * reviewed before the engine lands. Open /test/preview/index.html?local=1 on the Vite dev server.
 */
import '@fontsource-variable/archivo/wdth.css'
import '../../src/theme/tokens.css'
import { createRoot } from 'react-dom/client'
import { App } from '../../src/App'
import { useTwinStore } from '../../src/state/store'
import { demoEvaluation, demoPlan } from '../fixtures/evaluation'

const plan = demoPlan()
const pin = () => useTwinStore.setState({ plan, evaluation: demoEvaluation(plan), connection: 'online', history: { canUndo: true, canRedo: false } })
pin()
// The fixture stands in for the server: keep it when the offline backend reports in.
useTwinStore.subscribe((s) => {
  if (s.connection !== 'online' || s.plan !== plan) pin()
})

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')
createRoot(root).render(<App />)
