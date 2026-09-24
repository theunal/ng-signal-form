import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** Pure validation function. Returns an i18n key (or null). */
export function customEmailError(v: string): string | null {
  const mail = v.trim();
  return mail && !EMAIL_RE.test(mail) ? 'validation.email.invalid' : null;
}

export function emailValidate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.when && !config.when(ctx)) return null;
    const message = customEmailError(ctx.value());
    if (!message) return null;
    return {
      kind: 'email',
      message: config?.message
        ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
        : message,
    };
  });
}