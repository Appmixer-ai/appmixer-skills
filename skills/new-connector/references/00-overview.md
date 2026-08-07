# Appmixer Development & Component Creation Guidelines

> These instructions are the canonical connector-design rules the
> [appmixer-skills](https://github.com/Appmixer-ai/appmixer-skills) follow. They
> are maintained in `instructions/` at the repo root and synced into each
> skill's `references/` directory (`node scripts/sync-references.mjs`) — edit
> them there, never the copies. Complete example files live in `examples/`.
> For real-world example connectors to learn from, see
> https://github.com/appmixer-ai/appmixer-connectors.

## Overview

Appmixer is a workflow engine with a web user interface that allows end-users to create business processes using a drag-and-drop UI without writing code. This comprehensive guide covers connector development, authentication, component creation, and best practices for both AI assistance and human developers.

## Workspace Structure

Connectors are developed in a local workspace — any directory containing
`src/<vendor>/<connector>/`. The `<vendor>` segment is a namespace: `appmixer`
is only the default, a customer workspace can use its own vendor name(s), and
several vendors can live side by side. Component names mirror the disk layout:
`<vendor>.<connector>.<module>.<Component>` ↔
`src/<vendor>/<connector>/<module>/<Component>/`.

```
src/
├── <vendor>/           # Source code for connectors (default vendor: appmixer)
│   └── <connector>/
└── examples/           # Example components (not for production)
test/
├── utils.js           # Appmixer stub for testing
└── [test files]
```

---
