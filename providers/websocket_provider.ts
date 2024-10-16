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
import { WebSocketServer } from 'ws'
import { moduleImporter } from '@adonisjs/core/container'
import { ServerResponse } from 'node:http'
import type { GetWsControllerHandlers, WsRouteFn } from '../src/types.js'
import { defineConfig } from '../src/define_config.js'
import { Redis } from 'ioredis'
import { cuid } from '@adonisjs/core/helpers'
import { WebSocket } from '../src/websocket.js'

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
      return
    }

    const nodeServer = server.getNodeServer()
    if (!nodeServer) {
      return
    }

    const config = this.app.config.get<ReturnType<typeof defineConfig>>('websocket', {})
    const channels = new Map<string, Map<string, WebSocket>>()

    const publisher = config.redis.enabled ? new Redis(config.redis) : null
    const subscriber = config.redis.enabled ? new Redis(config.redis) : null

    if (subscriber) {
      subscriber.subscribe('websocket::broadcast')
      subscriber.on('message', (c, message) => {
        if (c === 'websocket::broadcast') {
          const { channel, data, options, clientId } = JSON.parse(message)
          const clients = channels.get(channel) || new Map<string, WebSocket>()

          for (const client of clients.values()) {
            if (options && options.ignoreSelf && client.id === clientId) {
              continue
            }

            if (client.readyState === WebSocket.OPEN) {
              client.send(data)
            }
          }
        }
      })
    }

    const wss = new WebSocketServer({
      noServer: true,
      WebSocket,
    })
    // this.app.terminating doesn't work when websocket is used
    process.on('SIGTERM', async () => {
      wss.clients.forEach((client) => client.close(1000, 'Server shutting down'))
      wss.close()
    })
    const wsRouter = new Router(
      this.app,
      await this.app.container.make('encryption'),
      new QsParserFactory().create()
    )

    const globalMiddleware: any[] = config.middleware.map((m) =>
      moduleImporter(m, 'handle').toHandleMethod(this.app.container)
    )

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

      const url = req.url.split('?')[0]
      const wsRoute = wsRouter.match(url, 'GET')

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

        const clientId = cuid()

        wss.handleUpgrade(req, socket, head, async (ws) => {
          if (!channels.has(url)) {
            channels.set(url, new Map())
          }

          ws.id = clientId
          channels.get(url)!.set(clientId, ws as any)

          ws.on('close', () => {
            channels.get(url)!.delete(clientId)
          })

          ws.broadcast = (data: string, options: any) => {
            if (publisher) {
              publisher.publish(
                'websocket::broadcast',
                JSON.stringify({
                  channel: url,
                  data,
                  clientId,
                  options,
                })
              )
            } else {
              const clients = channels.get(url) || new Map<string, WebSocket>()

              for (const client of clients.values()) {
                if (options && options.ignoreSelf && client.id === clientId) {
                  continue
                }

                if (client.readyState === WebSocket.OPEN) {
                  client.send(data)
                }
              }
            }
          }

          try {
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
          } catch (error) {
            ws.close(1000, error.message)
            channels.get(url)!.delete(clientId)
            socket.end()
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
