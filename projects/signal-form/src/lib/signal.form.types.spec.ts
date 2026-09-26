import { TestBed } from '@angular/core/testing';
import type { Signal } from '@angular/core';
import { describe, expectTypeOf, it } from 'vitest';

import {
  createForm,
  defineValidator,
  email,
  fieldErrorSignals,
  fieldErrors,
  formErrors,
  matchField,
  matchFields,
  minLength,
  required,
  requiredWhen,
  requiredWhenFields,
  type CustomValidationError,
  type ErrorKindsAt,
  type ErrorMap,
  type FieldRule,
  type FormErrors,
  type FormSchema,
  type RequiredValidationError,
  type RuleKinds,
  type TypedPathTree,
} from './signal.form';

interface Profile {
  firstName: string;
  email: string;
  password: string;
  confirm: string;
  hasCompany: boolean;
  companyName: string;
}

const initial: Profile = {
  firstName: '',
  email: '',
  password: '',
  confirm: '',
  hasCompany: false,
  companyName: '',
};

const usernameFree = defineValidator('usernameFree', (value: string) =>
  value !== 'admin' || 'Bu kullanıcı adı kullanılamaz',
);

const typedRules = (path: TypedPathTree<Profile>) => [
  required(path.firstName),
  minLength(path.firstName, 2),
  email(path.email),
  usernameFree(path.email),
  required(path.confirm),
  matchField(path.confirm, path.password, { message: 'Eşleşmiyor' }),
  requiredWhen(path.companyName, path.hasCompany, { kind: 'companyRequired' }),
  matchFields(path, 'password', 'confirm'),
  requiredWhenFields(path, 'hasCompany', 'companyName'),
];

function withForm<T>(fn: () => T): T {
  return TestBed.runInInjectionContext(fn);
}

describe('signal-form type-level error kinds', () => {
  it('derives the kind union from the rule list (no enum / interface)', () => {
    type Rules = ReturnType<typeof typedRules>;

    expectTypeOf<RuleKinds<Rules>>().toEqualTypeOf<
      | 'required'
      | 'minLength'
      | 'email'
      | 'usernameFree'
      | 'match'
      | 'companyRequired'
      | 'requiredWhen'
    >();

    expectTypeOf<ErrorKindsAt<Rules, 'email'>>().toEqualTypeOf<'email' | 'usernameFree'>();
    expectTypeOf<ErrorKindsAt<Rules, 'confirm'>>().toEqualTypeOf<'required' | 'match'>();
    expectTypeOf<ErrorKindsAt<Rules, ''>>().toEqualTypeOf<'match' | 'requiredWhen'>();
  });

  it('exposes per-field kinds on the errors accessor', () => {
    const f = withForm(() => createForm(initial, typedRules));

    expectTypeOf(f.email.errors.usernameFree()).toEqualTypeOf<
      CustomValidationError<'usernameFree'> | undefined
    >();
    expectTypeOf(f.email.errors.usernameFree).toEqualTypeOf<
      Signal<CustomValidationError<'usernameFree'> | undefined>
    >();
    expectTypeOf(f.confirm.errors.match()).toEqualTypeOf<CustomValidationError<'match'> | undefined>();
    expectTypeOf(f.companyName.errors.companyRequired()).toEqualTypeOf<
      CustomValidationError<'companyRequired'> | undefined
    >();

    // @ts-expect-error — 'email' kuralı confirm alanına eklenmedi
    f.confirm.errors.email;

    // @ts-expect-error — usernameFree kuralı firstName alanına eklenmedi
    f.firstName.errors.usernameFree;
  });

  it('exposes root kinds from matchFields / requiredWhenFields rules', () => {
    const f = withForm(() => createForm(initial, typedRules));

    expectTypeOf(f.errors.match).toEqualTypeOf<
      Signal<CustomValidationError<'match'> | undefined>
    >();
    expectTypeOf(f.errors.requiredWhen).toEqualTypeOf<
      Signal<CustomValidationError<'requiredWhen'> | undefined>
    >();

    // @ts-expect-error — kök kural listesinde 'email' yok
    f.errors.email;
  });

  it('infers kinds in formErrors without an explicit generic', () => {
    const f = withForm(() => createForm(initial, typedRules));

    expectTypeOf(formErrors(f)()).toEqualTypeOf<
      FormErrors<Profile, RuleKinds<ReturnType<typeof typedRules>>>
    >();
    expectTypeOf(formErrors(f)().email.errors.usernameFree).toEqualTypeOf<
      string | true | undefined
    >();

    // @ts-expect-error — kind listede değil (köşeli parantez required)
    formErrors(f)().email.errors.someUnknownKind;
  });

  it('infers kinds in fieldErrors per field', () => {
    const f = withForm(() => createForm(initial, typedRules));

    expectTypeOf(fieldErrors(f.email)()).toEqualTypeOf<ErrorMap<'email' | 'usernameFree'>>();
    expectTypeOf(fieldErrors(f.confirm)()).toEqualTypeOf<ErrorMap<'required' | 'match'>>();

    // @ts-expect-error — usernameFree kuralı confirm alanına eklenmedi
    fieldErrors(f.confirm)().usernameFree;
  });

  it('infers kinds for fieldErrorSignals on a typed tree', () => {
    const f = withForm(() => createForm(initial, typedRules));

    expectTypeOf(fieldErrorSignals(f.confirm).match).toEqualTypeOf<
      Signal<CustomValidationError<'match'> | undefined>
    >();

    // @ts-expect-error — 'email' kuralı confirm alanına eklenmedi
    fieldErrorSignals(f.confirm).email;
  });

  it('keeps the legacy explicit-generic signatures working', () => {
    const f = withForm(() => createForm(initial, typedRules));

    expectTypeOf(fieldErrors<'usernameFree'>(f.email)()).toEqualTypeOf<ErrorMap<'usernameFree'>>();
    expectTypeOf(formErrors<Profile, 'usernameFree'>(f)()).toEqualTypeOf<
      FormErrors<Profile, 'usernameFree'>
    >();
  });

  it('falls back to loose errors when the schema does not return a rule list', () => {
    const f = withForm(() =>
      createForm(initial, (path) => {
        required(path.email);
        matchField(path.confirm, path.password);
      }),
    );

    // Gevşek modda yerleşik kind'ler nokta erişimli kalır
    expectTypeOf(f.email.errors.required).toBeFunction();
    expectTypeOf(f.email.errors.email).toBeFunction();
    expectTypeOf(f.confirm.errors.match).toBeFunction();
    expectTypeOf(f.errors.requiredWhen).toBeFunction();

    // Hata ağacı model şeklinde; alan düğümü de aynı harita tipinde
    expectTypeOf(formErrors(f)().email.errors).toEqualTypeOf<ErrorMap>();
    expectTypeOf(formErrors(f)().email.errors.required).toEqualTypeOf<string | true | undefined>();

    // TKind çıkarılamaz (`never`), ama elle kind vermek hâlâ mümkün
    expectTypeOf(fieldErrors<'customValidator'>(f.email)).toBeFunction();
  });
});

describe('signal-form schema call styles', () => {
  it('FormSchema covers both a rule list and a block schema', () => {
    const annotated: Profile = { ...initial };

    // Kural listesi: TRules'in şemadan çıkarılması gerekir. `RuleList` gibi
    // geniş bir tipi annotate etmek (iç içe dizi içerebileceği için) alan bazlı
    // kind çıkarımını bozar — bu yüzden burada `FormSchema<Profile>` kullanılır
    // ve dönüş tipi çıkarılmaya bırakılır.
    const listForm = withForm(() =>
      createForm(annotated, (path) => [required(path.firstName), minLength(path.firstName, 2)]),
    );

    expectTypeOf(listForm.firstName.errors.required).toBeFunction();
    expectTypeOf(listForm.firstName.errors.minLength).toBeFunction();

    // blok (void) şema: FormSchema<Profile> doğrudan annotate edilebilir
    const blockSchema: FormSchema<Profile> = (path) => {
      required(path.firstName);
    };
    const blockForm = withForm(() => createForm(annotated, blockSchema));

    // gevşek mod: yerleşik kind'ler erişilebilir
    expectTypeOf(blockForm.firstName.errors.required).toBeFunction();

    // kural listesini döndüren şemalar da aynı tipte tanımlanabilir
    const listSchema: FormSchema<Profile, [FieldRule<'firstName', RequiredValidationError>]> = (
      path,
    ) => [required(path.firstName)];
    const typedForm = withForm(() => createForm(annotated, listSchema));

    expectTypeOf(typedForm.firstName.errors.required).toBeFunction();
  });

  it('infers TModel and TRules from an annotated initial value', () => {
    const annotated: Profile = { ...initial };

    const f = withForm(() =>
      createForm(annotated, (path) => [required(path.firstName), minLength(path.firstName, 2)]),
    );

    expectTypeOf(f.firstName.errors.required).toBeFunction();
    expectTypeOf(f.firstName.errors.minLength).toBeFunction();

    // @ts-expect-error — 'min' kuralı firstName'a eklenmedi
    f.firstName.errors.min;
  });

  it('infers both from an inline object literal', () => {
    const f = withForm(() =>
      createForm({ firstName: '', email: '' }, (path) => [required(path.firstName), email(path.email)]),
    );

    // @ts-expect-error — 'email' kuralı firstName'a eklenmedi
    f.firstName.errors.email;

    // @ts-expect-error — 'required' kuralı email'a eklenmedi
    f.email.errors.required;
  });

  it('degrades to app-wide errors when the TModel generic is written explicitly', () => {
    const annotated: Profile = { ...initial };

    // TypeScript kısmi generic listesinde TRules'ı çıkaramaz → default `void`.
    // Bu yüzden kural listesi döndürülse bile alan bazlı tipler kaybolur.
    const f = withForm(() => createForm<Profile>(annotated, (path) => [required(path.firstName)]));

    // Aşağıdakiler derlenir (gevşek mod) — doğru kullanım için generic'i yazmayın
    f.firstName.errors.email;
    f.firstName.errors.maxDate;
    expectTypeOf(f.firstName.errors.required).toBeFunction();
  });
});
