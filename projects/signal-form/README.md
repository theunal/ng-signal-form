# ng-signal-form

[![npm version](https://img.shields.io/npm/v/ng-signal-form.svg)](https://www.npmjs.com/package/ng-signal-form)
[![CI](https://github.com/theunal/ng-signal-form/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/theunal/ng-signal-form/actions/workflows/npm-publish.yml)
[![license](https://img.shields.io/npm/l/ng-signal-form.svg)](https://github.com/theunal/ng-signal-form/blob/main/LICENSE)

Signal-based, type-safe form utilities for Angular (v21+). A thin, fully typed layer
over Angular Signal Forms (`@angular/forms/signals`) — no extra abstraction, just
typed paths, **per-field typed error signals** and the familiar `FormGroup` habits
(`setValue`, `patchValue`, `reset()`, ...) as helpers.

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
import { createForm, required, minLength, email, defineValidator, formErrors } from 'ng-signal-form';

interface FormModel {
  name: string;
  email: string;
  consent: boolean;
}

const customValidator = defineValidator('customValidator', (value: string) =>
  value.length > 2 || 'name çok kısa',
);

const initial: FormModel = { name: '', email: '', consent: false };

// createForm() must run in an injection context (component field or constructor).
const form = createForm(initial, (path) => [
  required(path.name, { message: 'name zorunlu' }),
  minLength(path.name, 2),
  email(path.email),
  customValidator(path.name),
]);

form.name().value.set('Ali');                // FieldState.value is a WritableSignal
form.name.errors.required()?.message;        // 'name zorunlu'
form.name.errors.customValidator()?.message;  // typed
form().valid();                              // root FieldState: value/valid/pending/disabled
formErrors(form);                            // Signal<model-shaped error tree>
```

### Return a rule list from the schema

The schema should **return an array of rules**. That is what makes each field's
`errors` accessor contain only the rules applied to *that* field:

```ts
form.name.errors.required();         // ok
form.name.errors.minLength();        // ok
form.name.errors.customValidator();  // ok
form.name.errors.email();            // compile error: email was added to `email`
form.name.errors.maxDate();          // compile error: never added
```

Kinds are derived from the rules themselves — no enum or interface to maintain —
and removing a rule breaks `errors.<kind>()` at compile time.

> **Do not write the `TModel` generic.** TypeScript cannot infer later type
> arguments from a partial type argument list, so `createForm<FormModel>(initial, (path) => [...])`
> silently falls back to loose, app-wide error types. Either omit the generic or
> annotate the initial value (as above) so both `TModel` and `TRules` are inferred.

### Rules that return nothing

`disabled`, `hidden`, `readonly`, `debounce`, `validate`, `validateAsync`,
`validateTree`, `apply`, `applyEach`, `applyWhen` and `validateFormAsync` return
`void` and cannot go into the array. Mix a block body with a returned list — types
stay exact:

```ts
const form = createForm(initial, (path) => {
  disabled(path.address, { when: () => hasAddress() }); // void — stays in the block
  debounce(path.note, 300);                              // void — stays in the block
  return [                                               // ← typed rule list
    required(path.email),
    matchField(path.confirm, path.password),
  ];
});
```

Your own `void` validator can join the list through `defineRule`:

```ts
const customValidator = defineRule('customValidator', (path: FieldPath<string>) =>
  validate(path, ({ value }) => (value() === 'admin' ? { kind: 'customValidator' } : undefined)),
);
```

## Block schemas (optional)

A block body is more readable, but TypeScript cannot see statements inside a
callback, so which rule belongs to which field is unknowable — `errors` degrades to
app-wide builtins. `errors.email()` would compile on `name` too and just return
`undefined`. Use it only for readability, and declare custom kinds once in the
type-only `CustomErrorKinds` registry:

```ts
// validators.ts
export const customValidator = defineValidator('customValidator', (value: string) =>
  value.length > 2 || 'name çok kısa',
);
export const validators = [customValidator];

// app.d.ts
declare module 'ng-signal-form' {
  interface CustomErrorKinds extends ValidatorKindsOf<typeof validators> {}
}
```

```ts
const form = createForm<FormModel>(initial, (path) => {
  required(path.name, { message: 'name zorunlu' });
  customValidator(path.name);
});

form.name.errors.required()?.message;       // 'name zorunlu'
form.name.errors.customValidator()?.message; // typed via the registry
form.name.errors.any('unknownKind')();       // dynamic escape hatch
```

The kinds registered here are app-wide, not per-field. When you need that
guarantee, return a rule list.

## Beyond validation

Helpers cover validation (`validateForm`, `validateAsyncFn`, `defineValidator`,
`defineRule`), error mapping (`formErrors`, `fieldErrors`, `fieldErrorSignals`,
`errorBag`), state (`formStatus`, `onChange`), lifecycle (`resetForm`,
`patchValue`, `enabledValue`) and imperative disabling (`disableControl`,
`disableWhen`).

Common tree operations are also bound on the root, with the model as a fallback
whenever a field shares a name:

```ts
form.setValue({ name: 'Ada', email: 'ada@example.com', consent: true });
form.patchValue({ name: 'Grace' });
form.reset();          // back to the createForm snapshot, dirty/touched cleared
form.status();         // 'valid' | 'invalid' | 'pending' | 'disabled'
form.markAllTouched();

stateOf(form.name).errorOf('customValidator')()?.message;
```

## Migrating from 0.1.x

`matchFields` and `requiredWhenFields` take the root path as their **first**
argument, which removes the need for an explicit `<Model>` generic and lets
`options.kind` reach the typed error accessor:

```ts
// 0.1.x
matchFields<Profile>('password', 'confirm', { kind: 'credentialsMatch' })(path);

// 0.2.0
matchFields(path, 'password', 'confirm', { kind: 'credentialsMatch' });
```

Both factories now return the rule directly, so they work in a block schema too.

## Links

- [GitHub repository](https://github.com/theunal/ng-signal-form)
- [Issue tracker](https://github.com/theunal/ng-signal-form/issues)
- [License (MIT)](https://github.com/theunal/ng-signal-form/blob/main/LICENSE)
