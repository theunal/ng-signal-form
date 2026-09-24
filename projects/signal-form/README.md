# ng-signal-form

[![npm version](https://img.shields.io/npm/v/ng-signal-form.svg)](https://www.npmjs.com/package/ng-signal-form)
[![CI](https://github.com/theunal/ng-signal-form/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/theunal/ng-signal-form/actions/workflows/npm-publish.yml)
[![license](https://img.shields.io/npm/l/ng-signal-form.svg)](https://github.com/theunal/ng-signal-form/blob/main/LICENSE)

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

## Links

- [GitHub repository](https://github.com/theunal/ng-signal-form)
- [Issue tracker](https://github.com/theunal/ng-signal-form/issues)
- [License (MIT)](https://github.com/theunal/ng-signal-form/blob/main/LICENSE)
