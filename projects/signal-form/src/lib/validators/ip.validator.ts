import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

/** Pure helper — true when `v` is a valid IPv4 address. */
export function isIpv4(v: string): boolean {
  const parts = v.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Pure validation function. */
export function ipv4Error(v: string): string | null {
  const trimmed = v.trim();
  return trimmed && !isIpv4(trimmed)
    ? 'Geçerli bir IP adresi girin (ör. 10.0.0.15)'
    : null;
}

export function ipv4Validate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.when && !config.when(ctx)) return null;
    const message = ipv4Error(ctx.value());
    if (!message) return null;
    return {
      kind: 'ipv4',
      message: config?.message
        ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
        : message,
    };
  });
}