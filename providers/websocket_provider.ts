import type { ApplicationService } from '@adonisjs/core/types'
import {
  Constructor,
  OneOrMore,
  MiddlewareFn,
  ParsedNamedMiddleware,
} from '@adonisjs/http-server/types'
import { Router } from '@adonisjs/http-server'
import { LazyImport } from '@adonisjs/http-server/types'
import { QsParserFactory } from '@adonisjs/http-server/factories'
import { WebSocketServer, WebSocket } from 'ws'
import type { HttpContext } from '@adonisjs/core/http'
import { moduleImporter } from '@adonisjs/core/container'
import { ServerResponse } from 'node:http'

export type WebSocketContext = { ws: WebSocket } & Omit<HttpContext, 'response'>

type WsRouteFn = (ctx: WebSocketContext) => void
type GetWsControllerHandlers<Controller extends Constructor<any>> = {
  [K in keyof InstanceType<Controller>]: InstanceType<Controller>[K] extends (
    ctx: WebSocketContext,
    ...args: any[]
  ) => any
    ? K
    : never
}[keyof InstanceType<Controller>]

declare module '@adonisjs/core/http' {
  interface Router {
    ws<T extends Constructor<any>>(
      pattern: string,
      handler: string | WsRouteFn | [LazyImport<T> | T, GetWsControllerHandlers<T>?],
      middleware?: OneOrMore<MiddlewareFn | ParsedNamedMiddleware>
    ): void
  }
}

const routes = new Map<
  string,
  {
    pattern: string
    handler: any
    middleware?: OneOrMore<MiddlewareFn | ParsedNamedMiddleware>
  }
>()

export default class WebsocketProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * Register bindings to the container
   */
  register() {}

  /**
   * The container bindings have booted
   */
  async boot() {
    const router = await this.app.container.make('router')

    router.ws = (pattern, handler, middleware = []) => {
      routes.set(pattern, {
        pattern,
        handler,
        // middleware,
        // @ts-ignore
        middleware: (Array.isArray(middleware) ? middleware : [middleware]).map((one: any) =>
          one.handle
            ? {
                ...one,
                handle: (ctx: any, next: any, args?: any) =>
                  one.handle(ctx.containerResolver, ctx, next, args),
              }
            : moduleImporter(one, 'handle').toHandleMethod(this.app.container)
        ),
      })
    }
  }

  /**
   * The application has been booted
   */
  async start() {}

  /**
   * The process has been started
   */
  async ready() {
    const server = await this.app.container.make('server')
    if (!server) {
      console.log('no server')
      return
    }

    const nodeServer = server.getNodeServer()
    if (!nodeServer) {
      console.log('no node server')
      return
    }

    const wss = new WebSocketServer({ noServer: true })
    const wsRouter = new Router(
      this.app,
      await this.app.container.make('encryption'),
      new QsParserFactory().create()
    )

    const globalMiddleware: any[] = [
      // moduleImporter(
      //   () => import('#middleware/container_bindings_middleware'),
      //   'handle'
      // ).toHandleMethod(this.app.container),
      // moduleImporter(
      //   () => import('@adonisjs/auth/initialize_auth_middleware'),
      //   'handle'
      // ).toHandleMethod(this.app.container),
    ]

    for (const route of routes.values()) {
      wsRouter
        .any(route.pattern, route.handler)
        .middleware(globalMiddleware as any)
        .middleware(route.middleware as any)
    }

    wsRouter.commit()

    nodeServer.on('upgrade', async (req, socket, head) => {
      if (!req.url) {
        return socket.end()
      }

      const wsRoute = wsRouter.match(req.url, 'GET')

      if (!wsRoute) {
        return socket.end()
      }

      try {
        const containerResolver = this.app.container.createResolver()

        const serverResponse = new ServerResponse(req)
        const request = server.createRequest(req, serverResponse)
        const response = server.createResponse(req, serverResponse)
        const ctx = server.createHttpContext(request, response, containerResolver)
        ctx.params = wsRoute.params

        await wsRoute.route.middleware.runner().run((handler: any, next) => {
          return handler.handle(ctx, next, handler.args)
        })

        wss.handleUpgrade(req, socket, head, async (ws) => {
          if (typeof wsRoute.route.handler === 'function') {
            await wsRoute.route.handler({
              ...ctx,
              ws,
            } as any)
          } else {
            await wsRoute.route.handler.handle(ctx.containerResolver, {
              ...ctx,
              ws,
            } as any)
          }
        })
      } catch (error) {
        console.error(error)
        socket.end()
      }
    })
  }

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {}
}
