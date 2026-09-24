# ng-signal-form

[![npm version](https://img.shields.io/npm/v/ng-signal-form.svg)](https://www.npmjs.com/package/ng-signal-form)
[![CI](https://github.com/theunal/ng-signal-form/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/theunal/ng-signal-form/actions/workflows/npm-publish.yml)
[![npm downloads](https://img.shields.io/npm/dm/ng-signal-form.svg)](https://www.npmjs.com/package/ng-signal-form)
[![license](https://img.shields.io/npm/l/ng-signal-form.svg)](./LICENSE)

Signal-based, type-safe form utilities for Angular (v21+). A thin, fully typed layer
over Angular Signal Forms (`@angular/forms/signals`) — no extra abstraction, just
typed paths, per-field error signals and the familiar `FormGroup` habits
(`patchValue`, `reset`, `validate()`, ...) as helpers.

## Installation

```bash
npm install ng-signal-form
# or
pnpm add ng-signal-form
```

Peer dependencies: `@angular/core`, `@angular/common` and `@angular/forms`
`>=21.0.0 <23.0.0`.

## Usage

```ts
import { signal } from '@angular/core';
import { createForm, required, minLength, email, formErrors } from 'ng-signal-form';

// createForm() must run in an injection context (component field or constructor).
const model = signal({ name: '', email: '' });

const userForm = createForm(model, (path) => {
  required(path.name, { message: 'Name is required' });
  minLength(path.name, 2);
  required(path.email);
  email(path.email);
});

userForm.name.errors.required(); // Signal<RequiredValidationError | undefined>
userForm().valid();               // root FieldState: value/valid/pending/disabled
formErrors(userForm);             // Signal<model-shaped error tree>
```

Return a rule list from the schema to get per-field typed errors:

```ts
const userForm = createForm(initial, (path) => [required(path.name), minLength(path.name, 2)]);

userForm.name.errors.required(); // ok
userForm.name.errors.email();    // compile error: rule not applied to `name`
```

Helpers cover validation (`validateForm`, `validateAsyncFn`, `defineValidator`),
error mapping (`formErrors`, `fieldErrors`, `errorBag`), state
(`formStatus`, `onChange`), lifecycle (`resetForm`, `patchValue`, `enabledValue`)
and imperative disabling (`disableControl`, `disableWhen`).

## Development

Requires Node 22+ and pnpm 12 (see `packageManager`).

```bash
pnpm install
pnpm build   # build the library into dist/signal-form
pnpm test    # unit tests (vitest, headless)
pnpm watch   # rebuild on change (development configuration)
```

## Releasing

Publishing is fully automated — no manual `npm publish`:

1. `git tag v0.1.1`
2. `git push origin v0.1.1`
3. [GitHub Actions](.github/workflows/npm-publish.yml) derives the version from the tag,
   builds, runs the unit tests and publishes to npm.

Authentication uses npm **Trusted Publishing (OIDC)**, so the repository holds no npm
token, and every release gets a signed **provenance** statement. If the version already
exists on the registry the publish step is skipped, so re-running a workflow is always safe.

## Links

- [npm package](https://www.npmjs.com/package/ng-signal-form)
- [Issue tracker](https://github.com/theunal/ng-signal-form/issues)
- [License (MIT)](./LICENSE)
