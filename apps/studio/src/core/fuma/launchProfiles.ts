import type { CapabilityDefinition, ProductProfile } from './contracts'
import { createFumaRegistry } from './registry'

export const LAUNCH_CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: 'site.home',
    navigation: [{ id: 'nav.home', order: 10, label: 'Dashboard', path: '/admin' }],
    permissions: [{
      id: 'site.home.read',
      label: 'View home',
      description: 'View the site home and status surface.',
    }],
    routes: [{ id: 'route.home', method: 'GET', path: '/admin', permission: 'site.home.read' }],
  },
  {
    id: 'content.pages',
    onboarding: [{
      id: 'onboarding.pages',
      order: 30,
      title: 'Create a page',
      description: 'Create the first reusable page in this site.',
    }],
    starterTemplates: [{ id: 'starter.pages', order: 30, label: 'Pages', templateId: 'pages.blank' }],
    permissions: [
      { id: 'content.pages.read', label: 'View pages', description: 'View site pages.' },
      { id: 'content.pages.write', label: 'Edit pages', description: 'Create and edit site pages.' },
    ],
    routes: [
      { id: 'route.pages.list', method: 'GET', path: '/admin/pages', permission: 'content.pages.read' },
      { id: 'route.pages.write', method: 'POST', path: '/admin/pages', permission: 'content.pages.write' },
    ],
    jobs: [{ id: 'job.website-publish', handlerId: 'website.publish', permission: 'content.pages.write' }],
    transfer: [{ id: 'transfer.pages', stepId: 'transfer.content.pages', permission: 'content.pages.write' }],
  },
  {
    id: 'website.content',
    permissions: [{ id: 'website.content.read', label: 'View content', description: 'View structured website content.' }],
    routes: [{ id: 'route.content', method: 'GET', path: '/admin/content', permission: 'website.content.read' }],
  },
  {
    id: 'website.data',
    permissions: [{ id: 'website.data.read', label: 'View data', description: 'View structured site data.' }],
    routes: [{ id: 'route.data', method: 'GET', path: '/admin/data', permission: 'website.data.read' }],
  },
  {
    id: 'site.collections',
    permissions: [
      {
        id: 'site.collections.read',
        label: 'View collections',
        description: 'View site-owned structured collection schemas.',
      },
      {
        id: 'site.collections.write',
        label: 'Change collection schemas',
        description: 'Create collections and add fields through reviewed owner-confirmed operations.',
      },
    ],
  },
  {
    id: 'website.media',
    onboarding: [{
      id: 'onboarding.media',
      order: 40,
      title: 'Add media',
      description: 'Upload reusable images and documents.',
    }],
    permissions: [{ id: 'website.media.read', label: 'View media', description: 'View site media.' }],
    routes: [{ id: 'route.media', method: 'GET', path: '/admin/media', permission: 'website.media.read' }],
  },
  {
    id: 'website.analytics',
    navigation: [{ id: 'nav.website-analytics', order: 60, label: 'Analytics', path: '/admin/analytics', permission: 'website.analytics.read' }],
    permissions: [{ id: 'website.analytics.read', label: 'View analytics', description: 'View website activity summaries.' }],
    routes: [{ id: 'route.website-analytics', method: 'GET', path: '/admin/analytics', permission: 'website.analytics.read' }],
  },
  {
    id: 'website.design',
    navigation: [{
      id: 'nav.builder',
      order: 15,
      // Site design is Instatic's. Selecting this hands the whole viewport to
      // it, the way a Ghost publication opens its theme editor.
      label: 'Design',
      path: '/admin/builder',
      permission: 'website.design.read',
    }],
    onboarding: [{
      id: 'onboarding.design',
      order: 20,
      title: 'Choose a design',
      description: 'Start from a clean visual design preset.',
    }],
    starterTemplates: [{ id: 'starter.website', order: 20, label: 'Website', templateId: 'website.blank' }],
    permissions: [
      { id: 'website.design.read', label: 'View design', description: 'View the visual design workspace.' },
      { id: 'website.design.write', label: 'Edit design', description: 'Edit templates, styles, and layouts.' },
    ],
    routes: [{ id: 'route.builder', method: 'GET', path: '/admin/builder', permission: 'website.design.read' }],
    transfer: [{ id: 'transfer.design', stepId: 'transfer.design.assets', permission: 'website.design.write' }],
  },
  {
    id: 'ai.chat',
    permissions: [{
      id: 'ai.chat',
      label: 'Use Site AI',
      description: 'Use approved AI models and read-only tools for this site.',
    }],
  },
  {
    id: 'ai.tools.write',
    dependsOn: ['ai.chat'],
    permissions: [{
      id: 'ai.tools.write',
      label: 'Let Site AI edit',
      description: 'Allow reviewed Site AI tools to change this site under receipt authority.',
    }],
  },
  {
    id: 'site.settings',
    navigation: [
      { id: 'nav.domains', order: 85, label: 'Domains', path: '/admin/settings/domains', permission: 'site.settings.read' },
      { id: 'nav.team', order: 86, label: 'Organization & team', path: '/admin/settings/team', permission: 'site.settings.read' },
      { id: 'nav.settings', order: 90, label: 'Settings', path: '/admin/settings', permission: 'site.settings.read' },
    ],
    onboarding: [{
      id: 'onboarding.identity',
      order: 10,
      title: 'Name the site',
      description: 'Set the site identity and basic settings.',
    }],
    permissions: [
      { id: 'site.settings.read', label: 'View settings', description: 'View site settings.' },
      { id: 'site.settings.write', label: 'Edit settings', description: 'Edit site settings.' },
    ],
    routes: [
      { id: 'route.domains', method: 'GET', path: '/admin/settings/domains', permission: 'site.settings.read' },
      { id: 'route.organization-management', method: 'GET', path: '/admin/settings/team', permission: 'site.settings.read' },
      { id: 'route.settings', method: 'GET', path: '/admin/settings', permission: 'site.settings.read' },
    ],
    jobs: [
      { id: 'job.cloudflare-reconcile', handlerId: 'fuma.cloudflare-reconcile', permission: 'site.settings.write' },
      { id: 'job.registrar-purchase', handlerId: 'fuma.registrar-purchase', permission: 'site.settings.write' },
      { id: 'job.registrar-renew', handlerId: 'fuma.registrar-renew', permission: 'site.settings.write' },
      { id: 'job.domain-transfer', handlerId: 'fuma.domain-transfer', permission: 'site.settings.write' },
      { id: 'job.transfer-execute', handlerId: 'transfer.execute', permission: 'site.settings.write' },
      { id: 'job.transfer-resume', handlerId: 'transfer.resume', permission: 'site.settings.write' },
      { id: 'job.transfer-compensate', handlerId: 'transfer.compensate', permission: 'site.settings.write' },
    ],
    transfer: [
      { id: 'transfer.settings', stepId: 'transfer.site.settings', permission: 'site.settings.write' },
      { id: 'transfer.ai-byok', stepId: 'ai-credit-byok-rekey-detach', permission: 'site.settings.write' },
      { id: 'transfer.mcp', stepId: 'mcp-connector-rescope-revoke', permission: 'site.settings.write' },
      { id: 'transfer.domain-outcome', stepId: 'domain-outcome', permission: 'site.settings.write' },
    ],
  },
  {
    id: 'publication.editorial',
    dependsOn: ['content.pages'],
    navigation: [{ id: 'nav.posts', order: 20, label: 'Posts', path: '/admin/posts', permission: 'publication.posts.read' }],
    onboarding: [{
      id: 'onboarding.publication',
      order: 20,
      title: 'Create the first post',
      description: 'Start the publication with an editorial post.',
    }],
    starterTemplates: [{ id: 'starter.publication', order: 10, label: 'Publication', templateId: 'publication.editorial' }],
    permissions: [
      { id: 'publication.posts.read', label: 'View posts', description: 'View publication posts.' },
      { id: 'publication.posts.write', label: 'Edit posts', description: 'Create and edit publication posts.' },
      { id: 'publication.workflow.read', label: 'View editorial workflow', description: 'View assignments, reviews, workflow history, and notifications.' },
      { id: 'publication.workflow.assign', label: 'Assign editorial work', description: 'Manage editorial roles and content assignees.' },
      { id: 'publication.workflow.review', label: 'Request editorial review', description: 'Submit current revisions and request changes.' },
      { id: 'publication.workflow.approve', label: 'Approve editorial work', description: 'Approve or reject a current revision.' },
    ],
    routes: [
      { id: 'route.posts.list', method: 'GET', path: '/admin/posts', permission: 'publication.posts.read' },
      { id: 'route.posts.write', method: 'POST', path: '/admin/posts', permission: 'publication.posts.write' },
    ],
    jobs: [
      { id: 'job.publication-revision-retention', handlerId: 'publication.revision-retention', permission: 'publication.posts.write' },
      { id: 'job.publication-revision-gc', handlerId: 'publication.revision-gc', permission: 'publication.posts.write' },
    ],
    transfer: [{ id: 'transfer.posts', stepId: 'transfer.publication.posts', permission: 'publication.posts.write' }],
  },
  {
    id: 'publication.editorial.schedule',
    dependsOn: ['publication.editorial'],
    permissions: [{
      id: 'publication.posts.schedule',
      label: 'Schedule posts',
      description: 'Schedule publication posts for release.',
    }],
    jobs: [{
      id: 'job.publication-publish-due',
      handlerId: 'publication.publish-due',
      permission: 'publication.posts.schedule',
    }],
  },
  {
    id: 'publication.tags',
    dependsOn: ['publication.editorial'],
    navigation: [{ id: 'nav.tags', order: 40, label: 'Tags', path: '/admin/tags', permission: 'publication.tags.read' }],
    permissions: [
      { id: 'publication.tags.read', label: 'View tags', description: 'View and organize publication tags.' },
      { id: 'publication.tags.write', label: 'Edit tags', description: 'Create and edit publication tags.' },
    ],
    routes: [
      { id: 'route.tags', method: 'GET', path: '/admin/tags', permission: 'publication.tags.read' },
      { id: 'route.tags.write', method: 'POST', path: '/admin/tags', permission: 'publication.tags.write' },
    ],
  },
  {
    id: 'publication.members',
    navigation: [{ id: 'nav.members', order: 50, label: 'Members', path: '/admin/members', permission: 'publication.members.read' }],
    onboarding: [{
      id: 'onboarding.members',
      order: 40,
      title: 'Configure members',
      description: 'Choose how readers join the publication.',
    }],
    permissions: [
      { id: 'publication.members.read', label: 'View members', description: 'View publication member records.' },
      { id: 'publication.members.write', label: 'Edit members', description: 'Create members, segments, and access grants.' },
    ],
    routes: [
      { id: 'route.members', method: 'GET', path: '/admin/members', permission: 'publication.members.read' },
      { id: 'route.members.write', method: 'POST', path: '/admin/members', permission: 'publication.members.write' },
    ],
    transfer: [
      { id: 'transfer.members', stepId: 'transfer.publication.members', permission: 'publication.members.read' },
      { id: 'transfer.customer-merchant-credentials', stepId: 'customer-merchant-credentials', permission: 'publication.members.write' },
    ],
  },
  {
    id: 'publication.newsletters',
    dependsOn: ['publication.members'],
    navigation: [{ id: 'nav.newsletters', order: 60, label: 'Newsletters', path: '/admin/newsletters', permission: 'publication.newsletters.read' }],
    onboarding: [{
      id: 'onboarding.newsletters',
      order: 50,
      title: 'Configure a newsletter',
      description: 'Set the publication newsletter identity.',
    }],
    starterTemplates: [{ id: 'starter.newsletter', order: 20, label: 'Newsletter', templateId: 'publication.newsletter' }],
    permissions: [
      { id: 'publication.newsletters.read', label: 'View newsletters', description: 'View newsletter drafts and settings.' },
      { id: 'publication.newsletters.write', label: 'Edit newsletters', description: 'Create newsletters and immutable send versions.' },
    ],
    routes: [
      { id: 'route.newsletters', method: 'GET', path: '/admin/newsletters', permission: 'publication.newsletters.read' },
      { id: 'route.newsletters.write', method: 'POST', path: '/admin/newsletters', permission: 'publication.newsletters.write' },
    ],
    transfer: [{ id: 'transfer.newsletters', stepId: 'transfer.publication.newsletters', permission: 'publication.newsletters.read' }],
  },
  {
    id: 'publication.newsletters.send',
    dependsOn: ['publication.newsletters'],
    permissions: [{ id: 'publication.newsletters.send', label: 'Send newsletters', description: 'Schedule and send publication newsletters.' }],
    jobs: [{
      id: 'job.publication-newsletter-send',
      handlerId: 'publication.newsletter-send',
      permission: 'publication.newsletters.send',
    }],
  },
  {
    id: 'publication.analytics',
    dependsOn: ['publication.editorial'],
    navigation: [{ id: 'nav.publication-analytics', order: 70, label: 'Analytics', path: '/admin/publication-analytics', permission: 'publication.analytics.read' }],
    permissions: [{ id: 'publication.analytics.read', label: 'View publication analytics', description: 'View publication readership summaries.' }],
    routes: [{ id: 'route.publication-analytics', method: 'GET', path: '/admin/publication-analytics', permission: 'publication.analytics.read' }],
    jobs: [{ id: 'job.publication-analytics-retention', handlerId: 'publication.analytics-retention', permission: 'publication.analytics.read' }],
  },
]

export const LAUNCH_PROFILES: readonly ProductProfile[] = [
  {
    id: 'website',
    label: 'Website',
    capabilityPreset: [
      'site.home',
      'website.content',
      'content.pages',
      'website.data',
      'site.collections',
      'website.media',
      'website.analytics',
      'website.design',
      'ai.chat',
      'ai.tools.write',
      'site.settings',
    ],
    navigationPreset: [
      'nav.home',
      'nav.builder',
      'nav.website-analytics',
      'nav.domains',
      'nav.team',
      'nav.settings',
    ],
    onboardingPreset: ['onboarding.identity', 'onboarding.design', 'onboarding.pages', 'onboarding.media'],
    starterTemplatePreset: ['starter.website', 'starter.pages'],
  },
  {
    id: 'publication',
    label: 'Publication',
    subtitle: 'Blog, magazine, newsletter, or newsroom',
    capabilityPreset: [
      'site.home',
      'publication.editorial',
      'site.collections',
      'publication.editorial.schedule',
      'publication.tags',
      'publication.members',
      'publication.newsletters',
      'publication.newsletters.send',
      'publication.analytics',
      'website.design',
      'ai.chat',
      'ai.tools.write',
      'site.settings',
    ],
    navigationPreset: [
      'nav.home',
      'nav.builder',
      'nav.posts',
      'nav.tags',
      'nav.members',
      'nav.newsletters',
      'nav.publication-analytics',
      'nav.domains',
      'nav.team',
      'nav.settings',
    ],
    navigationSections: [{
      id: 'navigation.editor',
      label: 'Editor',
      defaultCollapsed: true,
      navigationIds: ['nav.builder'],
    }],
    onboardingPreset: [
      'onboarding.identity',
      'onboarding.publication',
      'onboarding.pages',
      'onboarding.members',
      'onboarding.newsletters',
      'onboarding.design',
    ],
    starterTemplatePreset: ['starter.publication', 'starter.newsletter', 'starter.pages', 'starter.website'],
  },
]

export const fumaLaunchRegistry = createFumaRegistry({
  capabilities: LAUNCH_CAPABILITIES,
  profiles: LAUNCH_PROFILES,
})
