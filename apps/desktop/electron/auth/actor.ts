import { sessionState } from './context';

/**
 * Who is signed in, as an employee id, on the connection the current call belongs to (the till's window, or a paired
 * phone: see `context.ts`). The queries read it to record who made a sale, a stock movement or a payment. `null`
 * (nobody, or tools such as the seeder and tests) leaves attribution to its old fallbacks.
 */
export function setActor(id: string | null): void {
  sessionState().actorId = id;
}

export function currentActorId(): string | null {
  return sessionState().actorId;
}
