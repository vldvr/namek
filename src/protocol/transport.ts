import type { ClientMessage, ServerMessage } from './messages.ts'

/** Канал клиента до сервера комнаты. */
export interface ClientTransport {
  send(msg: ClientMessage): void
  close(): void
  onMessage: ((msg: ServerMessage) => void) | null
  onClose: (() => void) | null
}
