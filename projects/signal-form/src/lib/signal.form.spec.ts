import { TestBed } from '@angular/core/testing';
import { Injector, signal, type Signal } from '@angular/core';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  applyEach,
  applyEachRules,
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
  markPristine,
  markUntouched,
  resetForm,
  enabledValue,
  onChange,
  disableControl,
  disableWhen,
  touchAll,
  type TypedPathTree,
  defineValidator,
} from './signal.form';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function withForm<T>(fn: () => T): T {
  return TestBed.runInInjectionContext(fn);
}

describe('signal-form sync validation', () => {
  it('exposes typed field errors via error bags', () => {
    const initial: { name: string; email: string; consent: boolean } = {
      name: '',
      email: '',
      consent: false,
    };

    // const customValidator = defineValidator(
    //   'customValidator',
    //   (value: string) => value !== 'admin' || 'Bu isim kullanılamaz',
    //   { message: 'Bu isim kullanılamaz' } // Varsayılan mesaj (isteğe bağlı)
    // );

    const form = withForm(() =>
      createForm(initial, (path) => [
        required(path.name),
        minLength(path.name, 2),
        required(path.email),
        email(path.email),
        requiredTrue(path.consent),

        // customValidator(path.name)
      ])
    );

    // form.name.errors.required();
    // form.name.errors.minLength();
    // form.name.errors.email();
    // form.name.errors.maxDate();
    // let m = form.name.errors.customValidator()?.message;

    // form.name.untouched();
    // form.name().touched();
    // form.name().dirty();
    // form.name.pristine();

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
    const initial = { password: '', confirm: '' };

    const form = withForm(() =>
      createForm(initial, (path) => [
        required(path.password),
        required(path.confirm),
        matchField(path.confirm, path.password, { message: 'The values do not match' }),
      ]),
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
    const initial = { password: '', confirm: '' };
    const schema = (path: TypedPathTree<typeof initial>) => [
      required(path.password),
      required(path.confirm),
      matchFields(path, 'password', 'confirm', { message: 'The values do not match' }),
    ];

    const form = withForm(() => createForm(initial, schema));

    form.password().value.set('123456');
    form.confirm().value.set('654321');

    expect(formErrorBag(form)['match']).toBe('The values do not match');
    expect(form().valid()).toBe(false);

    form.confirm().value.set('123456');
    expect(formErrorBag(form)['match']).toBeUndefined();
    expect(form().valid()).toBe(true);
  });

  it('supports requiredWhen for conditional required', () => {
    const initial = { hasCompany: false, companyName: '' };

    const form = withForm(() =>
      createForm(initial, (path) => [
        requiredWhen(path.companyName, path.hasCompany, {
          kind: 'companyRequired',
          message: 'Company name is required',
        }),
      ]),
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
    const initial = { hasCompany: false, companyName: '' };
    const schema = (path: TypedPathTree<typeof initial>) => [
      requiredWhenFields(path, 'hasCompany', 'companyName', { message: 'Company name is required' }),
    ];

    const form = withForm(() => createForm(initial, schema));

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
    const form = withForm(() => createForm({ first: '', last: '' }));

    patchValue(form, { first: 'Zeynep' });

    expect(form.first().value()).toBe('Zeynep');
    expect(form.last().value()).toBe('');
    expect(form().value()).toEqual({ first: 'Zeynep', last: '' });
  });

  it('drops disabled branches from enabledValue', () => {
    const gate = signal(false);
    const initial = { a: '', b: '' };

    const form = withForm(() =>
      createForm(initial, (path) => {
        disableWhen(path.a, () => gate()); // void — blok gövdede kalır

        return [required(path.a), required(path.b)];
      }),
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
    const form = withForm(() => createForm({ a: '' }, (path) => [required(path.a)], { disabled }));

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
    const form = withForm(() => createForm({ a: '', b: '' }));

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
    const form = withForm(() => createForm({ a: '', b: '' }));

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

  it('exposes the inverse flags as tree-level signals', () => {
    const form = withForm(() => createForm({ a: '', b: '' }));

    expectTypeOf(form.a.untouched).toEqualTypeOf<Signal<boolean>>();
    expectTypeOf(form.a.pristine).toEqualTypeOf<Signal<boolean>>();

    // başlangıç: ikisi de ters çevrilmiş
    expect(form.a.untouched()).toBe(true);
    expect(form.a.pristine()).toBe(true);

    // dirty yalnızca kullanıcı girdisiyle (controlValue) işaretlenir
    form.a().controlValue.set('x');
    expect(form.a.pristine()).toBe(false);
    expect(form.a.untouched()).toBe(true);

    markAllTouched(form);
    expect(form.a.untouched()).toBe(false);
    expect(form.b.untouched()).toBe(false); // türetilmiş: ebeveyn dokunuldu

    // aynı signal kimliği korunur (şablonda tekrar okumak yeni computed üretmez)
    expect(form.a.untouched).toBe(form.a.untouched);
    expect(form.a.pristine).toBe(form.a.pristine);
  });

  it('markUntouched / markPristine work on a single field subtree', () => {
    const form = withForm(() => createForm({ a: '', b: '' }));

    form.a().controlValue.set('x');
    markAllTouched(form);
    form.b().controlValue.set('y');

    expect(form.a().dirty()).toBe(true);
    expect(form.b().dirty()).toBe(true);

    // yalnızca a'nın dalı temizlenir
    markUntouched(form.a);
    expect(form.a().touched()).toBe(false);
    expect(form.a.untouched()).toBe(true);
    expect(form.b().touched()).toBe(true);

    // dirty korunur (selfFlagged yeniden yükler)
    expect(form.a().dirty()).toBe(true);
    expect(form.b().dirty()).toBe(true);

    markPristine(form.a);
    expect(form.a().dirty()).toBe(false);
    expect(form.a.pristine()).toBe(true);
    expect(form.b().dirty()).toBe(true);

    // touched korunur
    expect(form.b().touched()).toBe(true);
  });

  it('reverts a subtree without touching its siblings', () => {
    const initial = { address: { city: '', zip: '' }, other: '' };
    const form = withForm(() => createForm(initial));

    form.address.city().controlValue.set('Istanbul');
    form.address.zip().controlValue.set('34000');
    form.other().controlValue.set('x');
    markAllTouched(form);

    expect(form.address().touched()).toBe(true);

    markUntouched(form.address);

    expect(form.address().touched()).toBe(false);
    expect(form.address.city().touched()).toBe(false);
    expect(form.address.zip().touched()).toBe(false);
    // kardeş dal korunur
    expect(form.other().touched()).toBe(true);
  });

  it('does not shadow a model field that collides with a flag name', () => {
    interface Colliding {
      pristine: boolean;
      a: string;
    }

    const form = withForm(() => createForm<Colliding>({ pristine: true, a: '' }));

    // veri alanı öncelikli: sinyal değil, alan ağacı
    expect(form.pristine().value()).toBe(true);
    expectTypeOf(form.pristine).not.toEqualTypeOf<Signal<boolean>>();

    // alanın kendi altında bayrak normal
    expectTypeOf(form.pristine.untouched).toEqualTypeOf<Signal<boolean>>();

    // çakışmayan alanda bayrak normal
    expect(form.a.pristine()).toBe(true);
  });

  it('reset clears touched and dirty but keeps values', () => {
    const form = withForm(() => createForm({ a: 'start' }, (path) => [required(path.a)]));

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
      createForm({ a: 'start', b: '' }, (path) => [required(path.a)]),
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
      createForm({ a: '' }, (path) => {
        disableWhen(path.a, gate); // void — blok gövdede kalır

        return [required(path.a)];
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
    const form = withForm(() => createForm({ a: 'start' }));

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
    const form = withForm(() => createForm({ a: '' }, undefined, { disabled: true }));

    expect(form().disabled()).toBe(true);
    expect(formStatus(form)).toBe('disabled');
  });

  it('reactive disabled option follows the signal', () => {
    const off = signal(false);
    const form = withForm(() => createForm({ a: '' }, undefined, { disabled: off }));

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
      const form = createForm({ a: '' });
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
    const form = withForm(() => createForm({ a: '' }));

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
      createForm({ username: '' }, (path) => [
        validateAsyncFn(path.username, async (value) => {
          calls.push(value);
          await tick(5);
          return value === 'taken'
            ? { kind: 'taken', message: 'already used' }
            : undefined;
        }, { debounce: 10 }),
      ]),
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
      createForm({ username: '' }, (path) => [
        validateAsyncFn(path.username, async (value) => {
          calls.push(value);
          return undefined;
        }, { debounce: 20 }),
      ]),
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
      createForm({ username: '' }, (path) => [
        minLength(path.username, 3),
        validateAsyncFn(path.username, async () => spy(), { debounce: 0 }),
      ]),
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
      createForm({ username: 'x' }, (path) => [
        validateAsyncFn(path.username, async () => spy(), {
          validateOnChange: false,
        }),
      ]),
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
      createForm({ a: '', b: '' }, (path) => {
        validateFormAsync(path, async (values) => {
          seen.push(values);
          return { combo: 'already registered' };
        }, { debounce: 5 }); // void — blok gövdede kalır

        return [required(path.a), required(path.b)];
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
      createForm({ username: 'ali' }, (path) => [
        validateAsyncFn(path.username, async () => {
          await tick(20);
          return { kind: 'taken', message: 'used' };
        }, { debounce: 5 }),
      ]),
    );

    const ok = await validateForm(form);
    expect(ok).toBe(false);
    expect(errorBag(form.username().errors())['taken']).toBe('used');
    expect(form.username().pending()).toBe(false);
  });

  it('validateForm marks all fields touched when markAsTouched is set', async () => {
    const form = withForm(() =>
      createForm({ username: '' }, (path) => [
        validateAsyncFn(path.username, async () => undefined, { debounce: 0 }),
      ]),
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
      createForm({ name: '' }, (path) => [required(path.name), minLength(path.name, 2)]),
    );

    const errors = fieldErrors(() => form.name());

    form.name().value.set('A');
    expect(errors()).toEqual({ minLength: true });

    form.name().value.set('Ali');
    expect(errors()).toEqual({});
  });

  it('fieldErrors honours onlyTouched by hiding errors on untouched fields', () => {
    const form = withForm(() => createForm({ name: '' }, (path) => [required(path.name)]));

    const errors = fieldErrors(() => form.name(), { onlyTouched: true });

    expect(errors()).toEqual({});

    markAllTouched(form);
    expect(errors()).toEqual({ required: true });
  });

  it('formErrors builds a model-shaped error tree with per-node errors', () => {
    const initial = { givenName: '', address: { city: '', zip: '' } };

    const form = withForm(() =>
      createForm(initial, (path) => [
        required(path.givenName),
        required(path.address.city),
        minLength(path.address.zip, 5),
      ]),
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
      createForm({ givenName: '' }, (path) => [required(path.givenName)]),
    );

    const errors = formErrors(form, { onlyTouched: true });

    expect(errors().givenName.errors.required).toBeUndefined();

    markAllTouched(form);
    expect(errors().givenName.errors.required).toBe(true);  });

  it('formErrors reflects the error message into the map', () => {
    const form = withForm(() =>
      createForm({ name: '' }, (path) => [required(path.name, { message: 'Name is required' })]),
    );

    const errors = formErrors(form);
    expect(errors().name.errors.required).toBe('Name is required');
  });

  it('formErrors builds an array-shaped error tree with per-item errors', () => {
    const initial = { tags: ['', ''] };
    const form = withForm(() =>
      createForm(initial, (path) => [
        required(path.tags),
        applyEachRules(path.tags, (item) => [required(item), minLength(item, 2)]),
      ]),
    );

    const errors = formErrors(form);

    // dizi düğümünün kendi `errors`'ı non-enumerable olarak eklenir
    expect(errors().tags.errors).toEqual({});

    form.tags[0]().value.set('a');
    form.tags[1]().value.set('');

    expect(errors().tags[0].errors.minLength).toBe(true);
    expect(errors().tags[0].errors.required).toBeUndefined();
    expect(errors().tags[1].errors.required).toBe(true);
    // non-enumerable: Object.keys diziyi olduğu gibi bırakır
    expect(Object.keys(errors().tags)).toEqual(['0', '1']);

    form.tags[0]().value.set('alpha');
    form.tags[1]().value.set('beta');
    expect(errors().tags[0].errors).toEqual({});
    expect(errors().tags[1].errors).toEqual({});
  });

  it('formErrors honours onlyTouched for array items', () => {
    const initial = { tags: [''] };
    const form = withForm(() =>
      createForm(initial, (path) => [applyEachRules(path.tags, (item) => [required(item)])]),
    );

    const errors = formErrors(form, { onlyTouched: true });
    expect(errors().tags[0].errors.required).toBeUndefined();

    markAllTouched(form);
    expect(errors().tags[0].errors.required).toBe(true);
  });
});

describe('signal-form field error signals', () => {
  it('exposes per-kind error signals via the errors accessor', () => {
    const form = withForm(() =>
      createForm({ name: '' }, (path) => [required(path.name), minLength(path.name, 2)]),
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
      createForm({ name: '' }, (path) => [required(path.name, { message: 'Name is required' })]),
    );

    const errors = fieldErrorSignals(() => form.name());

    expect(errors.required()?.message).toBe('Name is required');
    expect(errors.required()?.kind).toBe('required');
  });

  it('is the escape hatch when the model has a field named errors', () => {
    interface WithErrors {
      name: string;
      errors: string[];
    }

    const form = withForm(() =>
      createForm<WithErrors>({ name: '', errors: [] }, (path) => [required(path.name)]),
    );

    // veri alanı öncelikli: form.x.errors bir alan ağacı, sinyal değil
    expect(form.errors().value()).toEqual([]);
    expect(form.errors().keyInParent()).toBe('errors');

    // hata erişimi fieldErrorSignals üzerinden
    const errors = fieldErrorSignals(form.name);

    form.name().value.set('Ali');
    expect(errors.required()).toBeUndefined();

    form.name().value.set('');
    expect(errors.required()).toBeDefined();

    // harita (ErrorMap) yardımcısı da çalışır
    expect(fieldErrors(form.name)().required).toBe(true);
  });
});

describe('signal-form defineValidator options', () => {
  const notEmpty = defineValidator('notEmpty', (value: string) =>
    value.length > 0 ? true : 'boş olamaz',
  );
  const neverFails = defineValidator('neverFails', () => false, { message: 'varsayılan mesaj' });

  it('overrides the message the check returned', () => {
    const form = withForm(() =>
      createForm({ a: '' }, (path) => [notEmpty(path.a, { message: 'i18n: a gerekli' })]),
    );

    form.a().value.set('x');
    expect(form.a.errors.notEmpty()).toBeUndefined();

    form.a().value.set('');
    expect(form.a.errors.notEmpty()?.message).toBe('i18n: a gerekli');
  });

  it('falls back to the message the check returned when no override is given', () => {
    const form = withForm(() => createForm({ a: '' }, (path) => [notEmpty(path.a)]));

    form.a().value.set('');
    expect(form.a.errors.notEmpty()?.message).toBe('boş olamaz');
  });

  it('accepts a LogicFn for the message', () => {
    const form = withForm(() =>
      createForm({ a: '' }, (path) => [
        notEmpty(path.a, { message: (ctx) => `i18n: ${String(ctx.value()).length} karakter` }),
      ]),
    );

    form.a().value.set('');
    expect(form.a.errors.notEmpty()?.message).toBe('i18n: 0 karakter');
  });

  it('uses the definition default when the check returns false', () => {
    const form = withForm(() => createForm({ a: 'x' }, (path) => [neverFails(path.a)]));

    expect(form.a.errors.neverFails()?.message).toBe('varsayılan mesaj');
  });

  it('skips the validator when when() returns false', () => {
    const enabled = signal(false);
    const form = withForm(() =>
      createForm({ a: '' }, (path) => [notEmpty(path.a, { when: () => enabled() })]),
    );

    // kapalıyken doğrulayıcı hiç çalışmaz → hata yok
    expect(form.a.errors.notEmpty()).toBeUndefined();
    expect(form().valid()).toBe(true);

    enabled.set(true);
    expect(form.a.errors.notEmpty()?.message).toBe('boş olamaz');
    expect(form().valid()).toBe(false);

    form.a().value.set('x');
    expect(form.a.errors.notEmpty()).toBeUndefined();
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
    const form = withForm(() => createForm({ a: 'x' }));

    expect(form().value()).toEqual({ a: 'x' });
    expect(form().valid()).toBe(true);

    form.a().value.set('y');
    expect(form().value()).toEqual({ a: 'y' });
  });

  it('accepts an explicit injector outside of an injection context', () => {
    // JSDoc: injection context dışında çağrılacaksa options.injector verilmelidir
    const injector = withForm(() => TestBed.inject(Injector));

    // bu çağrı bilinçli olarak injection context DIŞINDA (withForm kullanılmıyor)
    const form = createForm(
      { a: '' },
      (path) => [required(path.a)],
      { injector },
    );

    form.a().value.set('');
    expect(form.a.errors.required()).toBeDefined();
    form.a().value.set('x');
    expect(form.a.errors.required()).toBeUndefined();
  });

  it('throws when no injector is available outside an injection context', () => {
    // inject() bulamazsa Angular'ın kendi hatası fırlatılır
    expect(() => createForm({ a: '' })).toThrow();
  });
});

describe('signal-form matchField and enabledValue extras', () => {
  it('matchField supports a custom equals for Date values', () => {
    const form = withForm(() =>
      createForm(
        { from: new Date(2020, 0, 1), to: new Date(2020, 0, 1) },
        (path) => [matchField(path.to, path.from)],
      ),
    );

    expect(form().valid()).toBe(true);

    form.to().value.set(new Date(2021, 0, 1));
    expect(errorBag(form.to().errors())['match']).toBe(true);
    expect(form().valid()).toBe(false);
  });

  it('matchField ignores empty values ', () => {
    const form = withForm(() =>
      createForm({ password: '', confirm: '' }, (path) => [
        matchField(path.confirm, path.password),
      ]),
    );

    form.confirm().value.set('');
    form.password().value.set('');
    expect(form().valid()).toBe(true);

    form.password().value.set('abc');
    expect(form().valid()).toBe(true);
  });

  it('enabledValue preserves nested enabled branches and drops disabled leaves', () => {
    const gate = signal(false);
    const initial = { account: { name: '', ssn: '' } };

    const form = withForm(() =>
      createForm(initial, (path) => {
        disableWhen(path.account.ssn, () => gate()); // void — blok gövdede kalır

        return [required(path.account.name), required(path.account.ssn)];
      }),
    );

    expect(enabledValue(form)).toEqual({ account: { name: '', ssn: '' } });

    gate.set(true);
    expect(enabledValue(form)).toEqual({ account: { name: '' } });
    expect(form().value()).toEqual({ account: { name: '', ssn: '' } });
  });

  it('enabledValue drops disabled array items and shifts indices', () => {
    const gate = signal(false);
    // Yalnızca void kurallar: diziye girecek tipli kural yok, blok gövde kalır
    const form = withForm(() =>
      createForm({ tags: ['a', 'b'] }, (path) => {
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

describe('signal-form typed error kinds (rule list schema)', () => {
  it('exposes custom validator kinds on the field errors accessor', () => {
    const usernameFree = defineValidator('usernameFree', (value: string) =>
      value !== 'admin' || 'Bu kullanıcı adı kullanılamaz',
    );

    const form = withForm(() => createForm({ email: '' }, (path) => [usernameFree(path.email)]));

    expect(form.email.errors.usernameFree()).toBeUndefined();

    form.email().value.set('admin');

    expect(form.email.errors.usernameFree()?.message).toBe('Bu kullanıcı adı kullanılamaz');
    expect(form.email.errors.usernameFree()?.kind).toBe('usernameFree');
    expect(fieldErrorSignals(form.email).usernameFree()?.kind).toBe('usernameFree');
    expect(fieldErrors(form.email)().usernameFree).toBe('Bu kullanıcı adı kullanılamaz');
    expect(formErrors(form)().email.errors.usernameFree).toBe('Bu kullanıcı adı kullanılamaz');

    form.email().value.set('other');
    expect(form.email.errors.usernameFree()).toBeUndefined();
  });

  it('exposes matchField kinds on the field and matchFields kinds on the root', () => {
    const initial = { password: '', confirm: '', hasCompany: false, companyName: '' };

    const form = withForm(() =>
      createForm(initial, (path) => [
        required(path.password),
        required(path.confirm),
        matchField(path.confirm, path.password, { message: 'The values do not match' }),
        matchFields(path, 'password', 'confirm', { message: 'Root mismatch' }),
        requiredWhenFields(path, 'hasCompany', 'companyName', {
          message: 'Company name is required',
        }),
      ]),
    );

    expect(form.errors.match()).toBeUndefined();
    expect(form.errors.requiredWhen()).toBeUndefined();

    form.password().value.set('123456');
    form.confirm().value.set('654321');
    form.hasCompany().value.set(true);

    expect(form.confirm.errors.match()?.message).toBe('The values do not match');
    expect(form.errors.match()?.message).toBe('Root mismatch');
    expect(form.errors.requiredWhen()?.message).toBe('Company name is required');
    expect(formErrorBag(form)['match']).toBe('Root mismatch');
    expect(formErrors(form)().errors.match).toBe('Root mismatch');

    form.confirm().value.set('123456');
    expect(form.confirm.errors.match()).toBeUndefined();
    expect(form.errors.match()).toBeUndefined();
  });

  it('supports a custom kind on matchFields and requiredWhenFields', () => {
    const initial = { password: '', confirm: '', hasCompany: false, companyName: '' };

    const form = withForm(() =>
      createForm(initial, (path) => [
        matchFields(path, 'password', 'confirm', { kind: 'credentialsMatch' }),
        requiredWhenFields(path, 'hasCompany', 'companyName', { kind: 'companyRequired' }),
      ]),
    );

    form.password().value.set('a');
    form.confirm().value.set('b');
    form.hasCompany().value.set(true);

    expect(form.errors.credentialsMatch()).toEqual(expect.objectContaining({ kind: 'credentialsMatch' }));
    expect(form.errors.companyRequired()).toEqual(expect.objectContaining({ kind: 'companyRequired' }));
  });
});
