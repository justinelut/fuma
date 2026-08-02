import {
  CustomerPaymentError,
  sha256,
  type CustomerPaymentRepository,
  type MembershipReminderSink,
  type PaidPublicationAccessProjector,
} from './service'

/** Advances active/grace/expired state and acknowledges reminders only after delivery. */
export class CustomerPaymentLifecycleService {
  readonly #repository: CustomerPaymentRepository
  readonly #reminders: MembershipReminderSink
  readonly #access: PaidPublicationAccessProjector
  readonly #now: () => Date

  constructor(
    repository: CustomerPaymentRepository,
    reminders: MembershipReminderSink,
    access: PaidPublicationAccessProjector,
    now: () => Date = () => new Date(),
  ) {
    this.#repository = repository
    this.#reminders = reminders
    this.#access = access
    this.#now = now
  }

  async run(limit = 100, cursor: string | null = null): Promise<Readonly<{
    processed: number
    nextCursor: string | null
  }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new CustomerPaymentError('invalid', 'Lifecycle batch must contain 1 to 100 memberships.')
    }
    const result = await this.#repository.processLifecycle(this.#now().toISOString(), limit, cursor)
    for (const membership of result.memberships) {
      await this.#access.sync(membership, sha256(membership.providerReference))
    }
    for (const reminder of result.reminders) {
      await this.#reminders.deliver(reminder)
      await this.#repository.acknowledgeReminder(reminder.reminderId, this.#now().toISOString())
    }
    return Object.freeze({ processed: result.processed, nextCursor: result.nextCursor })
  }
}
