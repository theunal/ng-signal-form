import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

const WORKSTATION_RE = /^[A-Za-z0-9-]{1,15}$/;

/** Pure validation function. */
export function workstationError(v: string): string | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.split(',').some((p) => !WORKSTATION_RE.test(p.trim()))) {
    return 'Bilgisayar adlarını virgülle ayırın; her ad 1-15 karakter (a-z, 0-9, -)';
  }
  return null;
}

export function workstationValidate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.when && !config.when(ctx)) return null;
    const message = workstationError(ctx.value());
    if (!message) return null;
    return {
      kind: 'workstation',
      message: config?.message
        ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
        : message,
    };
  });
}