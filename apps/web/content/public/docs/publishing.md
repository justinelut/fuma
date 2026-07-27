---
title: Publishing and clean output
description: Understand previews, drafts and immutable public releases.
slug: publishing
collection: docs
author: Fuma Docs
category: Publishing
publishedAt: 2026-07-26T00:00:00Z
updatedAt: 2026-07-26T00:00:00Z
reviewAt: 2026-10-26T00:00:00Z
draft: false
version: 1.0
redirects: []
components: []
owner: Publishing Engineering
audience: public
---
Publishing creates visitor-facing output from the content and design state you approve. Draft edits do not replace the active release.

## Preview before release

Use preview to inspect responsive layouts, links and content without changing the public site.

## Static by default

Pages that do not need per-visitor data are emitted as semantic HTML and compact CSS. Dynamic behaviour is reserved for features that actually need it.

## Roll forward safely

A later publish creates a new release. The active release remains an explicit choice rather than an in-place mutation.