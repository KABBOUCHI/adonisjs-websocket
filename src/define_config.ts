import type * as IORedis from 'ioredis'

type WebsocketConfig = {
  middleware: any[]
  redis: {
    enabled: boolean
  } & IORedis.RedisOptions
}

export function defineConfig(config: WebsocketConfig) {
  return config
}
