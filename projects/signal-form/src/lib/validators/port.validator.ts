import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

// Saf validasyon fonksiyonu
// Not: uad-input, `type="number"` alanlarına da string yazar; bu yüzden
// değer string gelebilir ve Number() ile coerce edilir.
export function portError(v: number | string): string | null {
  if (v === null || v === undefined || v === '')
    return null;

  const port = Number(v);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Port 1-65535 arasında olmalıdır.';
  }

  return null;
}

export function portValidate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<number, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.whenNumber && !config.whenNumber(ctx)) {
      return null;
    }

    const message = portError(ctx.value());
    if (!message) return null;

    return {
      kind: 'port',
      message: config?.messageNumber
        ? (typeof config.messageNumber === 'function' ? config.messageNumber(ctx) : config.messageNumber)
        : message,
    };
  });
}