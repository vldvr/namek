import type { Team } from '../../../engine/index.ts'
import type { PlayerView, RoomView } from '../../../protocol/index.ts'

export const TEAM_NAME: Record<Team, string> = { amber: 'Янтарные', teal: 'Бирюзовые' }
/** «ход янтарных», «победа бирюзовых». */
export const TEAM_GEN: Record<Team, string> = { amber: 'янтарных', teal: 'бирюзовых' }
export const TEAMS: Team[] = ['amber', 'teal']

export function me(view: RoomView | null, you: string | null): PlayerView | null {
  return view?.players.find((p) => p.id === you) ?? null
}

export function captainOf(view: RoomView, team: Team): PlayerView | undefined {
  return view.players.find((p) => p.team === team && p.captain)
}

export function guessersOf(view: RoomView, team: Team): PlayerView[] {
  return view.players.filter((p) => p.team === team && !p.captain)
}

export function countLabel(n: number): string {
  return n === -1 ? '∞' : String(n)
}
