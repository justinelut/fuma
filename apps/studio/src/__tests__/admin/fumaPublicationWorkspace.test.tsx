import { describe,expect,test } from 'bun:test'
import { fireEvent,render,screen } from '@testing-library/react'
import { PublicationWorkspace } from '../../admin/fuma/publication'
import { PublicationHttpClient } from '../../admin/fuma/publication/client'

const client=new PublicationHttpClient({organizationId:'o',workspaceId:'w',siteId:'s',profileId:'publication'},async()=>new Response('{}',{status:500}))
describe('Publication workspace UI',()=>{
 test('renders a read-only editorial surface without hiding immutable-history affordances',()=>{render(<PublicationWorkspace surface="posts" client={client} canWrite={false} content={[]} authors={[]} tags={[]} templates={[]}/>);expect(screen.getByRole('heading',{name:'Posts'})).toBeTruthy();expect(screen.getByText('Read only')).toBeTruthy();expect(screen.getByText(/immutable revision checkpoints/)).toBeTruthy()})
 test('keeps Studio members conceptually separate from publication readers',()=>{render(<PublicationWorkspace surface="members" client={client} canWrite members={[]} segments={[]}/>);expect(screen.getByText(/separate from Studio staff accounts/)).toBeTruthy()})
 test('labels newsletter preview as the data-only renderer path',()=>{render(<PublicationWorkspace surface="newsletters" client={client} canWrite newsletters={[]} versions={[]}/>);expect(screen.getByText(/FUMA-042 data-only renderer/)).toBeTruthy()})
 test('renders tag authoring under write authority and keeps send controls separately denied',()=>{render(<PublicationWorkspace surface="tags" client={client} canWrite tags={[]}/>);expect(screen.getByRole('button',{name:'Save tag'}).hasAttribute('disabled')).toBe(true);render(<PublicationWorkspace surface="newsletters" client={client} canWrite canSend={false} newsletters={[]} versions={[]} segments={[]}/>);expect(screen.getByRole('button',{name:'Send test with OCI'}).hasAttribute('disabled')).toBe(true)})

 test('shows an editorial empty state and current-author placeholder',()=>{render(<PublicationWorkspace surface="posts" client={client} canWrite content={[]} authors={[]} tags={[]} templates={[]}/>);expect(screen.getByText('No posts yet.')).toBeTruthy();expect(screen.getByRole('option',{name:'Select a current author'})).toBeTruthy()})
 test('enables tag authoring only after required fields are present',()=>{render(<PublicationWorkspace surface="tags" client={client} canWrite tags={[]}/>);fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Kenya'}});fireEvent.change(screen.getByLabelText('Slug'),{target:{value:'kenya'}});expect(screen.getByRole('button',{name:'Save tag'}).hasAttribute('disabled')).toBe(false)})
})
