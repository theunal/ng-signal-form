import { TestBed } from '@angular/core/testing';
import { Injector, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import {
  applyEach,
  bagToErrors,
  createForm,
  disabled,
  email,
  errorBag,
  fieldErrorBag,
  fieldErrorSignals,
  fieldErrors,
  formErrorBag,
  formErrors,
  formStatus,
  formStatusSignal,
  matchField,
  matchFields,
  minLength,
  patchValue,
  required,
  requiredTrue,
  requiredWhen,
  requiredWhenFields,
  validateAsyncFn,
  validateForm,
  validateFormAsync,
  markAllDirty,
  markAllPristine,
  markAllTouched,
  markAllUntouched,
  resetForm,
  enabledValue,
  onChange,
  disableControl,
  disableWhen,
  touchAll,
  type FormSchema,
  SchemaPath,
  validate,
  defineValidator,
} from './signal.form';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function withForm<T>(fn: () => T): T {
  return TestBed.runInInjectionContext(fn);
}

//  function customValidator(path: SchemaPath<string>, options?: { message?: string }) {
//   validate(path, ({ value }) =>
//     value() === 'admin'
//       ? { kind: 'customValidator', message: options?.message ?? 'Bu isim kullanılamaz' }
//       : undefined,
//   );
// }

// const customValidator = defineValidator(
//   'customValidator',
//   (value: string) => value !== 'admin' || 'Bu isim kullanılamaz',
//   { message: 'Bu isim kullanılamaz' } // Varsayılan mesaj (isteğe bağlı)
// );

describe('signal-form sync validation', () => {
  it('exposes typed field errors via error bags', () => {
    const form = withForm(() =>
      createForm<{ name: string; email: string; consent: boolean }>(
        { name: '', email: '', consent: false },
        (path) => {
          required(path.name);
          minLength(path.name, 2);
          required(path.email);
          email(path.email);
          requiredTrue(path.consent);
          // customValidator(path.name);
        },
      ),
    );

    // form.name.errors.ö

    form.name().value.set('A');
    expect(fieldErrorBag(form.name())['required']).toBeUndefined();
    expect(errorBag(form.name().errors())['minLength']).toBeTruthy();
    expect(errorBag(form.email().errors())['required']).toBeTruthy();
    expect(errorBag(form.consent().errors())['requiredTrue']).toBeTruthy();
    expect(form().valid()).toBe(false);

    form.name().value.set('Ali');
    form.email().value.set('ali@example.com');
    form.consent().value.set(true);

    expect(fieldErrorBag(form.name())).toEqual({});
    expect(fieldErrorBag(form.email())).toEqual({});
    expect(fieldErrorBag(form.consent())).toEqual({});
    expect(form().valid()).toBe(true);
  });

  it('supports matchField for password confirmation', () => {
    const form = withForm(() =>
      createForm<{ password: string; confirm: string }>(
        { password: '', confirm: '' },
        (path) => {
          required(path.password);
          required(path.confirm);
          matchField(path.confirm, path.password, { message: 'The values do not match' });
        },
      ),
    );

    form.password().value.set('123456');
    form.confirm().value.set('654321');

    expect(errorBag(form.confirm().errors())['match']).toBe('The values do not match');
    expect(form().valid()).toBe(false);

    form.confirm().value.set('123456');
    expect(errorBag(form.confirm().errors())['match']).toBeUndefined();
    expect(form().valid()).toBe(true);
  });

  it('supports matchFields as a form-level schema', () => {
    const schema: FormSchema<{ password: string; confirm: string }> = (path) => {
      required(path.password);
      required(path.confirm);
      matchFields<{ password: string; confirm: string }>('password', 'confirm', {
        message: 'The values do not match',
      })(path);
    };

    const form = withForm(() =>
      createForm({ password: '', confirm: '' }, schema),
    );

    form.password().value.set('123456');
    form.confirm().value.set('654321');

    expect(formErrorBag(form)['match']).toBe('The values do not match');
    expect(form().valid()).toBe(false);

    form.confirm().value.set('123456');
    expect(formErrorBag(form)['match']).toBeUndefined();
    expect(form().valid()).toBe(true);
  });

  it('supports requiredWhen for conditional required', () => {
    const form = withForm(() =>
      createForm<{ hasCompany: boolean; companyName: string }>(
        { hasCompany: false, companyName: '' },
        (path) => {
          requiredWhen(path.companyName, path.hasCompany, {
            kind: 'companyRequired',
            message: 'Company name is required',
          });
        },
      ),
    );

    expect(errorBag(form.companyName().errors())['companyRequired']).toBeUndefined();

    form.hasCompany().value.set(true);
    expect(errorBag(form.companyName().errors())['companyRequired']).toBe('Company name is required');
    expect(form().valid()).toBe(false);

    form.companyName().value.set('Acme');
    expect(errorBag(form.companyName().errors())['companyRequired']).toBeUndefined();
    expect(form().valid()).toBe(true);
  });

  it('supports requiredWhenFields as a form-level schema', () => {
    const schema: FormSchema<{ hasCompany: boolean; companyName: string }> = (path) => {
      requiredWhenFields<{ hasCompany: boolean; companyName: string }>(
        'hasCompany',
        'companyName',
        { message: 'Company name is required' },
      )(path);
    };

    const form = withForm(() =>
      createForm({ hasCompany: false, companyName: '' }, schema),
    );

    expect(formErrorBag(form)['requiredWhen']).toBeUndefined();

    form.hasCompany().value.set(true);
    expect(formErrorBag(form)['requiredWhen']).toBe('Company name is required');
    expect(form().valid()).toBe(false);

    form.companyName().value.set('Acme');
    expect(formErrorBag(form)['requiredWhen']).toBeUndefined();
    expect(form().valid()).toBe(true);
  });
});

describe('signal-form value helpers', () => {
  it('supports patchValue', () => {
    const form = withForm(() =>
      createForm<{ first: string; last: string }>({ first: '', last: '' }),
    );

    patchValue(form, { first: 'Zeynep' });

    expect(form.first().value()).toBe('Zeynep');
    expect(form.last().value()).toBe('');
    expect(form().value()).toEqual({ first: 'Zeynep', last: '' });
  });

  it('drops disabled branches from enabledValue', () => {
    const gate = signal(false);
    const form = withForm(() =>
      createForm<{ a: string; b: string }>(
        { a: '', b: '' },
        (path) => {
          required(path.a);
          required(path.b);
          disableWhen(path.a, () => gate());
        },
      ),
    );

    expect(form.a().disabled()).toBe(false);
    expect(enabledValue(form)).toEqual({ a: '', b: '' });

    gate.set(true);
    expect(form.a().disabled()).toBe(true);
    expect(enabledValue(form)).toEqual({ b: '' });
    expect(form().value()).toEqual({ a: '', b: '' });
  });

  it('computes form status with disabled > pending > valid/invalid', () => {
    const disabled = signal(false);
    const form = withForm(() =>
      createForm<{ a: string }>(
        { a: '' },
        (path) => {
          required(path.a);
        },
        { disabled },
      ),
    );

    expect(formStatus(form)).toBe('invalid');
    expect(formStatusSignal(form)()).toBe('invalid');

    form.a().value.set('ok');
    expect(formStatus(form)).toBe('valid');

    disabled.set(true);
    expect(formStatus(form)).toBe('disabled');
    expect(formStatusSignal(form)()).toBe('disabled');
  });
});

describe('signal-form dirty/touched helpers', () => {
  it('marks all fields touched via markAllTouched / touchAll', () => {
    const form = withForm(() =>
      createForm<{ a: string; b: string }>({ a: '', b: '' }),
    );

    expect(form().touched()).toBe(false);
    expect(form.a().touched()).toBe(false);

    markAllTouched(form);

    expect(form().touched()).toBe(true);
    expect(form.a().touched()).toBe(true);
    expect(form.b().touched()).toBe(true);

    form.a().value.set('x');
    markAllUntouched(form);
    expect(form.a().touched()).toBe(false);
    expect(form().touched()).toBe(false);

    touchAll(form);
    expect(form().touched()).toBe(true);
  });

  it('marks dirty/pristine across fields', () => {
    const form = withForm(() =>
      createForm<{ a: string; b: string }>({ a: '', b: '' }),
    );

    form.a().controlValue.set('x');
    expect(form.a().dirty()).toBe(true);
    expect(form.b().dirty()).toBe(false);
    expect(form().dirty()).toBe(true);

    markAllPristine(form);
    expect(form.a().dirty()).toBe(false);
    expect(form().dirty()).toBe(false);

    markAllDirty(form);
    expect(form.a().dirty()).toBe(true);
    expect(form.b().dirty()).toBe(true);
  });

  it('reset clears touched and dirty but keeps values', () => {
    const form = withForm(() =>
      createForm<{ a: string }>({ a: 'start' }, (path) => required(path.a)),
    );

    form.a().controlValue.set('changed');
    markAllTouched(form);
    expect(form.a().dirty()).toBe(true);
    expect(form.a().touched()).toBe(true);

    form().reset();

    expect(form.a().value()).toBe('changed');
    expect(form.a().dirty()).toBe(false);
    expect(form.a().touched()).toBe(false);
  });
});

describe('signal-form resetForm', () => {
  it('restores value to the createForm snapshot and clears dirty/touched', () => {
    const form = withForm(() =>
      createForm<{ a: string; b: string }>(
        { a: 'start', b: '' },
        (path) => required(path.a),
      ),
    );

    form.a().controlValue.set('changed');
    markAllTouched(form);
    expect(form.a().dirty()).toBe(true);
    expect(form.a().touched()).toBe(true);
    expect(form().dirty()).toBe(true);

    resetForm(form);

    expect(form().value()).toEqual({ a: 'start', b: '' });
    expect(form.a().value()).toBe('start');
    expect(form.a().dirty()).toBe(false);
    expect(form.a().touched()).toBe(false);
    expect(form().dirty()).toBe(false);
    expect(form().touched()).toBe(false);
  });

  it('restores disable gates to their initial state', () => {
    const gate = disableControl(true);

    const form = withForm(() =>
      createForm<{ a: string }>({ a: '' }, (path) => {
        required(path.a);
        disableWhen(path.a, gate);
      }),
    );

    expect(form.a().disabled()).toBe(true);

    gate.enable();
    expect(form.a().disabled()).toBe(false);

    resetForm(form, { disableGates: [gate] });

    expect(gate()).toBe(true);
    expect(form.a().disabled()).toBe(true);
    expect(form().dirty()).toBe(false);
    expect(form().touched()).toBe(false);
  });

  it('supports an explicit value override', () => {
    const form = withForm(() => createForm<{ a: string }>({ a: 'start' }));

    form.a().controlValue.set('changed');
    resetForm(form, { value: { a: 'custom' } });

    expect(form.a().value()).toBe('custom');
    expect(form.a().dirty()).toBe(false);
  });
});

describe('signal-form disable helpers', () => {
  it('disableControl toggles reactive disabled state', () => {
    const ctrl = disableControl(false);
    expect(ctrl()).toBe(false);

    ctrl.disable();
    expect(ctrl()).toBe(true);

    ctrl.enable();
    expect(ctrl()).toBe(false);

    ctrl.setDisabled(true);
    expect(ctrl()).toBe(true);
  });

  it('createForm disabled option disables the whole form', () => {
    const form = withForm(() =>
      createForm<{ a: string }>({ a: '' }, undefined, { disabled: true }),
    );

    expect(form().disabled()).toBe(true);
    expect(formStatus(form)).toBe('disabled');
  });

  it('reactive disabled option follows the signal', () => {
    const off = signal(false);
    const form = withForm(() =>
      createForm<{ a: string }>({ a: '' }, undefined, { disabled: off }),
    );

    expect(form().disabled()).toBe(false);
    off.set(true);
    expect(form().disabled()).toBe(true);
  });
});

describe('signal-form onChange', () => {
  it('fires the listener on value changes and supports cleanup', async () => {
    TestBed.configureTestingModule({
      providers: [],
    });

    const listener = vi.fn();

    const result = withForm(() => {
      const form = createForm<{ a: string }>({ a: '' });
      const destroy = onChange(form, listener);
      return { form, destroy };
    });

    await tick(0);
    expect(listener).not.toHaveBeenCalled();

    result.form.a().value.set('x');
    await tick(0);
    expect(listener).toHaveBeenCalledTimes(1);

    result.destroy();
    result.form.a().value.set('y');
    await tick(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('onChange accepts an explicit injector', async () => {
    const listener = vi.fn();

    const injector = withForm(() => TestBed.inject(Injector));
    const form = withForm(() => createForm<{ a: string }>({ a: '' }));

    const destroy = onChange(form, listener, { injector });

    await tick(0);
    expect(listener).not.toHaveBeenCalled();

    form.a().value.set('x');
    await tick(0);
    expect(listener).toHaveBeenCalledTimes(1);

    destroy();
    form.a().value.set('y');
    await tick(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('signal-form async validation', () => {
  it('runs async validators and reports errors after settle', async () => {
    const calls: string[] = [];

    const form = withForm(() =>
      createForm<{ username: string }>({ username: '' }, (path) => {
        validateAsyncFn(path.username, async (value) => {
          calls.push(value);
          await tick(5);
          return value === 'taken'
            ? { kind: 'taken', message: 'already used' }
            : undefined;
        }, { debounce: 10 });
      }),
    );

    form.username().value.set('taken');
    expect(form.username().pending()).toBe(true);
    expect(formStatus(form)).toBe('pending');

    await tick(60);

    expect(form.username().pending()).toBe(false);
    expect(errorBag(form.username().errors())['taken']).toBe('already used');
    expect(form().valid()).toBe(false);
    expect(formStatus(form)).toBe('invalid');
    expect(calls).toEqual(['taken']);
  });

  it('debounces rapid edits into a single run', async () => {
    const calls: string[] = [];

    const form = withForm(() =>
      createForm<{ username: string }>({ username: '' }, (path) => {
        validateAsyncFn(path.username, async (value) => {
          calls.push(value);
          return undefined;
        }, { debounce: 20 });
      }),
    );

    form.username().value.set('a');
    form.username().value.set('ab');
    form.username().value.set('abc');

    await tick(80);

    expect(calls).toEqual(['abc']);
  });

  it('skips async validators while sync ones fail', async () => {
    const spy = vi.fn(async () => undefined);

    const form = withForm(() =>
      createForm<{ username: string }>({ username: '' }, (path) => {
        minLength(path.username, 3);
        validateAsyncFn(path.username, async () => spy(), { debounce: 0 });
      }),
    );

    form.username().value.set('ab');
    await tick(30);

    expect(spy).not.toHaveBeenCalled();
    expect(form.username().pending()).toBe(false);
    expect(errorBag(form.username().errors())['minLength']).toBeTruthy();

    form.username().value.set('abc');
    await tick(50);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('honours validateOnChange: false via validateForm', async () => {
    const spy = vi.fn(async () => undefined);

    const form = withForm(() =>
      createForm<{ username: string }>({ username: 'x' }, (path) => {
        validateAsyncFn(path.username, async () => spy(), {
          validateOnChange: false,
        });
      }),
    );

    await tick(30);
    expect(spy).not.toHaveBeenCalled();

    const ok = await validateForm(form);
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('runs form-level async validation via validateFormAsync', async () => {
    const seen: unknown[] = [];

    const form = withForm(() =>
      createForm<{ a: string; b: string }>({ a: '', b: '' }, (path) => {
        required(path.a);
        required(path.b);
        validateFormAsync(path, async (values) => {
          seen.push(values);
          return { combo: 'already registered' };
        }, { debounce: 5 });
      }),
    );

    form.a().value.set('x');
    form.b().value.set('y');

    await tick(40);

    expect(seen).toEqual([{ a: 'x', b: 'y' }]);
    expect(formErrorBag(form)['combo']).toBe('already registered');
    expect(form().valid()).toBe(false);
  });

  it('validateForm resolves after pending settles', async () => {
    const form = withForm(() =>
      createForm<{ username: string }>({ username: 'ali' }, (path) => {
        validateAsyncFn(path.username, async () => {
          await tick(20);
          return { kind: 'taken', message: 'used' };
        }, { debounce: 5 });
      }),
    );

    form.username().errors()

    const ok = await validateForm(form);
    expect(ok).toBe(false);
    expect(errorBag(form.username().errors())['taken']).toBe('used');
    expect(form.username().pending()).toBe(false);
  });

  it('validateForm marks all fields touched when markAsTouched is set', async () => {
    const form = withForm(() =>
      createForm<{ username: string }>({ username: '' }, (path) => {
        validateAsyncFn(path.username, async () => undefined, { debounce: 0 });
      }),
    );

    expect(form().touched()).toBe(false);

    await validateForm(form, { markAsTouched: true });

    expect(form.username().touched()).toBe(true);
    expect(form().touched()).toBe(true);
  });
});

describe('signal-form error maps and error tree', () => {
  it('bagToErrors converts a legacy validation bag into ValidationError[]', () => {
    expect(bagToErrors(undefined)).toEqual([]);
    expect(bagToErrors({})).toEqual([]);
    expect(bagToErrors({ required: 'is required', custom: false, skip: undefined })).toEqual([
      { kind: 'required', message: 'is required' },
    ]);
    expect(bagToErrors({ min: true })).toEqual([{ kind: 'min', message: undefined }]);
  });

  it('fieldErrors returns a reactive signal of the field error map', () => {
    const form = withForm(() =>
      createForm<{ name: string }>({ name: '' }, (path) => {
        required(path.name);
        minLength(path.name, 2);
      }),
    );

    const errors = fieldErrors(() => form.name());

    form.name().value.set('A');
    expect(errors()).toEqual({ minLength: true });

    form.name().value.set('Ali');
    expect(errors()).toEqual({});
  });

  it('fieldErrors honours onlyTouched by hiding errors on untouched fields', () => {
    const form = withForm(() =>
      createForm<{ name: string }>({ name: '' }, (path) => required(path.name)),
    );

    const errors = fieldErrors(() => form.name(), { onlyTouched: true });

    expect(errors()).toEqual({});

    markAllTouched(form);
    expect(errors()).toEqual({ required: true });
  });

  it('formErrors builds a model-shaped error tree with per-node errors', () => {
    const form = withForm(() =>
      createForm<{ givenName: string; address: { city: string; zip: string } }>(
        { givenName: '', address: { city: '', zip: '' } },
        (path) => {
          required(path.givenName);
          required(path.address.city);
          minLength(path.address.zip, 5);
        },
      ),
    );

    const errors = formErrors(form);

    form.address.zip().value.set('12');
    expect(errors().givenName.errors.required).toBe(true);

    expect(errors().address.errors).toEqual({});
    expect(errors().address.city.errors.required).toBe(true);
    expect(errors().address.zip.errors.minLength).toBe(true);

    form.givenName().value.set('Ada');
    expect(errors().givenName.errors.required).toBeUndefined();
    expect(errors().givenName.errors).toEqual({});
  });

  it('formErrors with onlyTouched hides errors on untouched subtrees', () => {
    const form = withForm(() =>
      createForm<{ givenName: string }>({ givenName: '' }, (path) => required(path.givenName)),
    );

    const errors = formErrors(form, { onlyTouched: true });

    expect(errors().givenName.errors.required).toBeUndefined();

    markAllTouched(form);
    expect(errors().givenName.errors.required).toBe(true);
  });

  it('formErrors reflects the error message into the map', () => {
    const form = withForm(() =>
      createForm<{ name: string }>({ name: '' }, (path) =>
        required(path.name, { message: 'Name is required' }),
      ),
    );

    const errors = formErrors(form);
    expect(errors().name.errors.required).toBe('Name is required');
  });
});

describe('signal-form field error signals', () => {
  it('exposes per-kind error signals via the errors accessor', () => {
    const form = withForm(() =>
      createForm<{ name: string }>({ name: '' }, (path) => {
        required(path.name);
        minLength(path.name, 2);
      }),
    );

    const errors = fieldErrorSignals(() => form.name());

    expect(errors.required()).toEqual(expect.objectContaining({ kind: 'required' }));
    expect(errors.minLength()).toBeUndefined();

    form.name().value.set('A');
    expect(errors.required()).toBeUndefined();
    expect(errors.minLength()).toEqual(expect.objectContaining({ kind: 'minLength' }));
  });

  it('fieldErrorSignals reports the custom message on the error signal', () => {
    const form = withForm(() =>
      createForm<{ name: string }>({ name: '' }, (path) =>
        required(path.name, { message: 'Name is required' }),
      ),
    );

    const errors = fieldErrorSignals(() => form.name());

    expect(errors.required()?.message).toBe('Name is required');
    expect(errors.required()?.kind).toBe('required');
  });
});

describe('signal-form createForm inputs', () => {
  it('accepts a WritableSignal as the initial value and stays connected', () => {
    const source = signal<{ a: string }>({ a: 'init' });
    const form = withForm(() => createForm(source));

    expect(form().value()).toEqual({ a: 'init' });

    form.a().value.set('typed');
    expect(source()).toEqual({ a: 'typed' });
    expect(form().value()).toEqual({ a: 'typed' });
  });

  it('can be created without a schema', () => {
    const form = withForm(() => createForm<{ a: string }>({ a: 'x' }));

    expect(form().value()).toEqual({ a: 'x' });
    expect(form().valid()).toBe(true);

    form.a().value.set('y');
    expect(form().value()).toEqual({ a: 'y' });
  });
});

describe('signal-form matchField and enabledValue extras', () => {
  it('matchField supports a custom equals for Date values', () => {
    const form = withForm(() =>
      createForm<{ from: Date; to: Date }>(
        { from: new Date(2020, 0, 1), to: new Date(2020, 0, 1) },
        (path) => matchField(path.to, path.from),
      ),
    );

    expect(form().valid()).toBe(true);

    form.to().value.set(new Date(2021, 0, 1));
    expect(errorBag(form.to().errors())['match']).toBe(true);
    expect(form().valid()).toBe(false);
  });

  it('matchField ignores empty values ', () => {
    const form = withForm(() =>
      createForm<{ password: string; confirm: string }>(
        { password: '', confirm: '' },
        (path) => matchField(path.confirm, path.password),
      ),
    );

    form.confirm().value.set('');
    form.password().value.set('');
    expect(form().valid()).toBe(true);

    form.password().value.set('abc');
    expect(form().valid()).toBe(true);
  });

  it('enabledValue preserves nested enabled branches and drops disabled leaves', () => {
    const gate = signal(false);
    const form = withForm(() =>
      createForm<{ account: { name: string; ssn: string } }>(
        { account: { name: '', ssn: '' } },
        (path) => {
          required(path.account.name);
          required(path.account.ssn);
          disableWhen(path.account.ssn, () => gate());
        },
      ),
    );

    expect(enabledValue(form)).toEqual({ account: { name: '', ssn: '' } });

    gate.set(true);
    expect(enabledValue(form)).toEqual({ account: { name: '' } });
    expect(form().value()).toEqual({ account: { name: '', ssn: '' } });
  });

  it('enabledValue drops disabled array items and shifts indices', () => {
    const gate = signal(false);
    const form = withForm(() =>
      createForm<{ tags: string[] }>({ tags: ['a', 'b'] }, (path) => {
        required(path.tags);
        applyEach(path.tags, (item) => {
          disabled(item, {
            when: () => gate(),
          });
        });
      }),
    );

    expect(enabledValue(form)).toEqual({ tags: ['a', 'b'] });

    gate.set(true);
    expect(enabledValue(form)).toEqual({ tags: [] });
    expect(form().value()).toEqual({ tags: ['a', 'b'] });
  });
});
