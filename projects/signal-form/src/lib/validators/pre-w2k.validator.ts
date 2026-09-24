import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

const LOGIN_CHARSET = /^[A-Za-z0-9._-]+$/;
const TURKISH_CHARS = /[çÇıİğĞöÖşŞüÜ]/;

/** Pure validation function. */
export function preW2kError(v: string): string | null {
  if (!v.trim()) return 'Windows 2000 öncesi oturum adı zorunludur';
  if (/\s/.test(v)) return 'Boşluk içeremez';
  if (TURKISH_CHARS.test(v)) return 'Türkçe karakter (ç, ğ, ı, ö, ş, ü) kullanılamaz';
  if (!LOGIN_CHARSET.test(v)) return 'Yalnızca a-z, A-Z, 0-9 ve . _ - karakterlerini kullanın';
  if (v.length > 20) return 'En fazla 20 karakter (sAMAccountName)';
  return null;
}

export function preW2kValidate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.when && !config.when(ctx)) return null;
    const message = preW2kError(ctx.value());
    if (!message) return null;
    return {
      kind: 'pre-w2k',
      message: config?.message
        ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
        : message,
    };
  });
}