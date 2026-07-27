import { Type, type Static } from '@sinclair/typebox'
import type {
  FumaRuntimeComponent,
  FumaRuntimeContext,
  FumaRuntimeRole,
  FumaRuntimeState,
} from './lifecycle'
import type { FumaRuntimeEventLogger } from './events'

const RuntimeRoleSchema = Type.Union([
  Type.Literal('web'),
  Type.Literal('worker'),
  Type.Literal('scheduler'),
])

const RuntimeStateSchema = Type.Union([
  Type.Literal('starting'),
  Type.Literal('ready'),
  Type.Literal('draining'),
  Type.Literal('stopped'),
  Type.Literal('failed'),
])

export const FumaRuntimeHealthSchema = Type.Object({
  service: Type.Literal('fuma'),
  topology: Type.Literal('pooled'),
  role: RuntimeRoleSchema,
  state: RuntimeStateSchema,
  ownedComponents: Type.Array(Type.String({ minLength: 1 })),
  inFlight: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })

export type FumaRuntimeHealth = Static<typeof FumaRuntimeHealthSchema>

interface RuntimeControlComponentOptions {
  id: string
  role: FumaRuntimeRole
  port: number
  log: FumaRuntimeEventLogger
}

function healthBody(context: FumaRuntimeContext): FumaRuntimeHealth {
  const snapshot = context.snapshot()
  return {
    service: 'fuma',
    topology: 'pooled',
    role: snapshot.role,
    state: snapshot.state,
    ownedComponents: [...snapshot.ownedComponents],
    inFlight: snapshot.inFlight,
  }
}

function jsonResponse(body: FumaRuntimeHealth, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function readinessStatus(state: FumaRuntimeState): number {
  return state === 'ready' ? 200 : 503
}

export function createRuntimeControlComponent(options: RuntimeControlComponentOptions): FumaRuntimeComponent {
  return {
    id: options.id,
    start(context) {
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: options.port,
        fetch(request) {
          const pathname = new URL(request.url).pathname
          const body = healthBody(context)
          if (pathname === '/healthz') return jsonResponse(body)
          if (pathname === '/readyz') return jsonResponse(body, readinessStatus(body.state))
          return Response.json({ error: 'Not found' }, { status: 404 })
        },
        error(error) {
          options.log({ event: 'control-error', role: options.role, message: error.message })
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        },
      })

      options.log({
        event: 'control-listening',
        role: options.role,
        host: server.hostname,
        port: server.port,
      })

      return {
        async stop() {
          await server.stop(false)
        },
      }
    },
  }
}
