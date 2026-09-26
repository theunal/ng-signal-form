import { TestBed } from '@angular/core/testing';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createForm,
  defineRule,
  defineValidator,
  email,
  minLength,
  required,
  requiredTrue,
  type CustomValidationError,
  type FieldPath,
  type ValidationError,
  validate,
} from './signal.form';

interface FormModel {
  name: string;
  email: string;
  consent: boolean;
}

/**
 * `name` alanına eklenen kurallar: required + minLength + customValidator.
 * `email` ve `requiredTrue` diğer alanlara gidiyor.
 */
const customValidator = defineValidator('customValidator', (value: string) =>
  value.length > 2 || 'name çok kısa',
);

const initial: FormModel = { name: '', email: '', consent: false };

function withForm<T>(fn: () => T): T {
  return TestBed.runInInjectionContext(fn);
}

describe('signal-form rule list schema: per-field error kinds', () => {
  it('exposes only the rules applied to the field', () => {
    const form = withForm(() =>
      createForm(initial, (path) => [
        required(path.name),
        minLength(path.name, 2),
        required(path.email),
        email(path.email),
        requiredTrue(path.consent),
        customValidator(path.name),
      ]),
    );

    // --- name: yalnızca required | minLength | customValidator ---
    expectTypeOf(form.name.errors.required).toBeFunction();
    expectTypeOf(form.name.errors.minLength).toBeFunction();
    expectTypeOf(form.name.errors.customValidator).toBeFunction();

    expectTypeOf(form.name.errors.customValidator()).toEqualTypeOf<
      CustomValidationError<'customValidator'> | undefined
    >();
    expectTypeOf(form.name.errors.customValidator()?.message).toEqualTypeOf<string | undefined>();
    expectTypeOf(form.name.errors.minLength()?.minLength).toEqualTypeOf<number | undefined>();

    // @ts-expect-error — 'email' kuralı name alanına eklenmedi
    form.name.errors.email;

    // @ts-expect-error — maxDate hiçbir alana eklenmedi
    form.name.errors.maxDate;

    // @ts-expect-error — requiredTrue name alanına eklenmedi
    form.name.errors.requiredTrue;

    // @ts-expect-error — customValidator email alanına eklenmedi
    form.email.errors.customValidator;

    // --- diğer alanlar kendi kurallarını görür ---
    expectTypeOf(form.email.errors.email).toBeFunction();
    expectTypeOf(form.email.errors.required).toBeFunction();
    expectTypeOf(form.consent.errors.requiredTrue).toBeFunction();
  });

  it('runs the rules at runtime and reports messages per kind', () => {
    const form = withForm(() =>
      createForm(initial, (path) => [
        required(path.name, { message: 'name zorunlu' }),
        minLength(path.name, 2),
        required(path.email),
        email(path.email),
        requiredTrue(path.consent),
        customValidator(path.name),
      ]),
    );

    // başlangıç: name boş → required + customValidator hata verir
    expect(form.name.errors.required()?.message).toBe('name zorunlu');
    expect(form.name.errors.customValidator()?.message).toBe('name çok kısa');

    // 'A' → required geçer, minLength ve customValidator hata verir
    form.name().value.set('A');
    expect(form.name.errors.required()).toBeUndefined();
    expect(form.name.errors.minLength()?.minLength).toBe(2);
    expect(form.name.errors.customValidator()?.message).toBe('name çok kısa');

    // 'Ali' → name temiz
    form.name().value.set('Ali');
    expect(form.name.errors.required()).toBeUndefined();
    expect(form.name.errors.minLength()).toBeUndefined();
    expect(form.name.errors.customValidator()).toBeUndefined();

    // diğer alanlar hâlâ hatalı
    expect(form.email.errors.required()).toBeDefined();
    expect(form.consent.errors.requiredTrue()).toBeDefined();
    expect(form().valid()).toBe(false);

    form.email().value.set('ali@example.com');
    form.consent().value.set(true);
    expect(form().valid()).toBe(true);
  });

  it('accepts a hand-written void validator through defineRule', () => {
    const notAdmin = defineRule('notAdmin', (path: FieldPath<string>) =>
      validate(path, ({ value }) =>
        value() === 'admin' ? { kind: 'notAdmin', message: 'admin kullanılamaz' } : undefined,
      ),
    );

    const form = withForm(() =>
      createForm(initial, (path) => [required(path.name), notAdmin(path.name)]),
    );

    // defineRule de tipli kural üretir
    expectTypeOf(form.name.errors.notAdmin()).toEqualTypeOf<
      CustomValidationError<'notAdmin'> | undefined
    >();

    // @ts-expect-error — notAdmin email alanına eklenmedi
    form.email.errors.notAdmin;

    form.name().value.set('admin');
    expect(form.name.errors.notAdmin()?.message).toBe('admin kullanılamaz');

    form.name().value.set('ada');
    expect(form.name.errors.notAdmin()).toBeUndefined();
  });
});
