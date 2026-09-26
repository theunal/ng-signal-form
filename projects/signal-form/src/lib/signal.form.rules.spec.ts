import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  applyEachRules,
  applyWhenRules,
  createForm,
  max,
  maxDate,
  maxLength,
  minDate,
  minLength,
  pattern,
  required,
} from './signal.form';

function withForm<T>(fn: () => T): T {
  return TestBed.runInInjectionContext(fn);
}

describe('signal-form typed rule wrappers', () => {
  it('max reports the limit on the error', () => {
    const initial = { age: 0 as number | null };
    const form = withForm(() => createForm(initial, (path) => [max(path.age, 18)]));

    expectTypeOf(form.age.errors.max()?.max).toEqualTypeOf<number | undefined>();

    // `max` bir ÜST sınırdır: yalnızca değer sınırı aştığında hata verir
    form.age().value.set(17);
    expect(form.age.errors.max()).toBeUndefined();
    expect(form().valid()).toBe(true);

    form.age().value.set(19);
    expect(form.age.errors.max()?.max).toBe(18);
    expect(form().valid()).toBe(false);

    form.age().value.set(18);
    expect(form.age.errors.max()).toBeUndefined();
    expect(form().valid()).toBe(true);
  });

  it('maxLength reports the limit', () => {
    const initial = { code: '' };
    const form = withForm(() => createForm(initial, (path) => [maxLength(path.code, 4)]));

    expectTypeOf(form.code.errors.maxLength()?.maxLength).toEqualTypeOf<number | undefined>();

    form.code().value.set('abcde');
    expect(form.code.errors.maxLength()?.maxLength).toBe(4);
    expect(form().valid()).toBe(false);

    form.code().value.set('abcd');
    expect(form.code.errors.maxLength()).toBeUndefined();
    expect(form().valid()).toBe(true);
  });

  it('minDate and maxDate bracket a date range', () => {
    const low = new Date(2020, 0, 1);
    const high = new Date(2020, 11, 31);
    const initial = { at: low as Date | null };

    const form = withForm(() =>
      createForm(initial, (path) => [minDate(path.at, low), maxDate(path.at, high)]),
    );

    expectTypeOf(form.at.errors.minDate()?.minDate).toEqualTypeOf<Date | undefined>();
    expectTypeOf(form.at.errors.maxDate()?.maxDate).toEqualTypeOf<Date | undefined>();

    form.at().value.set(new Date(2019, 0, 1));
    expect(form.at.errors.minDate()?.minDate).toEqual(low);
    expect(form().valid()).toBe(false);

    form.at().value.set(new Date(2021, 0, 1));
    expect(form.at.errors.minDate()).toBeUndefined();
    expect(form.at.errors.maxDate()?.maxDate).toEqual(high);
    expect(form().valid()).toBe(false);

    form.at().value.set(new Date(2020, 5, 15));
    expect(form().valid()).toBe(true);
  });

  it('pattern reports the regex', () => {
    const initial = { code: '' };
    const form = withForm(() =>
      createForm(initial, (path) => [pattern(path.code, /^[A-Z]{3}-\d{4}$/)]),
    );

    expectTypeOf(form.code.errors.pattern()?.pattern).toEqualTypeOf<RegExp | undefined>();

    form.code().value.set('abc-1234');
    expect(form.code.errors.pattern()?.pattern).toEqual(/^[A-Z]{3}-\d{4}$/);
    expect(form().valid()).toBe(false);

    form.code().value.set('ABC-1234');
    expect(form.code.errors.pattern()).toBeUndefined();
    expect(form().valid()).toBe(true);
  });

  it('keeps kinds per field', () => {
    const initial = { age: 0 as number | null, name: '' };
    const form = withForm(() =>
      createForm(initial, (path) => [max(path.age, 18), pattern(path.name, /^[a-z]+$/)]),
    );

    expectTypeOf(form.age.errors.max).toBeFunction();
    expectTypeOf(form.name.errors.pattern).toBeFunction();

    // @ts-expect-error — 'max' yalnızca age alanına eklendi
    form.name.errors.max;

    // @ts-expect-error — 'pattern' yalnızca name alanına eklendi
    form.age.errors.pattern;
  });
});

describe('signal-form applyEachRules / applyWhenRules', () => {
  it('applies the nested rule list to every array element', () => {
    const initial = { tags: ['', ''] };
    const form = withForm(() =>
      createForm(initial, (path) => [
        required(path.tags),
        applyEachRules(path.tags, (item) => [required(item), minLength(item, 2)]),
      ]),
    );

    form.tags[0]().value.set('a');
    expect(form.tags[0]().valid()).toBe(false);

    form.tags[1]().value.set('b');
    expect(form.tags[1]().valid()).toBe(false);

    form.tags[0]().value.set('alpha');
    expect(form.tags[0]().valid()).toBe(true);
    expect(form.tags[1]().valid()).toBe(false);

    form.tags[1]().value.set('beta');
    expect(form().valid()).toBe(true);
  });

  it('exposes the nested kinds on the element error accessor', () => {
    const initial = { tags: [''] };
    const form = withForm(() =>
      createForm(initial, (path) => [
        applyEachRules(path.tags, (item) => [required(item), minLength(item, 2)]),
      ]),
    );

    // dizi öğesi kendi kural listesini taşır
    expectTypeOf(form.tags[0].errors.required).toBeFunction();
    expectTypeOf(form.tags[0].errors.minLength()?.minLength).toEqualTypeOf<number | undefined>();

    form.tags[0]().value.set('a');
    expect(form.tags[0].errors.minLength()?.minLength).toBe(2);
    expect(form.tags[0].errors.required()).toBeUndefined();
  });

  it('applyWhenRules only runs while the condition holds', () => {
    const detailsOn = signal(false);
    const initial = { note: '', details: '' };

    const form = withForm(() =>
      createForm(initial, (path) => [
        applyWhenRules(path, () => detailsOn(), (inner) => [required(inner.details)]),
      ]),
    );

    // koşul kapalıyken kural uygulanmaz
    expect(form.details().valid()).toBe(true);
    expectTypeOf(form.details.errors.required).toBeFunction();
    expect(form.details.errors.required()).toBeUndefined();

    detailsOn.set(true);
    expect(form.details().valid()).toBe(false);
    expect(form.details.errors.required()).toBeDefined();

    detailsOn.set(false);
    expect(form.details().valid()).toBe(true);
  });
});
