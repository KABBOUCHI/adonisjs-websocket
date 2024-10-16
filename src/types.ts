import type { HttpContext } from '@adonisjs/core/http'
import type { Constructor } from '@adonisjs/http-server/types'
import type { WebSocket } from './websocket.js'

export type WebSocketContext = {
  ws: WebSocket
} & Omit<HttpContext, 'response'>

export type WsRouteFn = (ctx: WebSocketContext) => void
export type GetWsControllerHandlers<Controller extends Constructor<any>> = {
  [K in keyof InstanceType<Controller>]: InstanceType<Controller>[K] extends (
    ctx: WebSocketContext,
    ...args: any[]
  ) => any
    ? K
    : never
}[keyof InstanceType<Controller>]
