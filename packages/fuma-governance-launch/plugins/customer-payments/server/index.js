const PURPOSES = new Set(['deposit', 'donation', 'checkout'])

export default function register(fuma) {
  fuma.routes.authenticated.post('/checkout', async (request) => {
    const body = await request.json()
    if (!PURPOSES.has(body.purpose) || body.currency !== 'KES' || !Number.isSafeInteger(body.amountMinor) || body.amountMinor < 100 || body.amountMinor > 100000000 || typeof body.idempotencyKey !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(body.idempotencyKey) || typeof body.returnPath !== 'string' || !/^\/[A-Za-z0-9/_-]*$/.test(body.returnPath)) {
      return Response.json({ error: 'invalid-payment-request' }, { status: 400 })
    }
    const result = await fuma.payments.customer.create({
      purpose: body.purpose,
      amountMinor: body.amountMinor,
      currency: 'KES',
      idempotencyKey: body.idempotencyKey,
      returnPath: body.returnPath,
    })
    return Response.json({ checkoutId: result.checkoutId, redirectUrl: result.redirectUrl })
  })

  fuma.routes.authenticated.post('/refund', async (request) => {
    const body = await request.json()
    if (typeof body.ledgerId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(body.ledgerId) || typeof body.reason !== 'string' || body.reason.length < 10 || body.reason.length > 500) {
      return Response.json({ error: 'invalid-refund-request' }, { status: 400 })
    }
    const result = await fuma.payments.customer.refund({ ledgerId: body.ledgerId, reason: body.reason })
    return Response.json({ refundId: result.refundId })
  })
}
