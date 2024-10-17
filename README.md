# AdonisJS Websocket

```bash
node ace add adonisjs-websocket
```

## Usage

Simple example:

```ts
// start/routes.ts
router.ws('/ws', ({ ws }) => {
  ws.on('message', (message) => {
    ws.send('Received: ' + message.toString())
  })

  ws.on('close', () => {
    console.log('Connection closed')
  })

  ws.send('Hello! Your id is ' + ws.id)
})
```

```bash
npx wscat -c "ws://localhost:3333/ws"
```

Middleware and broadcasting:

```ts
// start/routes.ts
router.ws(
  '/rooms/:roomId',
  ({ ws, params, auth }) => {
    const roomId = params.roomId
    const user = auth.user

    if (user.isBanned) {
      return ws.close()
    }

    ws.on('message', (message) => {
      ws.send('Received: ' + message.toString())
    })

    // broadcast to all clients of the same url path
    // you can enable redis in `config/websocket.ts` to broadcast on all web server instances
    ws.broadcast('Hello everyone!')
  },
  [
    // you can enable them globally in `config/websocket.ts`
    () => import('#middleware/container_bindings_middleware'),
    () => import('@adonisjs/auth/initialize_auth_middleware'),

    middleware.auth(),
  ]
)
```

```bash
npx wscat -c 'ws://localhost:3333/rooms/1' -H 'Authorization: Bearer oat_MjU.Z25o...'
npx wscat -c 'ws://localhost:3333/rooms/2?token=oat_MjU.Z25o...'
npx wscat -c 'ws://localhost:3334/rooms/2?token=oat_MjU.Z25o...'
```

Using controllers:

```ts
// start/routes.ts
const WsChatController = () => import('#controllers/ws_chat_controller')

router.ws('/chat', [WsChatController, 'handle'])
```

```ts
// app/Controllers/Ws/ChatController.ts
import type { WebSocketContext } from 'adonisjs-websocket'

export default class WsChatController {
  public async handle({ ws }: WebSocketContext) {
    ws.on('message', (message) => {
      ws.send('Received: ' + message.toString())
    })

    ws.send('Hello! Your id is ' + ws.id)
  }
}
```

For browsers, it's common practice to send a small message (heartbeat) for every given time passed (e.g every 30sec) to keep the connection active.

```ts
// frontend
const ws = new WebSocket('wss://localhost:3333/ws')

const HEARTBEAT_INTERVAL = 30000
let heartbeatInterval

ws.onopen = () => {
  heartbeatInterval = setInterval(() => {
    ws.send('ping')
  }, HEARTBEAT_INTERVAL)
}

ws.onclose = () => {
  clearInterval(heartbeatInterval)
}
```

```ts
// backend
router.ws('/ws', ({ ws }) => {
  ws.on('message', (message) => {
    if (message.toString() === 'ping') {
      ws.send('pong')
    }
  })
})
```
