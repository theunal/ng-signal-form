import { LogicFn, PathKind } from "@angular/forms/signals";

export interface ValidatorConfig<TPathKind extends PathKind = PathKind.Root> {
  when?: LogicFn<string, boolean, TPathKind>;
  message?: string | LogicFn<string, string, TPathKind>;

  whenNumber?: LogicFn<number, boolean, TPathKind>;
  messageNumber?: string | LogicFn<number, string, TPathKind>;

  ctx?: () => any;
  requireHttps?: boolean;
  allowEmpty?: boolean;
}