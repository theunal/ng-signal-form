import {
    validate,
    PathKind,
    SchemaPath,
    SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

// Her bir label (nokta arası parça): harf/rakam ile başlayıp biter,
// içeride harf, rakam ve tire olabilir. Tek karakterli label de geçerli.
const LABEL_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

// Saf validasyon fonksiyonu
export function fqdnError(v: string): string | null {
    if (!v || !v.trim())
        return null;

    const trimmed = v.trim().replace(/\.$/, ''); // sondaki tek nokta (root) toleranslı

    // Toplam uzunluk kontrolü (RFC 1035: en fazla 253 karakter)
    if (trimmed.length > 253) {
        return 'Geçerli bir domain FQDN girin (örn. sirket.local).';
    }

    const labels = trimmed.split('.');

    const isValid =
        labels.length >= 2 &&
        labels.every((l) => l.length > 0 && l.length <= 63 && LABEL_RE.test(l)) &&
        // son label (TLD) sadece rakamlardan oluşamaz
        !/^\d+$/.test(labels[labels.length - 1]);

    if (!isValid) {
        return 'Geçerli bir domain FQDN girin (örn. sirket.local).';
    }

    return null;
}

export function fqdnValidate<TPathKind extends PathKind = PathKind.Root>(
    path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
    config?: ValidatorConfig<TPathKind>
): void {
    validate(path, (ctx) => {
        if (config?.when && !config.when(ctx)) {
            return null;
        }

        const message = fqdnError(ctx.value());
        if (!message) {
            return null;
        }

        return {
            kind: 'fqdn',
            message: config?.message
                ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
                : message,
        };
    });
}