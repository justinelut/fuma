/**
 * Connected email versus managed relay.
 *
 * These look the same in the product — the customer gets working email on their
 * domain — and are completely different commercially. Conflating them is how a
 * hosting business ends up paying for something it charges nothing for.
 *
 *   **Connected.** The customer's own Google Workspace, Microsoft 365, Zoho, Resend
 *   or SendGrid account. They pay that vendor directly. We write DNS records once and
 *   then bear no cost per message and earn no revenue per message. Metering it would
 *   be inventing a number: there is no cost to recover.
 *
 *   **Managed relay.** Mail sent through our own infrastructure. Every message costs
 *   us — compute to send, egress to deliver, storage if we retain it — so every
 *   message has to be metered and priced with margin.
 *
 * The rule this module exists to enforce: a mode change is an explicit, recorded
 * decision, and metering follows the mode rather than the other way round. If mode
 * were inferred from whether usage happened to be recorded, a metering bug would
 * silently become a pricing decision.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { findProvider, type EmailProvider } from './providerCatalogue'
import type { MeterClass } from '../metering/contracts'

export const DeliveryModeSchema = Type.Union([
  /** The customer's own provider. They pay it; we meter nothing. */
  Type.Literal('connected'),
  /** Our infrastructure. We bear the cost, so we meter and price it. */
  Type.Literal('managed'),
])
export type DeliveryMode = Static<typeof DeliveryModeSchema>

/**
 * The meters a managed relay consumes.
 *
 * Both, not one: a thousand tiny notifications and a thousand large newsletters cost
 * very differently, and per-message alone would under-recover the second while
 * per-byte alone would under-recover the first.
 */
export const MANAGED_RELAY_METERS: readonly MeterClass[] = Object.freeze([
  'email_recipients',
  'email_message_bytes',
])

export const MailConfigurationSchema = Type.Object({
  mode: DeliveryModeSchema,
  /**
   * Which catalogue provider is connected. Null for managed relay, because managed
   * mail is ours and has no external provider.
   */
  providerId: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  /** When the mode was last set, so a switch is auditable. */
  decidedAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
export type MailConfiguration = Readonly<Static<typeof MailConfigurationSchema>>

export type ConfigurationProblem = Readonly<{
  code:
    | 'connected-needs-provider'
    | 'managed-takes-no-provider'
    | 'unknown-provider'
  message: string
}>

/**
 * Validate a configuration before it is stored.
 *
 * Each refusal corresponds to a state that would make metering wrong: a connected
 * mode with no provider has nothing writing its DNS, and a managed mode carrying a
 * provider id invites someone to read that id and conclude the customer pays the
 * vendor.
 */
export function validateConfiguration(
  configuration: MailConfiguration,
): ConfigurationProblem | null {
  if (configuration.mode === 'connected') {
    if (configuration.providerId === null) {
      return {
        code: 'connected-needs-provider',
        message:
          'Connected mail must name the provider it is connected to, or nothing knows '
          + 'which DNS records the domain should carry.',
      }
    }
    if (findProvider(configuration.providerId) === null) {
      return {
        code: 'unknown-provider',
        message: `"${configuration.providerId}" is not in the provider catalogue.`,
      }
    }
    return null
  }

  if (configuration.providerId !== null) {
    return {
      code: 'managed-takes-no-provider',
      message:
        'Managed relay is our own infrastructure and has no external provider. Carrying '
        + `"${configuration.providerId}" would suggest the customer pays that vendor, which `
        + 'is exactly the confusion that leads to unmetered sending.',
    }
  }

  return null
}

/**
 * Whether this configuration should be metered.
 *
 * The single question everything else follows from. Deliberately derived from mode
 * alone: making it depend on anything observable about usage would let a metering
 * outage look like a free tier.
 */
export function isMetered(configuration: MailConfiguration): boolean {
  return configuration.mode === 'managed'
}

/**
 * The meters to record against, empty for connected mail.
 *
 * An empty list is the honest answer rather than zero-valued readings: zero implies
 * we measured and found nothing, when in fact there is nothing of ours to measure.
 */
export function metersFor(configuration: MailConfiguration): readonly MeterClass[] {
  return isMetered(configuration) ? MANAGED_RELAY_METERS : Object.freeze([])
}

export type UsageRecordDecision =
  | Readonly<{ record: true, meters: readonly MeterClass[] }>
  | Readonly<{ record: false, reason: string }>

/**
 * Decide whether to record usage, with the reason when not.
 *
 * The reason matters: "not metered because the customer's own provider sent it" is a
 * correct outcome, while silence would be indistinguishable from a dropped meter.
 */
export function decideUsageRecording(
  configuration: MailConfiguration,
): UsageRecordDecision {
  if (isMetered(configuration)) {
    return Object.freeze({ record: true, meters: MANAGED_RELAY_METERS })
  }
  const provider = configuration.providerId === null
    ? 'an external provider'
    : findProvider(configuration.providerId)?.label ?? configuration.providerId
  return Object.freeze({
    record: false,
    reason:
      `Mail is delivered by ${provider}, which the customer pays directly. We bear no `
      + 'send cost, so there is nothing to meter and nothing to charge.',
  })
}

export type ModeSwitch = Readonly<{
  from: DeliveryMode
  to: DeliveryMode
  /** Whether metering starts, stops, or stays as it was. */
  meteringChange: 'starts' | 'stops' | 'unchanged'
  /** What the operator needs to know before confirming. */
  advice: string
}>

/**
 * Describe a mode switch before it is applied.
 *
 * Both directions carry a consequence worth stating. Moving to managed starts billing
 * for something that was free a moment ago. Moving away stops our revenue *and*
 * hands delivery to a provider whose records may not be in place yet — so the switch
 * should not complete until they are.
 */
export function describeSwitch(from: DeliveryMode, to: DeliveryMode): ModeSwitch {
  if (from === to) {
    return Object.freeze({
      from, to,
      meteringChange: 'unchanged',
      advice: 'No change to delivery or billing.',
    })
  }

  if (to === 'managed') {
    return Object.freeze({
      from, to,
      meteringChange: 'starts',
      advice:
        'Mail will be sent through our infrastructure from now on, and messages become '
        + 'billable. Tell the customer before switching: sending was free to them a '
        + 'moment ago.',
    })
  }

  return Object.freeze({
    from, to,
    meteringChange: 'stops',
    advice:
      'Delivery moves to the customer\'s own provider and we stop metering. Confirm '
      + 'their DNS records resolve first — switching before they do means mail stops '
      + 'rather than moves.',
  })
}

/**
 * Whether a provider can serve as a managed relay substitute.
 *
 * It cannot. A sending-only provider like Resend is still *their* account and *their*
 * bill, so routing our relay traffic through it would mean charging a customer for
 * capacity they are already paying for.
 */
export function canBeManagedRelay(provider: EmailProvider): false {
  void provider
  return false
}

/**
 * Cost exposure of a connected configuration.
 *
 * Always zero, and stated as a function rather than assumed, so a caller adding up
 * infrastructure cost per tenant has something explicit to call and cannot quietly
 * omit connected mail from a total that should include it as zero.
 */
export function connectedSendCostMicros(): 0 {
  return 0
}
