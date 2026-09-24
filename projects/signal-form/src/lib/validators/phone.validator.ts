import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

export const PHONE_RE = /^\+?[0-9\s()-]{5,20}$/;

/** Pure validation function. */
export function phoneError(v: string): string | null {
  const trimmed = v.trim();
  return trimmed && !PHONE_RE.test(trimmed)
    ? 'Geçerli bir telefon numarası girin (ör. 90 312 000 00 00)'
    : null;
}

export function phoneValidate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.when && !config.when(ctx)) return null;
    const message = phoneError(ctx.value());
    if (!message) return null;
    return {
      kind: 'phone',
      message: config?.message
        ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
        : message,
    };
  });
}