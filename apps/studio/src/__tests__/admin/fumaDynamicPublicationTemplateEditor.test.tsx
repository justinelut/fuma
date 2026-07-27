import { describe, expect, test } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DynamicPublicationTemplateEditor } from '../../admin/fuma/publication/DynamicPublicationTemplateEditor'
import type { DynamicPublicationTemplate } from '../../core/fuma/publication/dynamicPublication'
import type { DynamicPublicationTemplateClientPort } from '../../admin/fuma/publication/dynamicPublicationClient'

function client(saved: DynamicPublicationTemplate[]): DynamicPublicationTemplateClientPort {
  return {
    templates: async () => [],
    saveTemplate: async (template) => { saved.push(template); return template },
    preview: async () => { throw new Error('not used') },
  }
}

describe('Dynamic Publication template editor', () => {
  test('labels route, selector, empty-state, and typed binding controls', () => {
    render(<DynamicPublicationTemplateEditor client={client([])} canWrite templates={[]} id={() => 'stable-id'} />)
    expect(screen.getByRole('heading', { name: 'Dynamic templates' })).toBeTruthy()
    expect(screen.getByLabelText('Route type')).toBeTruthy()
    expect(screen.getByLabelText(/Specific target ID/)).toBeTruthy()
    expect(screen.getByLabelText('Empty state')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Template bindings' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'item.title' })).toBeTruthy()
  })
  test('keeps read-only authority visible and disables mutations', () => {
    render(<DynamicPublicationTemplateEditor client={client([])} canWrite={false} templates={[]} />)
    expect(screen.getByText('Read only')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save shared template' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'New template' }).hasAttribute('disabled')).toBe(true)
  })
  test('saves stable data-only blocks and reports the shared template version', async () => {
    const saved: DynamicPublicationTemplate[] = []
    render(<DynamicPublicationTemplateEditor client={client(saved)} canWrite templates={[]} now={() => new Date('2040-01-01T00:00:00.000Z')} id={() => 'stable-template'} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Author archive' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bound block' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save shared template' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({ templateId: 'stable-template', name: 'Author archive', target: { kind: 'author', targetId: null }, version: 1 })
    expect(saved[0]?.document.blocks).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toContain('version 1')
  })
})
