import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

const LOGIN_CHARSET = /^[A-Za-z0-9._-]+$/;
const TURKISH_CHARS = /[çÇıİğĞöÖşŞüÜ]/;

/** sAMAccountName format validation. Empty value is an error (required field). Returns i18n keys. */
export function samError(v: string): string | null {
  if (!v.trim()) return 'validation.sam.required';
  if (/\s/.test(v)) return 'validation.sam.spaces';
  if (TURKISH_CHARS.test(v)) return 'validation.sam.turkish';
  if (!LOGIN_CHARSET.test(v)) return 'validation.sam.charset';
  if (v.length > 64) return 'validation.sam.maxLength';
  return null;
}

/**
 * Same rules as `samError`, but empty value is valid (auto-derived from first+last name).
 * Used in bulk-create where sAMAccountName may be computed automatically. Returns i18n keys.
 */
export function samFormatError(v: string): string | null {
  if (!v.trim()) return null;
  if (/\s/.test(v)) return 'validation.sam.spaces';
  if (TURKISH_CHARS.test(v)) return 'validation.sam.turkish';
  if (!LOGIN_CHARSET.test(v)) return 'validation.sam.charset';
  if (v.length > 64) return 'validation.sam.maxLength';
  return null;
}

export function samValidate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.when && !config.when(ctx)) return null;
    const err = config?.allowEmpty ? samFormatError(ctx.value()) : samError(ctx.value());
    if (!err) return null;
    return {
      kind: 'sam',
      message: config?.message
        ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
        : err,
    };
  });
}