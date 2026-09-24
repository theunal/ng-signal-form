import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

export const URL_RE = /^(https?:\/\/)?([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(\/\S*)?$/i;

/** Pure validation function. */
export function urlError(v: string): string | null {
  const trimmed = v.trim();
  return trimmed && !URL_RE.test(trimmed)
    ? 'Geçerli bir web adresi girin (ör. https://corp.local)'
    : null;
}

export function urlValidate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.when && !config.when(ctx)) return null;
    const message = urlError(ctx.value());
    if (!message) return null;
    return {
      kind: 'url',
      message: config?.message
        ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
        : message,
    };
  });
}