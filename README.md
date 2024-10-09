# AdonisJS Websocket

```bash
node ace add adonisjs-websocket
```

## Usage

```ts
// start/routes.ts
router.ws('/ws', ({ ws }) => {
  ws.on('message', (message) => {
    ws.send('Received: ' + message.toString())
  })
})
```

```bash
npx wscat -c "ws://localhost:3333/ws"
```

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
  },
  [
    () => import('#middleware/container_bindings_middleware'),
    () => import('@adonisjs/auth/initialize_auth_middleware'),
    middleware.auth(),
  ]
)
```

```bash
npx wscat -c 'ws://localhost:3333/rooms/1' -H 'Authorization: Bearer oat_MjU.Z25o...'
```
