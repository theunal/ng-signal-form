import { TestBed } from '@angular/core/testing';
import { describe, expectTypeOf, it } from 'vitest';

import {
  createForm,
  defineValidator,
  email,
  fieldErrorSignals,
  fieldErrors,
  formErrors,
  minLength,
  required,
  requiredTrue,
  type CustomValidationError,
  type ValidatorKindsOf,
  type ValidationError,
} from './signal.form';

interface FormModel {
  name: string;
  email: string;
  consent: boolean;
}

/** name alanı için özel doğrulayıcı (blok şemada kullanılacak). */
const nameValidator = defineValidator('nameValidator', (value: string) =>
  value.length > 2 ? true : { min: 3, actual: value.length },
);

const emailValidator = defineValidator('emailValidator', (value: string) =>
  value.endsWith('@example.com') || 'example.com olmalı',
);

/**
 * Ambient registry: özel kind'ler `errors` erişimcisine gerçek anahtar olarak
 * girer. Gerçek projede uygulama kökündeki tek bir `.d.ts` dosyasında yapılır.
 */
declare module './signal.form' {
  interface CustomErrorKinds extends ValidatorKindsOf<[typeof nameValidator, typeof emailValidator]> { }
}

const initial: FormModel = { name: '', email: '', consent: false };

function withForm<T>(fn: () => T): T {
  return TestBed.runInInjectionContext(fn);
}

describe('signal-form block schema with a custom error kind registry', () => {
  it('exposes builtin and custom kinds on a block (void) schema', () => {
    const form = withForm(() =>
      createForm<FormModel>(
        { name: '', email: '', consent: false },
        (path) => {
          required(path.name, { message: 'name zorunlu' });
          minLength(path.name, 2);
          required(path.email);
          email(path.email);
          requiredTrue(path.consent);
          nameValidator(path.name);
        },
      ),
    );

    // yerleşik kind'ler nokta erişimli ve doğru tipli
    expectTypeOf(form.name.errors.required).toBeFunction();
    expectTypeOf(form.name.errors.required()?.message).toEqualTypeOf<string | undefined>();
    expectTypeOf(form.name.errors.minLength()?.minLength).toEqualTypeOf<number | undefined>();
    expectTypeOf(form.email.errors.email).toBeFunction();
    expectTypeOf(form.consent.errors.requiredTrue).toBeFunction();

    // özel kind otomatik ve tip güvenli geliyor
    expectTypeOf(form.name.errors.nameValidator()).toEqualTypeOf<
      CustomValidationError<'nameValidator', { min: number; actual: number }> | undefined
    >();
    expectTypeOf(form.name.errors.nameValidator()?.min).toEqualTypeOf<number | undefined>();
    expectTypeOf(form.name.errors.nameValidator()?.actual).toEqualTypeOf<number | undefined>();

    // value yazılabilir ve tipli (string alanına string kabul eder)
    // başlangıçta name boş: required hatası mesajıyla görünür
    expect(form.name.errors.required()?.message).toBe('name zorunlu');
    expect(form.email.errors.required()?.kind).toBe('required');
    expect(form.consent.errors.requiredTrue()?.kind).toBe('requiredTrue');
    expect(form.name.errors.nameValidator()?.actual).toBe(0);

    // 'A': required geçer, minLength ve nameValidator hata verir
    form.name().value.set('A');
    expect(form.name.errors.required()).toBeUndefined();
    expect(form.name.errors.minLength()?.minLength).toBe(2);
    expect(form.name.errors.nameValidator()?.min).toBe(3);
    expect(form.name.errors.nameValidator()?.actual).toBe(1);
    expect(form.name.errors.nameValidator()?.message).toBeUndefined();

    // 3 karakter: name ve minLength geçer, email/consent hâlâ hatalı
    form.name().value.set('Ali');
    expect(form.name.errors.nameValidator()).toBeUndefined();
    expect(form.name.errors.minLength()).toBeUndefined();
    expect(form.email.errors.required()).toBeDefined();
    expect(form.consent.errors.requiredTrue()).toBeDefined();
    expect(form().valid()).toBe(false);

    form.email().value.set('ali@example.com');
    form.consent().value.set(true);
    expect(form().valid()).toBe(true);
  });

  it('keeps the custom kind out of fields it is not applied to', () => {
    const form = withForm(() =>
      createForm<FormModel>(initial, (path) => {
        required(path.email);
        email(path.email);
        emailValidator(path.email);
      }),
    );

    // registry uygulama-geneli olduğu için kind her alanda *geçerli*;
    // yalnızca çalışma zamanında o alana bağlı olmayanlar undefined döner.
    expect(form.name.errors.emailValidator()).toBeUndefined();
    expectTypeOf(form.email.errors.emailValidator()?.message).toEqualTypeOf<string | undefined>();

    form.email().value.set('ali@other.com');
    expect(form.email.errors.emailValidator()?.message).toBe('example.com olmalı');
  });

  it('supports dynamic kind access through errors.any', () => {
    const form = withForm(() =>
      createForm<FormModel>(initial, (path) => {
        nameValidator(path.name);
      }),
    );

    form.name().value.set('A');

    // dinamik erişim jenerik hata tipi döner (kind bilinmiyor)
    expectTypeOf(form.name.errors.any('nameValidator')).returns.toEqualTypeOf<
      ValidationError.WithFieldTree | undefined
    >();

    expect(form.name.errors.any('nameValidator')()?.kind).toBe('nameValidator');
    expect(form.name.errors.any('bilinmeyen')()).toBeUndefined();
    // köşeli parantez erişimi de çalışır (index signature kaçışı)
    expect(form.name.errors['nameValidator']()?.kind).toBe('nameValidator');
  });

  it('exposes custom kinds on the error map tree', () => {
    const form = withForm(() =>
      createForm<FormModel>(initial, (path) => {
        nameValidator(path.name);
      }),
    );

    form.name().value.set('A');

    const errors = formErrors(form)();
    expect(errors.name.errors.nameValidator).toBe(true);
    expect(errors.name.errors.required).toBeUndefined();
    expect(fieldErrors(form.name)().nameValidator).toBe(true);
    expect(fieldErrorSignals(form.name).nameValidator()?.min).toBe(3);
  });

  it('offers root helpers bound on the tree', () => {
    const form = withForm(() =>
      createForm<FormModel>(initial, (path) => {
        required(path.name);
        email(path.email);
        requiredTrue(path.consent);
      }),
    );

    form.name().value.set('Ali');
    form.email().value.set('ali@example.com');
    form.consent().value.set(true);

    expect(form.status()).toBe('valid');
    expect(form.enabledValue()).toEqual({ name: 'Ali', email: 'ali@example.com', consent: true });

    form.patchValue({ name: 'Veli' });
    expect(form().value().name).toBe('Veli');

    form.setValue({ name: 'Ada', email: 'ada@example.com', consent: true });
    expect(form().value()).toEqual({ name: 'Ada', email: 'ada@example.com', consent: true });

    // dirty yalnızca kullanıcı girdisiyle (controlValue) işaretlenir
    form.name().controlValue.set('Ediz');
    expect(form.name().dirty()).toBe(true);

    form.markAllUntouched();
    expect(form.name().touched()).toBe(false);
    expect(form.name().dirty()).toBe(true);

    form.markAllPristine();
    expect(form.name().dirty()).toBe(false);

    form.markAllTouched();
    expect(form.name().touched()).toBe(true);

    form.reset();
    expect(form().value()).toEqual({ name: '', email: '', consent: false });
    expect(form.name().touched()).toBe(false);
    expect(form.name().dirty()).toBe(false);
    expect(form.status()).toBe('invalid');
  });

  it('does not shadow a model field that collides with a helper name', () => {
    interface Colliding extends FormModel {
      status: string;
    }

    const form = withForm(() => createForm<Colliding>({ ...initial, status: 'draft' }));

    // veri alanı öncelikli: `form.status` bir FieldTree (helper değil)
    // helper olsaydı `form.status()` doğrudan bir ControlStatus dönerdi.
    expect(form.status().value()).toBe('draft');
    // diğer helper'lar yine eklenir
    expect(typeof form.setValue).toBe('function');
  });
});
