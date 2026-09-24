# ng-signal-form

Signal-based, type-safe form utilities for Angular (v21+).

## Installation

```bash
npm install ng-signal-form
# or
pnpm add ng-signal-form
```

## Usage

```ts
import { SignalForm } from 'ng-signal-form';
```

## Development

```bash
pnpm install
pnpm build        # build library to dist/signal-form
pnpm test         # run unit tests
pnpm pack         # create npm tarball in dist/signal-form
pnpm publish:lib  # build + npm publish
```

## Publishing

1. Update `projects/signal-form/package.json` version.
2. Run `pnpm publish:lib` (requires npm auth via `npm login`).
