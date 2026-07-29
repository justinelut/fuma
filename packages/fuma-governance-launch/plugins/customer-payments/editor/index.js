function escape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function paymentBlock(purpose, name, defaultLabel) {
  return {
    id: `fuma.customer-payments.${purpose}`,
    name,
    description: `Host-bound KES ${purpose} payment intent.`,
    category: 'Fuma Payments',
    version: '1.0.0',
    defaults: { label: defaultLabel, amountMinor: 1000, returnPath: '/payment-complete' },
    schema: {
      label: { type: 'text', label: 'Label' },
      amountMinor: { type: 'number', label: 'Amount (minor KES)', min: 100, max: 100000000, step: 100 },
      returnPath: { type: 'text', label: 'Return path' },
    },
    htmlTag: 'button',
    render(props) {
      const label = escape(props.label || defaultLabel)
      const amount = Number.isSafeInteger(props.amountMinor) ? props.amountMinor : 1000
      const returnPath = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/.test(String(props.returnPath || ''))
        ? String(props.returnPath)
        : '/payment-complete'
      return {
        html: `<button type="button" data-fuma-payment-purpose="${purpose}" data-fuma-payment-amount-minor="${amount}" data-fuma-payment-return-path="${escape(returnPath)}">${label} — KES ${(amount / 100).toFixed(2)}</button>`,
      }
    },
  }
}

export default [
  paymentBlock('deposit', 'Deposit', 'Pay deposit'),
  paymentBlock('donation', 'Donation', 'Donate'),
  paymentBlock('checkout', 'Checkout', 'Pay now'),
]
