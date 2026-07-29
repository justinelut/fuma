export function activate(api) {
  api.cms.routes.authenticated.post('/checkout', async ({ req }) => {
    return await api.payments.customer.create(await req.json())
  })

  api.cms.routes.authenticated.post('/receipt', async ({ req }) => {
    return await api.payments.customer.receipt(await req.json())
  })

  api.cms.routes.authenticated.post('/refund', async ({ req }) => {
    return await api.payments.customer.refund(await req.json())
  })
}
