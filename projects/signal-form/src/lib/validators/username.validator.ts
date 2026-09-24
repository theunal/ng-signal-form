import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

/** Pure validation function. */
export function usernameWhitespaceError(v: string): string | null {
  return /\s/.test(String(v ?? '')) ? 'Kullanıcı adı boşluk içeremez' : null;
}

export function usernameValidate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.when && !config.when(ctx)) return null;
    const message = usernameWhitespaceError(ctx.value());
    if (!message) return null;
    return {
      kind: 'username',
      message: config?.message
        ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
        : message,
    };
  });
}