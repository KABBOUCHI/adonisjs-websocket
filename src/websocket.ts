import { WebSocket as WebSocketBase } from 'ws'

export class WebSocket extends WebSocketBase {
  declare id: string
  declare broadcast: (data: string, options?: { ignoreSelf?: boolean }) => void
}
