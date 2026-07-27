export default function register(fuma) {
  fuma.modules.register({
    id: 'fuma/customer-payment',
    label: 'Customer payment',
    category: 'commerce',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['purpose', 'amountMinor', 'label'],
      properties: {
        purpose: { enum: ['deposit', 'donation', 'checkout'] },
        amountMinor: { type: 'integer', minimum: 100, maximum: 100000000 },
        label: { type: 'string', minLength: 1, maxLength: 80 },
      },
    },
    render({ label, amountMinor }) {
      return { tag: 'button', attributes: { type: 'button', 'data-payment-intent': 'secure-runtime' }, children: [`${label} — KES ${(amountMinor / 100).toFixed(2)}`] }
    },
  })
}
