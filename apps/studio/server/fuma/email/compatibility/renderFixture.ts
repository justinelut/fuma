import { createElement } from 'react'
import { render } from 'react-email'
import SystemNoticeEmail from './emails/systemNotice'

export async function renderSystemNotice() {
  const element = createElement(SystemNoticeEmail)
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ])
  return { html, text }
}
