/**
 * Who is signed in at this till, as an employee id. The till has one person at a time, so a module-level value is
 * enough; the queries read it to record who made a sale, a stock movement or a payment. `null` (nobody, or tools such
 * as the seeder and tests) leaves attribution to its old fallbacks.
 */
let actorId: string | null = null;

export function setActor(id: string | null): void {
  actorId = id;
}

export function currentActorId(): string | null {
  return actorId;
}
