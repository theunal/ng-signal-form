import {
  validate,
  PathKind,
  SchemaPath,
  SchemaPathRules,
} from '@angular/forms/signals';
import { ValidatorConfig } from './models/ValidatorConfig';

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

/** `scheme://host[:port]` — no path, query or fragment; https unless loopback. */
export function originError(url: string, requireHttps: boolean): string | null {
  const idx = url.indexOf('://');
  if (idx < 0) return 'http:// veya https:// ile başlamalıdır';
  const scheme = url.slice(0, idx).toLowerCase();
  const rest = url.slice(idx + 3);
  const hostPort = rest.split(/[/?#]/)[0] ?? '';
  if (!hostPort) return 'geçerli bir sunucu adresi girin';
  if (rest.slice(hostPort.length).includes('/')) return 'yalnızca kök adres girin (yol içermemeli)';
  if (/[?#]/.test(rest.slice(hostPort.length))) return 'yalnızca kök adres girin (sorgu veya # içermemeli)';
  const colon = hostPort.lastIndexOf(':');
  const host = colon > 0 ? hostPort.slice(0, colon) : hostPort;
  const port = colon > 0 ? hostPort.slice(colon + 1) : '';
  if (!host || /\s/.test(host)) return 'geçerli bir sunucu adresi girin';
  if (port && !/^\d{1,5}$/.test(port)) return 'port 1-65535 arasında olmalıdır';
  if (scheme !== 'http' && scheme !== 'https') return 'http:// veya https:// ile başlamalıdır';
  if (requireHttps && scheme === 'http' && !isLoopbackHost(host)) {
    return 'https adresi zorunludur (yalnızca localhost/127.0.0.1 için http kabul edilir)';
  }
  return null;
}

export function originValidate<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  config?: ValidatorConfig<TPathKind>,
): void {
  validate(path, (ctx) => {
    if (config?.when && !config.when(ctx)) return null;
    const message = originError(ctx.value(), config?.requireHttps ?? false);
    if (!message) return null;
    return {
      kind: 'origin',
      message: config?.message
        ? (typeof config.message === 'function' ? config.message(ctx) : config.message)
        : message,
    };
  });
}