---
title: Public website privacy notice
description: What the Fuma public website collects, why it is used, and which production details remain pending approval.
slug: privacy
collection: legal
author: Fuma policy maintainers
category: Privacy notice
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
This notice covers the Fuma public website. It does not describe a signed customer contract, a production provider arrangement, or every product, member, tenant, payment, or administration workflow.

## Information you choose to send

A contact form asks for a name, reply email, message, request type, consent-notice version, and random replay token. Security, privacy, abuse, and expert inquiry forms add only their routing category or the public expert identifier. Do not send passwords, secret keys, identity documents, payment details, health information, or other sensitive records.

The browser sends the form to a same-origin server route. That route size-limits and validates the body, rejects unexpected fields and unsafe control characters, and then attempts a server-to-server handoff. An accepted response means accepted for routing; it does not prove delivery or promise a response.

## Anti-abuse processing

The public Web process uses a hidden empty field, form age, a replay token, and a short rate window. It hashes the reply address together with limited request-address input and a process-only random salt before keeping a rate key. It keeps accepted replay fingerprints for no more than 24 hours in process memory and does not place the contact body in that replay store. These process-local controls are defence in depth, not a distributed abuse service.

## Measurement and browser storage

Essential page delivery does not require an application, administration, member, or tenant session cookie. Optional public-site measurement remains off until you choose it. The choice is versioned in storage for this public host. Global Privacy Control or Do Not Track suppresses the optional path.

## Retention and production approval

The public Web boundary has the short process-memory periods described above. Any central contact retention, deletion schedule, legal hold, delivery provider, and production owner require separate authority and approval; this notice does not invent them. Production launch remains blocked until those details and this notice are reviewed.

## Requests and changes

Use the Privacy request page to ask about access, correction, deletion, or this notice. A separate identity-verification process may be needed. Submission does not confirm eligibility, completion, or a deadline. The policy history page records the current version and will identify superseded public versions when any exist.
