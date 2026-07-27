---
title: Cookies and browser storage notice
slug: cookies
collection: legal
description: Storage used by the Fuma public website and the boundaries around optional measurement.
author: Fuma policy maintainers
category: Storage notice
publishedAt: 2026-07-26T00:00:00Z
updatedAt: 2026-07-27T00:00:00Z
reviewAt: 2026-10-26T00:00:00Z
draft: false
version: 2026-07-26
redirects: []
components: []
owner: Privacy review owner
audience: public
---
The Fuma public website does not issue an application, identity, administration, member, or tenant session cookie. It does not set a parent-domain session cookie.

## Essential operation

Page delivery and bounded submissions may process request headers, a replay token, form age, and short-lived process-memory anti-abuse keys. The contact route does not set a cookie and returns no-store responses.

## Optional measurement

Optional measurement remains off until you choose it. If allowed, the public site stores a versioned preference in session storage for this host. The preference is not a product session and is not made available to product or tenant hosts.

Global Privacy Control or Do Not Track disables the optional path. Blocking optional measurement does not block essential page delivery or the server-side validation of a form request.

## Change your choice

Use the on-page privacy control to choose essential-only behavior or clear this public host’s session storage. A changed policy version requires a fresh compatible choice rather than silently extending an earlier one.

## Approval state

This notice describes repository-backed public-site behavior. Production privacy approval and any provider-specific disclosure remain pending; no analytics, advertising, or consent certification is claimed.
