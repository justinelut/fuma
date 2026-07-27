import { runFumaRoleMain } from '../../../../server/fuma/runtime/boot'
import {
  FumaRuntimeLifecycle,
  type FumaRuntimeRole,
} from '../../../../server/fuma/runtime/lifecycle'

function readRole(value: string | undefined): FumaRuntimeRole {
  if (value === 'web' || value === 'worker' || value === 'scheduler') return value
  throw new Error('FUMA_ROLE must select a Fuma runtime role.')
}

const role = readRole(process.env.FUMA_ROLE)
const delayMs = Number(process.env.FUMA_FIXTURE_WORK_MS ?? '120')

async function startFixtureRuntime(): Promise<FumaRuntimeLifecycle> {
  const runtime = new FumaRuntimeLifecycle({
    role,
    drainTimeoutMs: 2_000,
    components: [{
      id: `${role}-fixture`,
      start() {
        return {
          beginDrain() {
            console.error('[fixture] intake-stopped')
          },
          stop() {
            console.error('[fixture] component-stopped')
          },
        }
      },
    }],
  })
  await runtime.start()
  void runtime.run(async () => {
    console.error('[fixture] work-started')
    await Bun.sleep(delayMs)
    console.error('[fixture] work-finished')
  })
  return runtime
}

await runFumaRoleMain(role, startFixtureRuntime)
