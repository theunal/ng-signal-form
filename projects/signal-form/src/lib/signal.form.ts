import {
    computed,
    effect,
    isWritableSignal,
    resource,
    signal,
    untracked,
    type Injector,
    type Signal,
    type WritableSignal,
} from '@angular/core';
import {
    applyEach as ngApplyEach,
    applyWhen as ngApplyWhen,
    disabled as disabledRule,
    email as ngEmail,
    form,
    isFieldTree,
    max as ngMax,
    maxDate as ngMaxDate,
    maxLength as ngMaxLength,
    min as ngMin,
    minDate as ngMinDate,
    minLength as ngMinLength,
    pattern as ngPattern,
    required as ngRequired,
    validate,
    validateAsync,
    validateTree,
    type FieldContext,
    type FieldState,
    type FieldTree,
    type FormOptions,
    type LogicFn,
    type PathKind,
    type SchemaFn,
    type SchemaPath,
    type SchemaPathRules,
    type SchemaPathTree,
    type ValidationError,
} from '@angular/forms/signals';
import type {
    EmailValidationError,
    MaxDateValidationError,
    MaxLengthValidationError,
    MaxValidationError,
    MinDateValidationError,
    MinLengthValidationError,
    MinValidationError,
    PatternValidationError,
    ReadonlyArrayLike,
    RequiredValidationError,
    StandardSchemaValidationError,
} from '@angular/forms/signals';

/**
 * Tip takma adları. Hepsi doğrudan `@angular/forms/signals` tiplerine çözülür;
 * yeni bir soyutlama katmanı eklenmez, sadece okunabilirlik sağlanır.
 */

/** `createForm` ikinci parametresi: `(path) => { required(path.x) ... }`. */
export type FormSchema<TModel> = (path: SchemaPathTree<TModel>) => void;

/**
 * Herhangi bir derinlikteki (root / child / array item) tek bir alanın path'i.
 * Özel kurallar bu tipi kabul ederek `path.x`, `path.a.b`, `applyEach` içindeki
 * `item.y` gibi tüm path türleriyle çalışır.
 */
export type FieldPath<TValue, TPathKind extends PathKind = PathKind.Root> = SchemaPath<
    TValue,
    SchemaPathRules.Supported,
    TPathKind
>;

type ModelInput<TModel> = TModel | WritableSignal<TModel>;

/**
 * Yardımcılar için gevşek FieldTree: her model tipiyle (varyans bağımsız) uyumludur.
 * Iterator erişimi `childEntries` içinde `unknown` cast'i ile yapılır.
 */
type LooseFieldTree = () => FieldState<any>;

const toModel = <TModel>(input: ModelInput<TModel>): WritableSignal<TModel> =>
    isWritableSignal(input) ? (input as WritableSignal<TModel>) : signal(input as TModel);

/**
 * Değerin bağımsız bir kopyasını döndürür. `structuredClone` desteklemeyen
 * değerlerde (fonksiyon içeren objeler vb.) referansın kendisine düşer.
 */
function cloneValue<T>(value: T): T {
    try {
        return structuredClone(value);
    } catch {
        return value;
    }
}

/**
 * `createForm` anında yakalanan başlangıç değeri.
 *
 * Angular'ın `form().reset()`i argümansız çağrıldığında yalnızca touched/dirty
 * sıfırlar, value'yu başlangıca almaz — eski `form.reset()` davranışını
 * {@link resetForm} bu snapshot ile taklit eder.
 *
 * Snapshot kopya olarak saklanır; dışarıdaki objenin yerinde (mutasyonla)
 * değiştirilmesi reset değerini bozmaz.
 */
const initialValues = new WeakMap<object, unknown>();

/**
 * `validateForm()` istek sayaçları, forma (root `FieldState`) özel.
 * `validateOnChange: false` doğrulayıcılar yalnızca kendi formlarının sayacı
 * arttığında çalışır; böylece formlar birbirini tetiklemez.
 */
const manualValidationRequests = new WeakMap<object, WritableSignal<number>>();

/**
 * Şema derlenirken aktif formun root path'i. Angular şemaları `form()` içinde
 * senkron derler ve derleme önbelleğini her form için sıfırlar, bu yüzden
 * burada yakalanan path her zaman doğru formu gösterir.
 */
let compilingRootPath: SchemaPath<unknown> | undefined;

/**
 * Angular Signal Forms (`form()`) üzerine ince bir sarmalayıcı.
 *
 * - Başlangıç değeri düz obje ya da mevcut bir `WritableSignal` olabilir.
 * - İkinci parametre Angular'ın `SchemaFn<TModel>` tipidir; bu nedenle `path`
 *   `SchemaPathTree<TModel>` olarak Angular'dan birebir gelir.
 * - Injection context dışında çağrılacaksa `options.injector` verilmelidir.
 * - `options.disabled` verilirse root path üzerinde `disabled({ when })` kuralları
 *   ile formun tamamı reaktif olarak disable edilir.
 *
 * ## Şema iki biçimde yazılır
 *
 * **1. Kural listesi (önerilen — alan bazlı tip güvenliği):**
 *
 * ```ts
 * const initial: FormModel = { name: '', email: '', consent: false };
 *
 * const form = createForm(initial, (path) => [
 *     required(path.name, { message: 'name zorunlu' }),
 *     minLength(path.name, 2),
 *     email(path.email),
 *     customValidator(path.name),
 * ]);
 *
 * form.name.errors.customValidator()?.message; // ✓
 * form.name.errors.email();                     // ✗ derleme hatası: email → name'e eklenmedi
 * form.name.errors.maxDate();                   // ✗ derleme hatası: hiç eklenmedi
 * ```
 *
 * Her alanın `errors` erişimcisi **yalnızca o alana eklenen** kuralların
 * `CustomValidationError<TKind>` tiplerini içerir. Bir kural silindiğinde
 * `form.x.errors.kural` derleme hatası verir; enum/interfacede tanım gerekmez.
 * `formErrors` / `fieldErrors` de aynı listeden otomatik çıkarım yapar.
 *
 * > **`TModel`'i açıkça yazmayın.** TypeScript kısmi generic listesinde kalan
 * > generic'i çıkaramaz, default'una düşürür. `createForm<FormModel>(initial, (path) => [...])`
 * > çağrısında `TRules = void` olur ve tipler **gevşer** — aşağıdaki bloklu form
 * > davranışına düşer. Bunun yerine ya hiç generic yazmayın ya da modeli başlangıç
 * > değişkenine annotate edin:
 * >
 * > ```ts
 * > const initial: FormModel = { name: '', email: '', consent: false };
 * > createForm(initial, (path) => [ required(path.name) ]);  // ✓ TModel + TRules çıkarılır
 * > createForm({ name: '', email: '' }, (path) => [ ... ]);  // ✓ obje literalinden çıkarılır
 * > ```
 *
 * **2. Blok gövde (void) — okunur ama alan bazlı değil:**
 *
 * ```ts
 * createForm<FormModel>(initial, (path) => {
 *     required(path.name, { message: 'name zorunlu' });
 *     customValidator(path.name);
 * });
 * ```
 *
 * TypeScript bir callback'in **gövdesindeki ifade ifadelerini göremez**; bu
 * yüzden burada hangi kuralın hangi alana eklendiği çıkarılamaz ve `errors`
 * uygulama-geneli {@link FieldErrorKinds} + {@link CustomErrorKinds} ile gevşer.
 * Sonuç: `form.name.errors.email()` derlenir (ama çalışma zamanında `undefined`
 * döner) ve `form.name.errors.customValidator()` ancak kind `CustomErrorKinds`'e
 * bildirildiyse nokta erişimlidir.
 *
 * Bu form **yalnızca** geri dönüşsüz kurallar gerektiğinde ya da kural
 * listesinin okunabilirliğini feda etmeye razı olduğunuzda tercih edilmelidir.
 *
 * **Geri dönüşsüz kurallar** (`disabled`, `hidden`, `readonly`, `debounce`,
 * `validate`, `validateAsync`, `validateTree`, `apply`, `applyEach`, `applyWhen`,
 * `validateFormAsync`, ...) diziye **giremez**. İkisi birlikte gerekiyorsa blok
 * gövde + `return` karışımını kullanın — tip yine tam güvenlidir:
 *
 * ```ts
 * const f = createForm(initial, (path) => {
 *     disabled(path.address, { when: () => hasAddress() }); // void — blokta kalır
 *     debounce(path.note, 300);                              // void — blokta kalır
 *     return [                                               // ← tipli kural listesi
 *         required(path.email),
 *         matchField(path.confirm, path.password),
 *     ];
 * });
 * ```
 *
 * `void` döndüren bir doğrulayıcıyı (ör. kendi `validate(path, ...)` fonksiyonunuzu)
 * kural listesine almak için {@link defineRule} ile sarmalayın.
 *
 * @example
 * ```ts
 * const initial: FormState = { givenName: '', sam: '', customAttrs: [] };
 *
 * const userForm = createForm(initial, (path) => [
 *     required(path.givenName, { message: 'Ad zorunludur' }),
 *     customValidator(path.sam),
 * ]);
 *
 * userForm.sam.errors.customValidator()?.message; // ✓
 * userForm.sam.errors.required();                  // ✗ derleme hatası
 * ```
 */
export function createForm<TModel, TRules extends RuleList | void = void>(
    initial: ModelInput<TModel>,
    schema?: (path: TypedPathTree<TModel>) => TRules,
    options?: CreateFormOptions<TModel>,
): SignalFormTree<TModel, TRules> {
    const model = toModel(initial);
    const { disabled: disabledOption, ...formOptions } = options ?? {};
    const schemaFn: SchemaFn<TModel> = (path) => {
        const previousRootPath = compilingRootPath;
        compilingRootPath = path as SchemaPath<unknown>;

        try {
            if (disabledOption !== undefined) {
                disabledRule(path as SchemaPath<TModel>, {
                    when: typeof disabledOption === 'function'
                        ? () => disabledOption()
                        : () => disabledOption,
                });
            }
            schema?.(path as unknown as TypedPathTree<TModel>);
        } finally {
            compilingRootPath = previousRootPath;
        }
    };

    const tree =
        Object.keys(formOptions).length > 0
            ? form(model, schemaFn, formOptions)
            : form(model, schemaFn);

    const rootState = untracked(tree as unknown as LooseFieldTree);
    initialValues.set(rootState, cloneValue(untracked(model)));
    manualValidationRequests.set(rootState, signal(0));

    return withErrors(tree) as SignalFormTree<TModel, TRules>;
}

/**
 * Gevşek moddaki (şema kural dizisi döndürmüyor) `errors` erişimcisinin
 * **yerleşik** hata türleri.
 *
 * Özel (custom) doğrulayıcı kind'leri buraya eklenmez; bunun yerine
 * {@link CustomErrorKinds} ambient registry'si kullanılır.
 *
 * Tipli mod (şema kural listesi döndürüyor) için de buraya ekleme gerekmez:
 * her alanın hata türleri kuralların `CustomValidationError<TKind>` tiplerinden
 * otomatik çıkarılır.
 */
export interface FieldErrorKinds {
    required: RequiredValidationError;
    min: MinValidationError;
    max: MaxValidationError;
    minDate: MinDateValidationError;
    maxDate: MaxDateValidationError;
    minLength: MinLengthValidationError;
    maxLength: MaxLengthValidationError;
    pattern: PatternValidationError;
    email: EmailValidationError;
    standardSchema: StandardSchemaValidationError;
    requiredTrue: ValidationError.WithFieldTree;
    match: ValidationError.WithFieldTree;
    requiredWhen: ValidationError.WithFieldTree;
    asyncValidation: ValidationError.WithFieldTree;
}

/**
 * Blok (void) şemada tanımlı **özel doğrulayıcı** hata kind'leri.
 *
 * ### Ne zaman gerekli
 *
 * TypeScript bir callback'in gövdesindeki ifade ifadelerini göremez:
 * `(path) => { nameValidator(path.name); }` ifadesinden hangi kuralın eklendiği
 * çıkarılamaz. Bu yüzden iki şema biçimi vardır:
 *
 * - **Kural listesi döndürüyorsanız** (`(path) => [nameValidator(path.name)]`)
 *   hiçbir şey yapmanıza gerek yok — kind'lar kurallardan **otomatik** çıkarılır
 *   ve hatta *hangi alana* eklendiği bilinir. **Tercih edilen yol budur.**
 * - **Blok gövde kullanıyorsanız** kind'leri burada bir kez bildirmeniz gerekir.
 *
 * ### Kapsam uyarısı
 *
 * Bu registry **uygulama-genelidir**, alan bazlı değildir. Bildirilen bir kind
 * tüm formlardaki tüm alanlarda `errors.<kind>()` olarak erişilebilir olur —
 * kuralın o alana gerçekten eklendiği doğrulanmaz (eklenmemişse çalışma zamanında
 * `undefined` döner). Aynı sebeple `FieldErrorKinds` içindeki yerleşik kind'lar da
 * blok gövdede her alanda görünür. **Alan bazlı doğruluk için kural listesi
 * formunu kullanın.**
 *
 * Tip seviyesinde bir bildirimdir; çalışma zamanında hiçbir maliyeti yoktur.
 *
 * @example
 * ```ts
 * // validators.ts
 * export const nameValidator = defineValidator('nameValidator', (value: string) =>
 *     value.length > 2 || 'name çok kısa',
 * );
 * export const validators = [nameValidator];
 *
 * // app.d.ts (veya validators.ts'in sonunda) — hata tipleri türetilir
 * declare module 'ng-signal-form' {
 *     interface CustomErrorKinds extends ValidatorKindsOf<typeof validators> {}
 * }
 * // ya da elle:
 * declare module 'ng-signal-form' {
 *     interface CustomErrorKinds {
 *         nameValidator: CustomValidationError<'nameValidator'>;
 *     }
 * }
 *
 * // artık nokta erişimli:
 * const form = createForm<FormModel>(initial, (path) => {
 *     required(path.name, { message: 'name zorunlu' });
 *     nameValidator(path.name);
 * });
 *
 * form.name.errors.nameValidator();        // Signal<CustomValidationError<'nameValidator'> | undefined>
 * form.name.errors.nameValidator()?.message;
 * ```
 *
 * Kural listesi döndüren (tipli) şemalarda bu registry **kullanılmaz** — kind'lar
 * zaten kurallardan çıkarıldığı için ek bildirim gerekmez ve bir kural kaldırıldığında
 * `errors.<kind>` derleme hatası vermeye devam eder.
 */
export interface CustomErrorKinds {}

/** Kayıt altındaki tüm hata kind'ları: yerleşik + {@link CustomErrorKinds}. */
export type AnyErrorKindMap = FieldErrorKinds & CustomErrorKinds;

/**
 * {@link SignalFormTree} üzerindeki **fantom marka**: alanın değer tipi, kural
 * listesi, form yolu ve ebeveyn anahtarını taşır. Yalnızca tip seviyesindedir.
 *
 * Neden gerekli: `fieldErrors` / `formErrors` / `stateOf` gibi yardımcılar
 * generic'lerini ağacın **yapısal** tipinden çıkarmaya çalışınca TypeScript,
 * `SignalFormTree`'in (özyinelemeli alt alanlar + koşullu `errors`/`helpers`
 * kesişimleri) kendisini generic parametreye karşı eşleştirmek zorunda kalıyor
 * ve "excessively deep and possibly infinite" (TS2589) hatasına düşüyordu.
 * Marka üzerinden çıkarım yapılandırmasız ve derinlikten bağımsızdır.
 */
export type FormRulesRef<
    TValue,
    TRules,
    TKey extends string,
    TParentKey extends string | number,
> = {
    readonly [rulesRefBrand]: {
        readonly value: TValue;
        readonly rules: TRules;
        readonly key: TKey;
        readonly parent: TParentKey;
    };
};

/**
 * Alan başına hata erişimcisi. Her tür bir signal'dir: hata varsa hata objesini,
 * yoksa `undefined` döner.
 *
 * - `FieldErrorKinds` + `CustomErrorKinds` içindeki türler **nokta** erişimlidir
 *   (`errors.required()`, `errors.nameValidator()`) ve `noPropertyAccessFromIndexSignature`
 *   açık projelerde de derlenir.
 * - Bunların dışındaki türler `errors['bilinmeyen']()` ile okunabilir; dinamik
 *   erişim için `errors.any(kind)` kullanılabilir.
 */
export type FieldErrorSignals = {
    readonly [K in keyof AnyErrorKindMap]: Signal<AnyErrorKindMap[K] | undefined>;
} & {
    /** Dinamik kind erişimi: `errors.any('nameValidator')()`. */
    readonly any: (kind: string) => Signal<ValidationError.WithFieldTree | undefined>;
} & {
    readonly [kind: string]: Signal<ValidationError.WithFieldTree | undefined>;
};

// ---------------------------------------------------------------------------
// Tipli kurallar: şemanın döndürdüğü kurallardan alan başına hata türleri
// ---------------------------------------------------------------------------

declare const pathKeyBrand: unique symbol;
declare const ruleBrand: unique symbol;
declare const validatorBrand: unique symbol;
declare const rulesRefBrand: unique symbol;

/**
 * Path'in formdaki konumunu (`'name'`, `'address.city'`, `'items.#.title'`)
 * taşıyan fantom marka. Yalnızca tip seviyesinde vardır; çalışma zamanında
 * path objesine hiçbir şey eklenmez.
 */
export type PathKeyBrand<TKey extends string> = { readonly [pathKeyBrand]?: TKey };

/** Dizi öğeleri için konum segmenti: `items.#`. */
type ItemSegment = '#';

type ChildKey<TParent extends string, K extends PropertyKey> = TParent extends ''
    ? `${K & (string | number)}`
    : `${TParent}.${K & (string | number)}`;

/**
 * Angular `SchemaPathTree` ile aynı yapı; her path ek olarak kendi konumunu
 * (`PathKeyBrand`) taşır. `SchemaPathTree<TModel>` ve `SchemaPath` bekleyen
 * tüm Angular API'lerine doğrudan verilebilir.
 */
export type TypedPathTree<
    TModel,
    TKey extends string = '',
    TPathKind extends PathKind = PathKind.Root,
> = SchemaPath<TModel, SchemaPathRules.Supported, TPathKind> &
    PathKeyBrand<TKey> &
    ([TModel] extends [ReadonlyArray<any>]
        ? unknown
        : TModel extends Record<string, any>
        ? {
            readonly [K in keyof TModel]: MaybeTypedPathTree<
                TModel[K],
                ChildKey<TKey, K>,
                PathKind.Child
            >;
        }
        : unknown);

type MaybeTypedPathTree<TModel, TKey extends string, TPathKind extends PathKind> =
    | (TModel & undefined)
    | TypedPathTree<Exclude<TModel, undefined>, TKey, TPathKind>;

/** Hata türü `kind` alanından okunur: `{ kind: 'customValidator'; ... }`. */
type AnyError = { readonly kind: string };

/**
 * Bir kuralın tip seviyesindeki izi: hangi alana (`TKey`) hangi hatayı
 * (`TError`, türü `TError['kind']`) ekler. Çalışma zamanında boş bir token'dır.
 */
export interface FieldRule<TKey extends string = string, TError extends AnyError = AnyError> {
    readonly [ruleBrand]: { readonly key: TKey; readonly error: TError };
}

/** Şemanın döndürebileceği kural listesi (iç içe diziler düzleştirilir). */
export type RuleList = readonly (FieldRule<any, any> | RuleList)[];

type FlatRules<T> =
    T extends FieldRule<any, any> ? T : T extends readonly (infer E)[] ? FlatRules<E> : never;

type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type ErrorsAtKey<TRule, TKey extends string> =
    TRule extends FieldRule<infer K, infer E extends AnyError>
    ? IsExact<K, TKey> extends true
    ? E
    : never
    : never;

/**
 * Şema kural listesindeki tüm hata `kind`'larının union'ı.
 *
 * Enum/interfaceden değil, kuralların `CustomValidationError<TKind>` tiplerinden
 * (yani `defineValidator` / `matchField` / `requiredWhen` çağrularından) tamamen
 * otomatik türetilir:
 *
 * ```ts
 * const f = createForm(initial, (path) => [matchField(path.confirm, path.password)]);
 * type Kinds = RuleKinds<typeof ...> // 'required' | 'match'
 * ```
 *
 * `TRules` `void` ise (bloklı/gevşek şema) `never` döner.
 */
export type RuleKinds<TRules> =
    FlatRules<TRules> extends infer R
        ? R extends FieldRule<any, infer E extends AnyError> ? E['kind'] : never
        : never;

/**
 * `TRules` içinde yalnızca `TKey` alanına eklenen kuralların hata kind union'ı.
 * {@link TypedFieldErrorSignals} ile aynı eşleşmeyi (`IsExact`) kullanır.
 *
 * `TRules` `void` ya da bu anahtara kural eklenmemişse `never`.
 *
 * `void` (bloklı şema) için kısa devre şart: aksi halde `FlatRules<void>` →
 * `never` → `infer E extends AnyError` zinciri, `fieldErrors`/`formErrors`
 * overload'larında generic çıkarımı sırasında "excessively deep" hatasına
 * (TS2589) yol açıyor.
 */
export type ErrorKindsAt<TRules, TKey extends string> = [TRules] extends [void]
    ? never
    : FlatRules<TRules> extends infer R
    ? R extends FieldRule<infer K, infer E extends AnyError>
        ? IsExact<K, TKey> extends true ? E['kind'] : never
        : never
    : never;

/**
 * Tipli şemalarda alan başına hata erişimcisi: yalnızca bu alana eklenmiş
 * kuralların türleri vardır. Kural kaldırılınca erişim derleme hatası olur.
 */
export type TypedFieldErrorSignals<TRules, TKey extends string> = {
    readonly [E in ErrorsAtKey<FlatRules<TRules>, TKey> as E['kind']]: Signal<E | undefined>;
};

/** Kural fonksiyonlarının döndürdüğü paylaşılan token (tip seviyesinde markalı). */
const RULE_TOKEN: unknown = Object.freeze({});

const ruleToken = <TRule extends FieldRule<any, any>>(): TRule => RULE_TOKEN as TRule;

/** Özel doğrulayıcıların hata tipi: `{ kind, message?, fieldTree } & ekstra alanlar`. */
export type CustomValidationError<
    TKind extends string,
    TExtra extends object = {},
> = ValidationError.WithFieldTree & { readonly kind: TKind } & Readonly<TExtra>;

type ErrorSignalsFor<TRules, TKey extends string> = [TRules] extends [void]
    ? FieldErrorSignals
    : TypedFieldErrorSignals<TRules, TKey>;

type ErrorsProperty<TModel, TRules, TKey extends string> = [TModel] extends [object]
    ? 'errors' extends keyof TModel
    ? object
    : { readonly errors: ErrorSignalsFor<TRules, TKey> }
    : { readonly errors: ErrorSignalsFor<TRules, TKey> };

type MaybeSignalFormTree<TModel, TRules, TKey extends string, TParentKey extends string | number> =
    | (TModel & undefined)
    | SignalFormTree<Exclude<TModel, undefined>, TRules, TKey, TParentKey>;

type SignalSubfields<TModel, TRules, TKey extends string> =
    TModel extends ReadonlyArray<infer TItem>
    ? ReadonlyArrayLike<MaybeSignalFormTree<TItem, TRules, ChildKey<TKey, ItemSegment>, number>>
    : TModel extends Record<string, any>
    ? {
        readonly [K in keyof TModel as TModel[K] extends Function
        ? never
        : K]: MaybeSignalFormTree<
            TModel[K],
            TRules,
            ChildKey<TKey, K>,
            K & (string | number)
        >;
    }
    : object;

/**
 * Kök `FieldTree`'e bağlı yardımcılar. Angular `FieldTree` yalnızca çağrılabilir
 * bir state'tir; bu metotlar eski `FormGroup` alışkanlıklarını (`setValue`,
 * `patchValue`, `reset`, `markAllTouched`, ...) doğrudan ağacın üzerinde sunar.
 *
 * Modelde aynı isimli bir alan varsa yardımcı **eklenmez** (veri alanı önceliklidir);
 * bu durumda ilgili fonksiyonel yardımcı doğrudan import edilip çağrılabilir.
 */
export interface FormTreeHelpers<TModel> {
    /** Tüm form değerini değiştirir (`value.set(...)` ile aynı). */
    readonly setValue: (value: TModel) => void;
    /** Kısmi güncelleme (eski `form.patchValue`). */
    readonly patchValue: (patch: Partial<TModel>) => void;
    /** Başlangıç değerine döndürür, dirty/touched sıfırlar (bkz. {@link resetForm}). */
    readonly reset: (options?: ResetFormOptions<TModel>) => void;
    /** Tüm alanları touched yapar. */
    readonly markAllTouched: () => void;
    /** Tüm alanları untouched yapar, dirty korunur. */
    readonly markAllUntouched: () => void;
    /** Tüm alanları dirty yapar. */
    readonly markAllDirty: () => void;
    /** Tüm alanları pristine yapar, touched korunur. */
    readonly markAllPristine: () => void;
    /** Yalnızca enabled alanların değerleri (reaktif bağlamda `computed` ile kullanın). */
    readonly enabledValue: () => Partial<TModel>;
    /** `'disabled' > 'pending' > 'valid' | 'invalid'` öncelikli durum sinyali. */
    readonly status: Signal<ControlStatus>;
}

/** Modelde çakışan anahtarları eleyen yardımcı property tipi. */
type HelpersProperty<TModel, THelpers> = {
    readonly [K in keyof THelpers as K extends keyof TModel ? never : K]: THelpers[K];
};

/**
 * Angular `FieldTree` + her seviyede `errors` erişimcisi:
 * `form.username.errors.minLength()?.minLength`.
 *
 * - `TRules` = `void` (şema dizi döndürmüyor): `errors` gevşektir
 *   (`FieldErrorKinds` + `CustomErrorKinds` + her string anahtar).
 * - `TRules` = kural listesi: `errors` yalnızca o alana eklenen kuralların
 *   türlerini içerir.
 *
 * `TKey` formdaki **yol** (`'address.city'`), `TParentKey` ise **ebeveyndeki
 * anahtar**dır (`'city'`, dizi öğesi için `number`). `TParentKey`, Angular'ın
 * `FieldTree<TModel, TKey>` generic'i üzerinden `state.keyInParent`'e iletilir.
 *
 * `FieldTree<TModel>`'e atanabilir; Angular API'lerine ve `[formField]`
 * direktifine doğrudan verilebilir. Modelde `errors` adlı bir alan varsa o
 * seviyede alan önceliklidir, hatalar için `fieldErrorSignals()` kullanın.
 */
export type SignalFormTree<
    TModel,
    TRules = void,
    TKey extends string = '',
    TParentKey extends string | number = string | number,
> = FieldTree<TModel, TParentKey> &
    ErrorsProperty<TModel, TRules, TKey> &
    SignalSubfields<TModel, TRules, TKey> &
    FormRulesRef<TModel, TRules, TKey, TParentKey> &
    ([TKey] extends [''] ? HelpersProperty<TModel, FormTreeHelpers<TModel>> : object);

/**
 * Angular `FieldState<TValue, TKey>` + tipli hata erişimi.
 *
 * Angular'da `state.errors` zaten `Signal<ValidationError[]>` olduğu için
 * kind başına erişim `errorOf(kind)` ile sunulur; bu, ağaçtaki
 * `field.errors.<kind>()` erişiminin state üzerindeki karşılığıdır.
 *
 * `TKey` formdaki yol, `TParentKey` ebeveyndeki anahtardır (`keyInParent`).
 */
export type SignalFieldState<
    TValue,
    TParentKey extends string | number = string | number,
    TRules = void,
    TKey extends string = string,
> = FieldState<TValue, TParentKey> & {
    /** `state.errorOf('required')()` / `state.errorOf('nameValidator')()`. */
    readonly errorOf: <TKind extends keyof ErrorSignalsFor<TRules, TKey> & string>(
        kind: TKind,
    ) => ErrorSignalsFor<TRules, TKey>[TKind];
};

type ConfigOf<TFn extends (...args: any[]) => void, TIndex extends number> = Parameters<TFn>[TIndex];

/** Angular `required` + tipli kural. */
export function required<TValue, TPathKind extends PathKind = PathKind.Root, TKey extends string = string>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    config?: ConfigOf<typeof ngRequired<TValue, TPathKind>, 1>,
): FieldRule<TKey, RequiredValidationError> {
    ngRequired(path, config);
    return ruleToken();
}

/** Angular `email` + tipli kural. */
export function email<TPathKind extends PathKind = PathKind.Root, TKey extends string = string>(
    path: FieldPath<string, TPathKind> & PathKeyBrand<TKey>,
    config?: ConfigOf<typeof ngEmail<TPathKind>, 1>,
): FieldRule<TKey, EmailValidationError> {
    ngEmail(path, config);
    return ruleToken();
}

/** Angular `pattern` + tipli kural. */
export function pattern<TPathKind extends PathKind = PathKind.Root, TKey extends string = string>(
    path: FieldPath<string, TPathKind> & PathKeyBrand<TKey>,
    regex: ConfigOf<typeof ngPattern<TPathKind>, 1>,
    config?: ConfigOf<typeof ngPattern<TPathKind>, 2>,
): FieldRule<TKey, PatternValidationError> {
    ngPattern(path, regex, config);
    return ruleToken();
}

type LengthValue = Parameters<typeof ngMinLength>[0] extends SchemaPath<infer V, any, any> ? V : never;

/** Angular `minLength` + tipli kural. */
export function minLength<
    TValue extends LengthValue,
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    length: ConfigOf<typeof ngMinLength<TValue, TPathKind>, 1>,
    config?: ConfigOf<typeof ngMinLength<TValue, TPathKind>, 2>,
): FieldRule<TKey, MinLengthValidationError> {
    ngMinLength(path, length, config);
    return ruleToken();
}

/** Angular `maxLength` + tipli kural. */
export function maxLength<
    TValue extends LengthValue,
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    length: ConfigOf<typeof ngMaxLength<TValue, TPathKind>, 1>,
    config?: ConfigOf<typeof ngMaxLength<TValue, TPathKind>, 2>,
): FieldRule<TKey, MaxLengthValidationError> {
    ngMaxLength(path, length, config);
    return ruleToken();
}

/** Angular `min` + tipli kural. */
export function min<
    TValue extends number | null,
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    value: ConfigOf<typeof ngMin<TValue, TPathKind>, 1>,
    config?: ConfigOf<typeof ngMin<TValue, TPathKind>, 2>,
): FieldRule<TKey, MinValidationError> {
    ngMin(path, value, config);
    return ruleToken();
}

/** Angular `max` + tipli kural. */
export function max<
    TValue extends number | null,
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    value: ConfigOf<typeof ngMax<TValue, TPathKind>, 1>,
    config?: ConfigOf<typeof ngMax<TValue, TPathKind>, 2>,
): FieldRule<TKey, MaxValidationError> {
    ngMax(path, value, config);
    return ruleToken();
}

/** Angular `minDate` + tipli kural. */
export function minDate<
    TValue extends Date | null,
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    value: ConfigOf<typeof ngMinDate<TValue, TPathKind>, 1>,
    config?: ConfigOf<typeof ngMinDate<TValue, TPathKind>, 2>,
): FieldRule<TKey, MinDateValidationError> {
    ngMinDate(path, value, config);
    return ruleToken();
}

/** Angular `maxDate` + tipli kural. */
export function maxDate<
    TValue extends Date | null,
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    value: ConfigOf<typeof ngMaxDate<TValue, TPathKind>, 1>,
    config?: ConfigOf<typeof ngMaxDate<TValue, TPathKind>, 2>,
): FieldRule<TKey, MaxDateValidationError> {
    ngMaxDate(path, value, config);
    return ruleToken();
}

/**
 * Doğrulayıcı sonucunun sözleşmesi (manuel anotasyon için; `defineValidator`
 * imzası bu birleşimi değil, doğrudan `check`in dönüş tipini kullanır):
 * - `true`, `null`, `undefined` → geçerli
 * - `false` → hata (mesaj: çağrıdaki `message` ya da tanımdaki varsayılan)
 * - `string` → hata, mesaj bu string
 * - obje → hata, objenin alanları hataya eklenir (tipli: `errors.x()?.alan`)
 *
 * @example
 * ```ts
 * const check: ValidatorResult<{ min: number }> = (value) => …;
 * ```
 */
export type ValidatorResult<TExtra extends object = {}> = boolean | string | TExtra | null | undefined;

export interface ValidatorCallOptions<TValue, TPathKind extends PathKind = PathKind.Root> {
    message?: string;
    /** `false` döndüğünde doğrulayıcı çalışmaz. */
    when?: LogicFn<TValue, boolean, TPathKind>;
}

/**
 * {@link defineValidator} ile üretilen, şemada `customValidator(path.x)` şeklinde
 * çağrılan kural.
 *
 * `validatorBrand` yalnızca tip seviyesinde bir izdir: {@link ValidatorKindsOf}
 * ve {@link ValidatorKind} yardımcılarının generic bir imzadan (default type
 * argümanları yüzünden `infer` ile güvenilir çıkarılamaz) doğru kind ve hata
 * tipini okuyabilmesini sağlar. Çalışma zamanında hiçbir şey eklemez.
 */
export type ValidatorRule<TKind extends string, TValue, TExtra extends object = {}> = {
    readonly [validatorBrand]: {
        readonly kind: TKind;
        readonly extra: TExtra;
    };
    <TPathKind extends PathKind = PathKind.Root, TKey extends string = string>(
        path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
        options?: ValidatorCallOptions<TValue, TPathKind>,
    ): FieldRule<TKey, CustomValidationError<TKind, TExtra>>;
};

/** Bir {@link ValidatorRule}'ın hata kind'ı. */
export type ValidatorKind<TValidator> = TValidator extends ValidatorRule<infer TKind, any, any>
    ? TKind
    : never;

/**
 * Bir {@link ValidatorRule}'ın ürettiği hata tipi.
 *
 * Marka alanı doğrudan `TExtra`'yı taşır: `CustomValidationError` bir kesişim
 * tipi olduğu için (`WithFieldTree & {kind} & Readonly<TExtra>`) `infer` ondan
 * yalnızca `TExtra` kısmını çıkarır ve hata tipi eksik kalır.
 */
export type ValidatorError<TValidator> = TValidator extends ValidatorRule<
    infer TKind,
    any,
    infer TExtra extends object
>
    ? CustomValidationError<TKind, TExtra>
    : never;

/**
 * Doğrulayıcı listesinden {@link CustomErrorKinds} için augmentation haritası
 * üretir. Hata tipleri (ve varsa ekstra alanlar) doğrulayıcılardan türetilir.
 *
 * ```ts
 * export const validators = [nameValidator, emailFree] as const;
 *
 * declare module 'ng-signal-form' {
 *     interface CustomErrorKinds extends ValidatorKindsOf<typeof validators> {}
 * }
 * ```
 *
 * Ya da doğrudan bir değişken yerine tek doğrulayıcı da verilebilir:
 * `ValidatorKindsOf<[typeof nameValidator]>`.
 */
export type ValidatorKindsOf<TValidators extends readonly ValidatorRule<any, any, any>[]> = {
    readonly [TValidator in TValidators[number] as ValidatorKind<TValidator>]: ValidatorError<TValidator>;
};

/**
 * Tipli özel doğrulayıcı tanımlar. Hata türü `kind` parametresinden gelir;
 * `FieldErrorKinds`'e ekleme yapmaya gerek yoktur.
 *
 * @example
 * ```ts
 * export const customValidator = defineValidator(
 *     'customValidator',
 *     (value: string) => value.startsWith('x') || 'x ile başlamalı',
 * );
 *
 * const f = createForm(initial, (path) => [customValidator(path.name)]);
 * f.name.errors.customValidator()?.message;
 * f.name.errors.customValidator()?.kind; // 'customValidator'
 * ```
 *
 * Doğrulayıcı obje döndürürse ek alanlar **otomatik** hata tipine eklenir
 * (`TExtra`, dönüş tipinden `Extract` ile türetilir):
 *
 * ```ts
 * const minTwo = defineValidator('minTwo', (value: string) =>
 *     value.length >= 2 ? true : { min: 2, actual: value.length },
 * );
 *
 * f.name.errors.minTwo()?.min;    // 2
 * f.name.errors.minTwo()?.actual; // number
 * ```
 */
export function defineValidator<TKind extends string, TValue, TResult>(
    kind: TKind,
    check: (value: TValue, context: FieldContext<TValue, any>) => TResult,
    defaults: { message?: string } = {},
): ValidatorRule<TKind, TValue, ValidatorExtra<TResult>> {
    const rule = (path: unknown, options: ValidatorCallOptions<TValue, any> = {}) => {
        validate(path as FieldPath<TValue, any>, (context) => {
            if (options.when && !options.when(context as FieldContext<TValue, any>)) {
                return undefined;
            }

            const result = check(context.value(), context as FieldContext<TValue, any>);

            if (result === true || result === null || result === undefined) {
                return undefined;
            }

            const message = options.message ?? defaults.message;

            if (result === false) {
                return { kind, message };
            }

            if (typeof result === 'string') {
                return { kind, message: result };
            }

            return { message, ...result, kind };
        });

        return ruleToken();
    };

    // `validatorBrand` yalnızca tip seviyesinde okunur; runtime'da karşılığı yok.
    return rule as unknown as ValidatorRule<TKind, TValue, ValidatorExtra<TResult>>;
}

/**
 * Doğrulayıcının dönüş tipinden hata objesine eklenecek ekstra alanlar.
 *
 * `TExtra`'yı doğrudan `check` dönüş tipinden çıkarmak güvenilir değildir:
 * hedef tip birleşim (`boolean | string | TExtra | ...`) olduğunda TypeScript
 * `true | string` gibi bir kaynak için `TExtra`'ya aday üretir, aday
 * `object` kısıtını sağlamayınca tipe `object` ile düşer ve ekstra alanlar
 * kaybolur. Bu yüzden dönüş tipi (`TResult`) doğrudan çıkarılıp nesne
 * kısmı `Extract` ile ayrılır.
 */
export type ValidatorExtra<TResult> = Extract<TResult, object> extends never
    ? {}
    : Extract<TResult, object>;

/**
 * Mevcut `void` döndüren bir kural fonksiyonunu (ör. kendi `validate(path, ...)`
 * yazdığınız doğrulayıcı) tipli kurala çevirir — böylece **kural listesine**
 * (`(path) => [ ... ]`) girebilir ve `errors.<kind>()` alan bazlı tip kazanır.
 *
 * Yeni doğrulayıcı yazıyorsanız çoğu zaman {@link defineValidator} daha kısadır
 * (kendi `validate` çağrısını yazmanıza gerek kalmaz). `defineRule`, elinizde
 * zaten `void` döndüren bir fonksiyon olduğunda ya da ek parametre alan bir kural
 * kurarken kullanılır.
 *
 * Birden fazla hata türü üretiyorsa hata tipini generic olarak verin.
 *
 * @example
 * ```ts
 * // elle yazılmış void doğrulayıcı → kural listesine alınır
 * const notAdmin = defineRule('notAdmin', (path: FieldPath<string>) =>
 *     validate(path, ({ value }) =>
 *         value() === 'admin' ? { kind: 'notAdmin', message: 'admin kullanılamaz' } : undefined,
 *     ),
 * );
 *
 * const f = createForm(initial, (path) => [required(path.name), notAdmin(path.name)]);
 * f.name.errors.notAdmin()?.message; // ✓
 * f.email.errors.notAdmin;            // ✗ derleme hatası
 * ```
 *
 * @example
 * ```ts
 * export const sam = defineRule('sam', samValidate);
 * // ek parametreli kural — argümanlar şemada verilir:
 * // const reserved = defineRule('reserved', withReserved);
 * // createForm(initial, (path) => [reserved(path.name, { min: 3 })]);
 * // veya: defineRule<'samLength' | 'samChars', string>('samLength', samValidate)
 * ```
 */
export function defineRule<
    TKind extends string,
    TValue,
    TArgs extends unknown[] = [],
    TError extends AnyError = CustomValidationError<TKind>,
>(
    _kind: TKind,
    apply: (path: FieldPath<TValue, any>, ...args: TArgs) => void,
): <TPathKind extends PathKind = PathKind.Root, TKey extends string = string>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    ...args: TArgs
) => FieldRule<TKey, TError> {
    return (path, ...args) => {
        apply(path as FieldPath<TValue, any>, ...args);
        return ruleToken();
    };
}

type RulesOf<TRules> = TRules extends RuleList ? TRules : [];

/**
 * Angular `applyEach` + tipli kurallar. Öğe path'leri `items.#` konumuyla
 * markalanır: `form.items[0].errors.x()` tipli olur.
 */
export function applyEachRules<
    TValue extends ReadonlyArray<any>,
    TKey extends string = string,
    TRules extends RuleList | void = void,
>(
    path: SchemaPath<TValue> & PathKeyBrand<TKey>,
    schema: (item: TypedPathTree<TValue[number], ChildKey<TKey, ItemSegment>, PathKind.Item>) => TRules,
): RulesOf<TRules> {
    ngApplyEach(path as SchemaPath<TValue>, (item) => {
        schema(item as unknown as TypedPathTree<TValue[number], ChildKey<TKey, ItemSegment>, PathKind.Item>);
    });
    return [] as unknown as RulesOf<TRules>;
}

/** Angular `applyWhen` + tipli kurallar (kural koşullu olsa da hata türü tiplidir). */
export function applyWhenRules<
    TValue,
    TKey extends string = string,
    TRules extends RuleList | void = void,
>(
    path: SchemaPath<TValue> & PathKeyBrand<TKey>,
    logic: LogicFn<TValue, boolean>,
    schema: (path: TypedPathTree<TValue, TKey>) => TRules,
): RulesOf<TRules> {
    ngApplyWhen(path as SchemaPath<TValue>, logic, (inner) => {
        schema(inner as unknown as TypedPathTree<TValue, TKey>);
    });
    return [] as unknown as RulesOf<TRules>;
}

const errorSignalsCache = new WeakMap<object, FieldErrorSignals>();
const wrappedTrees = new WeakMap<object, object>();

/**
 * Bir alanın `errors` erişimcisini döndürür (sarılmamış `FieldTree`'lerde de çalışır).
 *
 * Alan `SignalFormTree` ise dönüş, o alanın kural listesinden türeyen
 * {@link TypedFieldErrorSignals} olur (modelde `errors` adlı bir alan varsa
 * `form.x.errors` veri alanını bastırdığı için bu yardımcı tip-güvenli erişimi sağlar).
 */
export function fieldErrorSignals<
    TValue,
    TRules extends RuleList | void,
    TKey extends string,
    TParentKey extends string | number,
>(
    field: (() => any) & FormRulesRef<TValue, TRules, TKey, TParentKey>,
): ErrorSignalsFor<TRules, TKey>;
export function fieldErrorSignals(field: LooseFieldTree): FieldErrorSignals;
export function fieldErrorSignals(field: LooseFieldTree): FieldErrorSignals | object {
    const state = untracked(field);
    const cached = errorSignalsCache.get(state);

    if (cached) {
        return cached;
    }

    const byKind = new Map<string, Signal<ValidationError.WithFieldTree | undefined>>();
    const accessor = new Proxy(Object.create(null) as FieldErrorSignals, {
        get(target, kind) {
            if (typeof kind !== 'string') {
                return Reflect.get(target, kind);
            }

            // `errors.any('bilinmeyenKind')` dinamik erişim için. Proxy tuzağı
            // olduğu için her çağrıda yeni bir closure döner; signal'lar
            // `byKind` içinde önbelleklenir, tekrar `computed` üretilmez.
            if (kind === 'any') {
                return (requested: string) => signalForKind(byKind, state, requested);
            }

            return signalForKind(byKind, state, kind);
        },
    });

    errorSignalsCache.set(state, accessor);
    return accessor;
}

function signalForKind(
    byKind: Map<string, Signal<ValidationError.WithFieldTree | undefined>>,
    state: FieldState<unknown>,
    kind: string,
): Signal<ValidationError.WithFieldTree | undefined> {
    let kindSignal = byKind.get(kind);

    if (!kindSignal) {
        kindSignal = computed(() => state.errors().find((error) => error.kind === kind));
        byKind.set(kind, kindSignal);
    }

    return kindSignal;
}

/**
 * Kök ağaca {@link FormTreeHelpers} metotlarını bağlar.
 *
 * Yardımcı adları modelin kendi alanlarıyla çakışıyorsa **eklenmez** — veri
 * alanı önceliklidir (tipte de aynı kural `HelpersProperty` ile uygulanır).
 */
function createTreeHelpers<TModel extends object>(tree: LooseFieldTree): Record<string, unknown> {
    const model = untracked(tree).value();
    const has = (name: string): boolean =>
        typeof model === 'object' && model !== null && Object.hasOwn(model, name);

    const helpers: Record<string, unknown> = {
        setValue: (value: TModel) => (tree().value as WritableSignal<TModel>).set(value),
        patchValue: (patch: Partial<TModel>) => patchValue(tree as unknown as FieldTree<TModel>, patch),
        reset: (options?: ResetFormOptions<TModel>) => resetForm(tree as unknown as FieldTree<TModel>, options),
        markAllTouched: () => markAllTouched(tree),
        markAllUntouched: () => markAllUntouched(tree),
        markAllDirty: () => markAllDirty(tree),
        markAllPristine: () => markAllPristine(tree),
        enabledValue: () => enabledValue(tree as unknown as FieldTree<TModel>),
        status: computed(() => formStatus(tree)),
    };

    for (const name of Object.keys(helpers)) {
        if (has(name)) {
            delete helpers[name];
        }
    }

    return helpers;
}

function withErrors<TModel>(tree: FieldTree<TModel>): SignalFormTree<TModel> {
    const loose = tree as unknown as LooseFieldTree;

    return wrapTree(loose, createTreeHelpers<TModel & object>(loose)) as unknown as SignalFormTree<TModel>;
}

function wrapTree(tree: LooseFieldTree, helpers?: Record<string, unknown>): LooseFieldTree {
    // Kök ağaç (yardımcılı) asla önbelleklenmez: aynı ağaç ikinci kez sarıldığında
    // yardımcısız bir proxy dönmemesi için.
    const cached = helpers === undefined ? wrappedTrees.get(tree) : undefined;

    if (cached) {
        return cached as LooseFieldTree;
    }

    // Angular'ın proxy'si doğrudan hedef yapılamaz: Proxy değişmez (invariant)
    // kontrolleri onun `getOwnPropertyDescriptor` tuzağını yaprak değerlerde
    // (string, number) çağırır ve hata fırlatır. Bu yüzden boş bir fonksiyon
    // hedef alınıp tüm tuzaklar açıkça Angular ağacına yönlendirilir.
    const proxy: LooseFieldTree = new Proxy(() => tree(), {
        get(_target, property, receiver) {
            if (helpers !== undefined && typeof property === 'string' && Object.hasOwn(helpers, property)) {
                return helpers[property];
            }

            const value = Reflect.get(tree, property, receiver);

            if (property === 'errors' && value === undefined) {
                return fieldErrorSignals(tree);
            }

            if (property === Symbol.iterator && Array.isArray(untracked(tree).value())) {
                const iterate = value as () => Iterator<LooseFieldTree>;
                return function* () {
                    const iterator = iterate();
                    for (let step = iterator.next(); !step.done; step = iterator.next()) {
                        yield wrapTree(step.value);
                    }
                };
            }

            return isFieldTree(value) ? wrapTree(value as unknown as LooseFieldTree) : value;
        },
        has(_target, property) {
            return (
                (helpers !== undefined &&
                    typeof property === 'string' &&
                    Object.hasOwn(helpers, property)) ||
                property === 'errors' ||
                Reflect.has(tree, property)
            );
        },
        ownKeys() {
            const value: unknown = untracked(tree).value();
            return typeof value === 'object' && value !== null ? Reflect.ownKeys(value) : [];
        },
        getOwnPropertyDescriptor(_target, property) {
            const value: unknown = untracked(tree).value();

            if (typeof value !== 'object' || value === null) {
                return undefined;
            }

            const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
            return descriptor ? { ...descriptor, configurable: true } : undefined;
        },
    });

    if (helpers === undefined) {
        wrappedTrees.set(tree, proxy);
    }

    return proxy;
}

/**
 * Bir alanın `FieldState`'ini döndürür; tipli hata erişimi (`errorOf`) ve daraltılmış
 * `keyInParent` eklenir. `form.x()` ile aynı state'i verir, yalnızca üstüne
 * {@link SignalFieldState} tipi eklenir.
 *
 * Modelde `errors` adlı bir alan bulunan düğümlerde `form.x.errors` veri alanına
 * dönüştüğü için hata erişimi bu yardımcı ya da `fieldErrorSignals()` üzerinden yapılır.
 */
export function stateOf<
    TValue,
    TRules extends RuleList | void,
    TKey extends string,
    TParentKey extends string | number,
>(
    field: (() => any) & FormRulesRef<TValue, TRules, TKey, TParentKey>,
): SignalFieldState<TValue, TParentKey, TRules, TKey> {
    const state = untracked(field as unknown as LooseFieldTree) as FieldState<TValue, TParentKey>;
    const errorSignals = fieldErrorSignals(field as unknown as LooseFieldTree);
    const cache = stateHelpers.get(state);

    if (cache) {
        return cache as SignalFieldState<TValue, TParentKey, TRules, TKey>;
    }

    const enhanced = Object.assign(Object.create(null), state, {
        errorOf: (kind: string) => (errorSignals as unknown as Record<string, Signal<unknown>>)[kind],
    }) as SignalFieldState<TValue, TParentKey, TRules, TKey>;

    stateHelpers.set(state, enhanced);
    return enhanced;
}

const stateHelpers = new WeakMap<object, object>();

/** `createForm` seçenekleri: Angular `FormOptions` + sarmalayıcıya özgü alanlar. */
export interface CreateFormOptions<TModel> extends FormOptions<TModel> {
    /**
     * Formun tamamını reaktif olarak disable eder.
     * `true`/`false` sabit değer ya da `Signal<boolean>` verilebilir.
     */
    disabled?: boolean | Signal<boolean>;
}

type RuleOptions<TKind extends string = string> = { message?: string; kind?: TKind };

type MatchOptions<TValue, TKind extends string = string> = RuleOptions<TKind> & {
    /**
     * Özel eşitlik karşılaştırması.
     * Varsayılan: `Object.is`; iki `Date` için zaman damgası karşılaştırılır.
     */
    equals?: (a: TValue, b: TValue) => boolean;
};

/**
 * `options.kind` alanından hata kind'ı çıkarır; verilmediyse `TFallback`.
 *
 * Kural fabrikaları (`matchFields`, `requiredWhenFields`) `TModel`'i açıkça
 * almak zorunda olduğundan, generic listesinde ikinci bir kind generic'i
 * **asla çıkarılamaz** (TS kalan generic'lere default uygular, inference yapmaz).
 * Bu yüzden kind, `const` bir `TOptions` üzerinden literal olarak akıtılır:
 * `{ kind: 'companyRequired' }` → `errors.companyRequired`.
 */
type KindOf<TOptions, TFallback extends string> = TOptions extends { readonly kind: infer TKind extends string }
    ? TKind
    : TFallback;

const isEmptyValue = (value: unknown): boolean =>
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);

/** Koşul (trigger) alanları için "dolu" tanımı: boş değil ve `false` değil. */
const isFilled = (value: unknown): boolean => value !== false && !isEmptyValue(value);

const defaultEquals = (a: unknown, b: unknown): boolean =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : Object.is(a, b);

/** Checkbox / onay alanları için: değer `true` olmalı. */
export function requiredTrue<
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
    TKind extends string = 'requiredTrue',
>(
    path: FieldPath<boolean, TPathKind> & PathKeyBrand<TKey>,
    options: RuleOptions<TKind> = {},
): FieldRule<TKey, CustomValidationError<TKind>> {
    validate(path, ({ value }) =>
        value() === true
            ? undefined
            : { kind: options.kind ?? 'requiredTrue', message: options.message },
    );
    return ruleToken();
}

/**
 * İki alanın aynı değeri taşımasını zorunlu kılar (ör. şifre tekrarı).
 * Hata `path` üzerinde raporlanır; herhangi bir taraf boşken sessiz kalır.
 */
export function matchField<
    TValue,
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
    TKind extends string = 'match',
>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    other: FieldPath<NoInfer<TValue>, PathKind>,
    options: MatchOptions<TValue, TKind> = {},
): FieldRule<TKey, CustomValidationError<TKind>> {
    const equals = options.equals ?? defaultEquals;

    validate(path, ({ value, valueOf }) => {
        const current = value();
        const target = valueOf(other);

        if (isEmptyValue(current) || isEmptyValue(target)) {
            return undefined;
        }

        return equals(current, target)
            ? undefined
            : { kind: options.kind ?? 'match', message: options.message };
    });
    return ruleToken();
}

/**
 * `trigger` alanı dolduğunda `path` alanını zorunlu kılar.
 *
 * Eski `requiredWhen(source, target)` semantiğinin signal-forms karşılığı:
 * burada `path` zorunlu olacak alanın, `trigger` ise koşulu sağlayan alanın
 * path'idir. Hata doğrudan `path` üzerinde `required` (veya `options.kind`)
 * ile raporlanır.
 *
 * @example
 * ```ts
 * (path) => requiredWhen(path.companyName, path.hasCompany, {
 *     message: 'Company name is required',
 *     kind: 'companyRequired',
 * });
 * ```
 */
export function requiredWhen<
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
    TKind extends string = 'required',
>(
    path: FieldPath<unknown, TPathKind> & PathKeyBrand<TKey>,
    trigger: FieldPath<unknown, PathKind>,
    options: RuleOptions<TKind> = {},
): FieldRule<TKey, TKind extends 'required' ? RequiredValidationError : CustomValidationError<TKind>> {
    const when: LogicFn<unknown, boolean, TPathKind> = ({ valueOf }) => isFilled(valueOf(trigger));

    if (options.kind) {
        ngRequired(path, {
            error: { kind: options.kind, message: options.message },
            when,
        });
    } else {
        ngRequired(path, {
            message: options.message,
            when,
        });
    }
    return ruleToken();
}

/**
 * Form-level (root üzerinde) senkron çapraz-alan doğrulama.
 * Hatalar root'un kendi `errors()` listesine düşer; `formErrorBag` ile
 * eski tarz `formErrors()` kaydına dönüştürülebilir.
 *
 * Dönüş değeri bir **kuraldır** (`FieldRule<'', CustomValidationError<TKind>>`),
 * yani iki şekilde de kullanılabilir:
 *
 * - Tipli şemada kural listesine eklenir → `form.errors.match()` derleme zamanında tip-güvenli olur:
 * ```ts
 * const f = createForm(initial, (path) => [
 *     matchFields(path, 'password', 'confirm', { message: 'Eşleşmiyor' }),
 * ]);
 * f.errors.match(); // ✓
 * ```
 * - Bloklı şemada da kullanılabilir (dönüş değeri yok sayılır):
 * ```ts
 * createForm(initial, (path) => { matchFields(path, 'password', 'confirm'); });
 * ```
 *
 * `options.kind` verilirse hata türü (`'match'` yerine) o literal olur ve
 * `errors.<kind>` erişimine yansır. **Generic yazmaya gerek yoktur:**
 * `TModel` `path`'ten, hata kind'ı ise `const` seçenek tipinden çıkarılır
 * (kısmi generic listesi inference'ı durdurduğu için ikinci bir `TKind`
 * generic'i hiçbir zaman çıkarılamazdı):
 *
 * ```ts
 * matchFields(path, 'password', 'confirm', { kind: 'credentialsMatch' });
 * f.errors.credentialsMatch(); // ✓
 * ```
 */
export function matchFields<
    TModel,
    const TOptions extends MatchOptions<unknown, string> = MatchOptions<unknown, string>,
>(
    path: SchemaPathTree<TModel>,
    source: keyof TModel & string,
    target: keyof TModel & string,
    options: TOptions = {} as TOptions,
): FieldRule<'', CustomValidationError<KindOf<TOptions, 'match'>>> {
    const equals = options.equals ?? defaultEquals;
    const fields = path as Record<string, SchemaPath<unknown>>;

    validateTree(path as SchemaPath<unknown>, (ctx) => {
        const sourceValue = ctx.valueOf(fields[source]);
        const targetValue = ctx.valueOf(fields[target]);

        if (isEmptyValue(sourceValue) || isEmptyValue(targetValue)) {
            return undefined;
        }

        return equals(sourceValue, targetValue)
            ? undefined
            : { kind: options.kind ?? 'match', message: options.message };
    });

    return ruleToken();
}

/**
 * `trigger` dolduğunda `target` alanını root-level doğrulama ile zorunlu kılar.
 * Eski API'nin `requiredWhen` + `formErrors()` davranışına en yakın karşılık.
 *
 * Dönüş değeri bir **kuraldır**: tipli şemada kural listesine eklenirse
 * `form.errors.<kind>` (varsayılan `form.errors.requiredWhen`) derleme zamanında
 * tip-güvenli olur; bloklı şemada sonucu yok sayılır:
 *
 * ```ts
 * const f = createForm(initial, (path) => [
 *     requiredWhenFields(path, 'hasCompany', 'companyName', { message: 'Zorunlu' }),
 * ]);
 * f.errors.requiredWhen(); // ✓
 * ```
 *
 * `options.kind` verilirse hata kind'ı o literal olur (`errors.companyRequired`).
 * {@link matchFields} gibi path ilk parametredir; generic yazılmaz.
 */
export function requiredWhenFields<TModel, const TOptions extends RuleOptions = RuleOptions>(
    path: SchemaPathTree<TModel>,
    triggerKey: keyof TModel & string,
    targetKey: keyof TModel & string,
    options: TOptions = {} as TOptions,
): FieldRule<'', CustomValidationError<KindOf<TOptions, 'requiredWhen'>>> {
    const fields = path as Record<string, SchemaPath<unknown>>;

    validateTree(path as SchemaPath<unknown>, (ctx) => {
        const trigger = ctx.valueOf(fields[triggerKey]);
        const target = ctx.valueOf(fields[targetKey]);

        if (!isFilled(trigger) || !isEmptyValue(target)) {
            return undefined;
        }

        return { kind: options.kind ?? 'requiredWhen', message: options.message };
    });

    return ruleToken();
}

// ---------------------------------------------------------------------------
// FieldTree üzerinde yardımcılar (eski FormControl metotlarının sarmalayıcılar)
// ---------------------------------------------------------------------------

/** Eski `ValidationErrors` tarzı hata çantası: `{ required: 'msg' }`. */
export type ErrorValue = boolean | string | undefined;
export type ValidationErrors<TKey extends string = string> = Partial<Record<TKey, ErrorValue>>;

/** `ValidationError[]` → eski tarz `Record<kind, message>` çantası. */
export function errorBag(errors: readonly ValidationError[]): Record<string, ErrorValue> {
    const bag: Record<string, ErrorValue> = {};

    for (const error of errors) {
        bag[error.kind] = error.message ?? true;
    }

    return bag;
}

/**
 * Eski tarz hata çantası → `ValidationError[]`.
 * `false` / `undefined` değerli anahtarlar hata sayılmaz.
 */
export function bagToErrors(bag: ValidationErrors | undefined): ValidationError[] {
    if (!bag) {
        return [];
    }

    return Object.entries(bag)
        .filter(([, value]) => value !== false && value !== undefined)
        .map(([kind, value]) => ({
            kind,
            message: typeof value === 'string' ? value : undefined,
        }));
}

/** Alanın kendi (çocukları hariç) hatalarını eski tarz çantaya çevirir. */
export function fieldErrorBag(state: FieldState<unknown>): Record<string, ErrorValue> {
    return errorBag(state.errors());
}

/** Root-level (form) hataları: eski `formFormErrors()` karşılığı. */
export function formErrorBag(form: LooseFieldTree): Record<string, ErrorValue> {
    return errorBag(form().errors());
}

/** Angular'ın yerleşik kuralları ve bu dosyadaki kuralların ürettiği hata türleri. */
export type BuiltinErrorKind =
    | 'required'
    | 'requiredTrue'
    | 'min'
    | 'max'
    | 'minLength'
    | 'maxLength'
    | 'pattern'
    | 'email'
    | 'match'
    | 'requiredWhen'
    | 'asyncValidation';

/**
 * `errors.required`, `errors.customValidator` gibi erişim için hata haritası.
 * Değer: hata mesajı varsa mesaj, yoksa `true`. Hata yoksa anahtar bulunmaz.
 *
 * Anahtarlar: yerleşik {@link BuiltinErrorKind} + şemadan çıkarılan `TKind` +
 * {@link CustomErrorKinds} registry'si. Böylece bloklu şemada da
 * `formErrors(form)().name.errors.nameValidator` nokta erişimlidir.
 */
export type ErrorMap<TKind extends string = never> = Partial<
    Record<BuiltinErrorKind | TKind | keyof CustomErrorKinds, string | true>
> &
    Record<string, string | true | undefined>;

type ErrorLeafValue =
    | Date
    | File
    | Blob
    | RegExp
    | Map<unknown, unknown>
    | Set<unknown>
    | ((...args: never[]) => unknown);

type ErrorChildren<T, TKind extends string> = T extends ErrorLeafValue
    ? unknown
    : T extends readonly (infer TItem)[]
    ? readonly FormErrors<TItem, TKind>[]
    : T extends object
    ? {
        readonly [K in keyof T]: undefined extends T[K]
        ? FormErrors<T[K], TKind> | undefined
        : FormErrors<T[K], TKind>;
    }
    : unknown;

/**
 * Form modeliyle aynı şekle sahip hata ağacı. Her düğümde `errors` alanın kendi
 * hatalarını tutar: `errors().username.errors.required`.
 * Modelde `errors` adlı bir alan varsa düğümün kendi `errors` haritası önceliklidir.
 */
export type FormErrors<T, TKind extends string = never> = {
    readonly errors: ErrorMap<TKind>;
} & (null extends T
    ? Partial<ErrorChildren<NonNullable<T>, TKind>>
    : ErrorChildren<NonNullable<T>, TKind>);

export interface ErrorSignalOptions {
    /** `true` ise yalnızca `touched` alanların hataları gösterilir. Varsayılan: `false`. */
    onlyTouched?: boolean;
}

const EMPTY_ERRORS: ErrorMap = Object.freeze({});

function toErrorMap(errors: readonly ValidationError[]): ErrorMap {
    if (errors.length === 0) {
        return EMPTY_ERRORS;
    }

    const map: Record<string, string | true> = {};

    for (const error of errors) {
        if (!Object.hasOwn(map, error.kind)) {
            map[error.kind] = error.message ?? true;
        }
    }

    return map;
}

function visibleErrors(state: FieldState<unknown>, onlyTouched: boolean): ErrorMap {
    return onlyTouched && !state.touched() ? EMPTY_ERRORS : toErrorMap(state.errors());
}

function buildErrorNode(tree: LooseFieldTree, onlyTouched: boolean): unknown {
    const state = tree();
    const own = visibleErrors(state, onlyTouched);
    const kids = childEntries(tree);

    if (kids === null) {
        return { errors: own };
    }

    const entries = kids.map((entry): [string, LooseFieldTree] =>
        Array.isArray(entry) ? entry : ['', entry],
    );

    if (Array.isArray(state.value())) {
        const items = entries.map(([, child]) => buildErrorNode(child, onlyTouched));
        Object.defineProperty(items, 'errors', { value: own, enumerable: false });
        return items;
    }

    const node: Record<string, unknown> = {};

    for (const [key, child] of entries) {
        node[key] = buildErrorNode(child, onlyTouched);
    }

    node['errors'] = own;
    return node;
}

/**
 * Tüm formun hatalarını model şeklinde veren reaktif signal.
 *
 * ```ts
 * readonly errors = formErrors(this.form);
 * // TS:       this.errors().username.errors.required
 * // Template: @if (errors().username.errors.customValidator; as msg) { {{ msg }} }
 * ```
 *
 * **Otomatik kind çıkarımı:** `createForm` kural listesi döndüren bir şemayla
 * oluşturulduysa (`(path) => [ ... ]`) `TKind` hiç yazılmaz; kind'lar kuralların
 * `CustomValidationError<TKind>` tiplerinden `RuleKinds` ile otomatik çıkarılır:
 *
 * ```ts
 * const f = createForm(initial, (path) => [matchField(path.confirm, path.password)]);
 * formErrors(f)().errors.match; // ✓ otomatik, elle generic yok
 * ```
 *
 * Bloklı/gevşek şemada (`TRules = void`) kind `never`'dir ve yalnızca yerleşik
 * `BuiltinErrorKind` anahtarları gelir. Elle kind vermek hâlâ mümkündür
 * (eski imza korunur): `formErrors<Model, 'customValidator'>(form)`.
 */
export function formErrors<
    TModel,
    TRules extends RuleList | void,
    TKey extends string,
    TParentKey extends string | number,
>(
    form: (() => any) & FormRulesRef<TModel, TRules, TKey, TParentKey>,
    options?: ErrorSignalOptions,
): Signal<FormErrors<TModel, RuleKinds<TRules> & string>>;
export function formErrors<TModel, TKind extends string = never>(
    form: FieldTree<TModel>,
    options?: ErrorSignalOptions,
): Signal<FormErrors<TModel, TKind>>;
export function formErrors<TModel, TKind extends string = never>(
    form: FieldTree<TModel>,
    options: ErrorSignalOptions = {},
): Signal<FormErrors<TModel, TKind>> {
    const onlyTouched = options.onlyTouched ?? false;

    return computed(
        () => buildErrorNode(form as unknown as LooseFieldTree, onlyTouched) as FormErrors<TModel, TKind>,
    );
}

/**
 * Tek bir alanın hata haritası: `usernameErrors().required`.
 * Alt alanların hataları dahil edilmez; onlar için `formErrors` kullanın.
 *
 * **Otomatik kind çıkarımı:** alan `SignalFormTree` (yani `createForm` çıktısı) ise
 * `TKind` yazmaya gerek yoktur; kind'lar yalnızca o alana eklenen kurallardan
 * `ErrorKindsAt<TRules, TKey>` ile otomatik çıkarılır:
 *
 * ```ts
 * const f = createForm(initial, (path) => [matchField(path.confirm, path.password)]);
 * fieldErrors(f.confirm)().match; // ✓
 * fieldErrors(f.confirm)().email; // ✗ derleme hatası
 * ```
 *
 * Sarılmamış/loose `FieldTree`'lerde eski imza geçerlidir:
 * `fieldErrors<'customValidator'>(field)`.
 */
/**
 * Tek bir alanın hata haritası: `usernameErrors().required`.
 * Alt alanların hataları dahil edilmez; onlar için `formErrors` kullanın.
 *
 * **Otomatik kind çıkarımı:** alan `SignalFormTree` ve şema **kural listesi**
 * döndürdüyse (`TRules extends RuleList`) `TKind` yazmaya gerek yoktur; kind'lar
 * yalnızca o alana eklenen kurallardan `ErrorKindsAt<TRules, TKey>` ile çıkarılır:
 *
 * ```ts
 * const f = createForm(initial, (path) => [matchField(path.confirm, path.password)]);
 * fieldErrors(f.confirm)().match; // ✓
 * fieldErrors(f.confirm)().email; // ✗ derleme hatası
 * ```
 *
 * Bloklu şemada (`TRules = void`) ilk overload uygun değildir ve tipler
 * gevşek haritaya (`ErrorMap<never>`) düşer. Sarılmamış/loose `FieldTree`'lerde
 * ve kind'i elle vermek istendiğinde eski imza geçerlidir:
 * `fieldErrors<'customValidator'>(field)`.
 *
 * `TRules` bilinçli olarak `RuleList` ile sınırlandırılmıştır: `RuleList | void`
 * olsaydı `void` bloğu conditional tip çıkarımı sırasında "excessively deep"
 * (TS2589) hatasına yol açıyordu. `TRules`'ı bu overload'da yazmak da gerekmez
 * (3 generic gerektiği için `fieldErrors<'kind'>(...)` legacy imzaya düşer).
 */
export function fieldErrors<
    TValue,
    TRules extends RuleList | void,
    TKey extends string,
    TParentKey extends string | number,
>(
    field: (() => any) & FormRulesRef<TValue, TRules, TKey, TParentKey>,
    options?: ErrorSignalOptions,
): Signal<ErrorMap<ErrorKindsAt<TRules, TKey> & string>>;
export function fieldErrors<TKind extends string = never>(
    field: LooseFieldTree,
    options?: ErrorSignalOptions,
): Signal<ErrorMap<TKind>>;
export function fieldErrors<TKind extends string = never>(
    field: LooseFieldTree,
    options: ErrorSignalOptions = {},
): Signal<ErrorMap<TKind>> {
    const onlyTouched = options.onlyTouched ?? false;

    return computed(() => visibleErrors(field(), onlyTouched) as ErrorMap<TKind>);
}

/**
 * Formun anlık durumu.
 * `'disabled'` > `'pending'` > `'valid' | 'invalid'` öncelik sırasıyla.
 */
export type ControlStatus = 'valid' | 'invalid' | 'pending' | 'disabled';

export function formStatus(form: LooseFieldTree): ControlStatus {
    const state = form();

    if (state.disabled()) {
        return 'disabled';
    }

    if (state.pending()) {
        return 'pending';
    }

    return state.valid() ? 'valid' : 'invalid';
}

/** Reaktif status: `computed(() => formStatusSignal(form)())` yerine doğrudan signal. */
export function formStatusSignal(form: LooseFieldTree): Signal<ControlStatus> {
    return computed(() => formStatus(form));
}

/** Root değerinin partial güncellemesi (eski `form.patchValue`). */
export function patchValue<TModel extends object>(
    form: FieldTree<TModel>,
    patch: Partial<TModel>,
): void {
    const current = form().value();
    const next = { ...current };

    for (const key of Object.keys(patch) as (keyof TModel)[]) {
        if (Object.hasOwn(patch, key)) {
            next[key] = patch[key] as TModel[keyof TModel];
        }
    }

    (form().value as WritableSignal<TModel>).set(next);
}

const SKIP = Symbol('skip');

/**
 * Angular yalnızca düz objeleri ve dizileri alt alanlara böler; `Date`, `File`,
 * `Map` veya sınıf örnekleri bütün bir değer (yaprak) olarak ele alınmalıdır.
 */
function isStructuralValue(value: unknown): value is object {
    if (Array.isArray(value)) {
        return true;
    }

    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
}

/** Objeler için `[key, child]`, array'ler için doğrudan child üretir. */
function childEntries(
    tree: LooseFieldTree,
): Array<[string, LooseFieldTree]> | Array<LooseFieldTree> | null {
    if (!isFieldTree(tree) || !isStructuralValue(tree().value())) {
        return null;
    }

    const iterable = tree as unknown as Partial<Iterable<unknown>>;

    if (typeof iterable[Symbol.iterator] !== 'function') {
        return null;
    }

    return [...(iterable as Iterable<unknown>)] as
        | Array<[string, LooseFieldTree]>
        | Array<LooseFieldTree>;
}

/** Çocuk girişlerinden yalnızca FieldTree'leri döndürür. */
function childTrees(tree: LooseFieldTree): LooseFieldTree[] {
    const kids = childEntries(tree);

    if (kids === null) {
        return [];
    }

    return kids.map((entry) => (Array.isArray(entry) ? entry[1] : entry));
}

function collectEnabled(tree: LooseFieldTree): unknown {
    const state = tree();

    if (state.disabled()) {
        return SKIP;
    }

    const value = state.value();
    const kids = childEntries(tree);

    if (kids === null) {
        return value;
    }

    if (Array.isArray(value)) {
        const out: unknown[] = [];

        for (const child of kids as Array<LooseFieldTree>) {
            const childValue = collectEnabled(child);

            if (childValue !== SKIP) {
                out.push(childValue);
            }
        }

        return out;
    }

    const out: Record<string, unknown> = {};

    for (const [key, child] of kids as Array<[string, LooseFieldTree]>) {
        const childValue = collectEnabled(child);

        if (childValue !== SKIP) {
            out[key] = childValue;
        }
    }

    return out;
}

/**
 * Sadece enabled alanların değerlerini döndürür (eski `form.enabledValue()`).
 * Disable edilmiş dallar payload'dan çıkarılır.
 *
 * Not: Eski `FormArray.value` gibi, dizilerde disabled öğeler atlanır ve
 * sonraki öğelerin indeksleri kayar.
 *
 * Reaktif bağlamda kullanmak için: `computed(() => enabledValue(form))`.
 */
export function enabledValue<TModel>(form: FieldTree<TModel>): Partial<TModel> {
    const tree = form as unknown as LooseFieldTree;
    const result = collectEnabled(tree);

    if (result === SKIP) {
        return (Array.isArray(tree().value()) ? [] : {}) as Partial<TModel>;
    }

    return result as Partial<TModel>;
}

/** FieldTree üzerindeki tüm alanları (root dahil) sırayla üretir. */
function* walkFields(tree: LooseFieldTree): Generator<LooseFieldTree> {
    if (!isFieldTree(tree)) {
        return;
    }

    yield tree;

    for (const child of childTrees(tree)) {
        yield* walkFields(child);
    }
}

/**
 * Bayrağı kendisinde (çocuklarından türemeden) set edilmiş alanlar.
 * Angular'da `touched`/`dirty` herhangi bir çocuk için true ise ebeveynde de
 * true görünür; ebeveyni ayrıca işaretlemek bu türetmeyi kalıcı hale getirir.
 */
function selfFlagged(form: LooseFieldTree, flag: 'touched' | 'dirty'): LooseFieldTree[] {
    return [...walkFields(form)].filter(
        (field) => field()[flag]() && !childTrees(field).some((child) => child()[flag]()),
    );
}

/** Root + tüm torun alanları touched yapar (`markAsTouched` zaten descendants'ı kapsar). */
export function markAllTouched(form: LooseFieldTree): void {
    form().markAsTouched();
}

/** Alias: eski API'de `touchAll()` vardı. */
export const touchAll = markAllTouched;

/** Tüm alanları dirty yapar. */
export function markAllDirty(form: LooseFieldTree): void {
    for (const field of walkFields(form)) {
        field().markAsDirty();
    }
}

/**
 * Tüm alanları pristine (dirty=false) yapar, touched durumu korunur.
 *
 * Angular'da public `markAsPristine` olmadığından root üzerinde tek bir
 * `reset()` çağrılır ve touched bayrakları geri yüklenir.
 *
 * Not: `reset()`, debounce bekleyen ve henüz modele yazılmamış girdiyi iptal eder.
 */
export function markAllPristine(form: LooseFieldTree): void {
    const touched = selfFlagged(form, 'touched');

    form().reset();

    for (const field of touched) {
        field().markAsTouched({ skipDescendants: true });
    }
}

/**
 * Tüm alanları untouched yapar, dirty durumu korunur.
 *
 * Angular'da public `markAsUntouched` olmadığından root üzerinde tek bir
 * `reset()` çağrılır ve dirty bayrakları geri yüklenir.
 *
 * Not: `reset()`, debounce bekleyen ve henüz modele yazılmamış girdiyi iptal eder.
 */
export function markAllUntouched(form: LooseFieldTree): void {
    const dirty = selfFlagged(form, 'dirty');

    form().reset();

    for (const field of dirty) {
        field().markAsDirty();
    }
}

/** `resetForm` seçenekleri. */
export interface ResetFormOptions<TModel> {
    /**
     * Verilirse başlangıç snapshot'ı yerine bu değere resetlenir
     * (eski alan seviyesi `field.reset(next)` gibi).
     * `undefined` verilmesi, verilmemesiyle aynıdır (snapshot kullanılır).
     */
    value?: TModel;
    /**
     * Imperatif disable sinyalleri (`disableControl`); reset sırasında her biri
     * kendi başlangıç değerine döndürülür (eski `disabled → initialDisabled`).
     *
     * Not: `createForm`'ın reaktif `disabled` opsiyon sinyali harici durumdur,
     * burada sıfırlanmaz — resetlenecek disable durumu için `disableControl` gate'i kullanın.
     */
    disableGates?: readonly DisableControl[];
}

/**
 * Eski `form.reset()` karşılığı: value'yu başlangıca alır, tüm alanlarda
 * dirty/touched → false yapar ve disable gate'lerini başlangıçlarına döndürür.
 *
 * Angular'ın `form().reset()`i argümansız çağrıldığında sadece touched/dirty
 * sıfırlar, value'yu değiştirmez; disabled da schema (gate) ile kurulduğundan
 * reset edilmez. Bu yardımcı üçünü de eski API gibi geri yükler:
 *
 * - **value**: `createForm` anında alınan snapshot'ın kopyası (veya `options.value`).
 * - **dirty/touched**: Angular'ın `reset(value)` çağrısı (root + tüm descendants).
 * - **disabled**: `options.disableGates` içindeki her `disableControl` sinyali
 *   kendi başlangıç değerine döndürülür.
 *
 * Sonrasında `reloadValidation()` ile async doğrulamalar başlangıç değeri için
 * yeniden çalıştırılır (eski form-level `scheduleFormAsync()` karşılığı).
 *
 * @example
 * ```ts
 * const gate = disableControl(false);
 * const form = createForm(initial, (path) => { disableWhen(path.a, gate); });
 *
 * gate.disable();
 * resetForm(form, { disableGates: [gate] }); // value + dirty/touched + gate başlangıca
 * ```
 */
export function resetForm<TModel>(
    form: FieldTree<TModel>,
    options?: ResetFormOptions<TModel>,
): void {
    // `FieldTree<TModel>` çağrısı, generic TModel ile çözülemeyen bir conditional
    // döndürdüğü için `reset(value)` overload'u daralmaz; LooseFieldTree ile okunur.
    const state = (form as unknown as LooseFieldTree)();

    let nextValue: TModel;

    if (options?.value !== undefined) {
        nextValue = options.value;
    } else if (initialValues.has(state)) {
        nextValue = cloneValue(initialValues.get(state) as TModel);
    } else {
        throw new Error(
            'resetForm: initial value snapshot is missing; create the form with createForm() or pass options.value.',
        );
    }

    options?.disableGates?.forEach((gate) => gate.reset());
    state.reset(nextValue);
    state.reloadValidation();
}

export interface ValidateFormOptions {
    /** Hataların arayüzde görünmesi için tüm alanları touched yapar. @default false */
    markAsTouched?: boolean;
    /** Async doğrulamalar için azami bekleme süresi (ms). @default 30000 */
    timeout?: number;
}

const nextMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve));

/** Tüm pending async doğrulamaların bitmesini bekler. */
async function waitUntilSettled(form: LooseFieldTree, timeout: number): Promise<void> {
    // Effect/resource zincirinin params değişimini işleyip pending'e geçmesi için
    // bir makro görev turu bekle (yalnızca mikro görev bazen yetmez).
    await nextMacrotask();

    const deadline = Date.now() + timeout;

    while (form().pending()) {
        if (Date.now() > deadline) {
            throw new Error(`Async validation did not settle within ${timeout}ms`);
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

/**
 * Pending async doğrulamaları (debounce dahil) bitene kadar bekler,
 * ardından kök alanın geçerliliğini döndürür.
 *
 * `validateOnChange: false` doğrulayıcıları yalnızca bu form için tetiklenir;
 * sonuçları alanın değeri değişene kadar korunur.
 *
 * Eski `form.validate()` / `control.validate()` karşılığı.
 */
export async function validateForm(
    form: LooseFieldTree,
    options: ValidateFormOptions = {},
): Promise<boolean> {
    const state = form();

    if (options.markAsTouched) {
        state.markAsTouched();
    }

    manualValidationRequests.get(state)?.update((count) => count + 1);
    state.reloadValidation();
    await waitUntilSettled(form, options.timeout ?? 30_000);

    return form().valid();
}

/** Değer / disabled / pending / hata / touched / dirty değişimlerinde listener çağırır. */
export function onChange(
    form: LooseFieldTree,
    listener: () => void,
    options?: { injector?: Injector },
): () => void {
    let first = true;

    const handle = effect(
        () => {
            const state = form();

            // İzlenecek reaktif kaynaklar (errorSummary alt alan hatalarını da kapsar):
            state.value();
            state.disabled();
            state.pending();
            state.errorSummary();
            state.touched();
            state.dirty();

            if (first) {
                first = false;

                return;
            }

            // Listener'ın okuduğu sinyaller effect'e bağımlılık olarak eklenmesin.
            untracked(listener);
        },
        options?.injector
            ? { injector: options.injector, manualCleanup: true }
            : { manualCleanup: true },
    );

    return () => handle.destroy();
}

/**
 * Imperatif disable/enable kontrolü.
 *
 * Schema içinde `disabled(path, { when: control })` gibi kullanılır:
 * ```ts
 * const addressGate = signal(false);
 * (path) => disabled(path.address, { when: () => addressGate() });
 *
 * addressGate.set(true); // imperatif disable
 * ```
 *
 * Daha kısa yol için {@link disableControl} + {@link disableWhen}.
 */
export interface DisableControl {
    (): boolean;
    setDisabled(value: boolean): void;
    disable(): void;
    enable(): void;
    /** Sinyali başlangıç (`disableControl(initial)`) değerine döndürür. */
    reset(): void;
}

/** Reaktif disable sinyali üretir (`signal` + imperatif yardımcılar). */
export function disableControl(initial = false): DisableControl {
    const state = signal(initial);
    const read = (() => state()) as DisableControl;

    read.setDisabled = (value: boolean) => state.set(value);
    read.disable = () => state.set(true);
    read.enable = () => state.set(false);
    read.reset = () => state.set(initial);

    return read;
}

/** Schema içinde `disableWhen(path, control)` yazımı. */
export function disableWhen<TValue, TPathKind extends PathKind = PathKind.Root>(
    path: FieldPath<TValue, TPathKind>,
    control: () => boolean,
): void {
    disabledRule(path, {
        when: () => control(),
    });
}

// ---------------------------------------------------------------------------
// Async doğrulama sarmalayıcı (eski AsyncValidator → resource tabanlı)
// ---------------------------------------------------------------------------

/** Eski `AsyncValidatorContext`: in-flight işleri iptal eden `AbortSignal`. */
export type AsyncValidatorContext = { readonly signal: AbortSignal };

/** Eski `AsyncValidator` imzası. */
export type AsyncValidator<TValue, TKey extends string = string> = (
    value: TValue,
    context: AsyncValidatorContext,
) => Promise<ValidationErrors<TKey> | undefined>;

type ManualParams<TValue> = { value: TValue; request: number };

/**
 * Async doğrulama için `params` fonksiyonu üretir.
 *
 * `validateOnChange: false` iken params yalnızca bu formun `validateForm()`
 * sayacı arttığında dolu döner. Alanın değeri sonradan değişirse `undefined`
 * döner; resource idle'a geçer ve eski (artık geçersiz) hata temizlenir.
 */
function createParams<TValue>(
    validateOnChange: boolean,
): (ctx: FieldContext<TValue, any>) => TValue | ManualParams<TValue> | undefined {
    if (validateOnChange) {
        return ({ value }) => value() as TValue | undefined;
    }

    const rootPath = compilingRootPath;

    if (rootPath === undefined) {
        throw new Error(
            'validateOnChange: false requires the schema to be created through createForm().',
        );
    }

    const consumedRequests = new WeakMap<object, number>();

    return (ctx) => {
        const value = ctx.value() as TValue;
        const request = manualValidationRequests.get(ctx.stateOf(rootPath))?.() ?? 0;

        if (request === 0 || consumedRequests.get(ctx.state) === request) {
            return undefined;
        }

        consumedRequests.set(ctx.state, request);

        return { value, request };
    };
}

const unwrapParams = <TValue>(
    params: TValue | ManualParams<TValue>,
    validateOnChange: boolean,
): TValue => (validateOnChange ? (params as TValue) : (params as ManualParams<TValue>).value);

const toAsyncError = (error: unknown): ValidationError => ({
    kind: 'asyncValidation',
    message: error instanceof Error ? error.message : String(error),
});

export interface ValidateAsyncFnOptions<TValue, TPathKind extends PathKind = PathKind.Root> {
    /** Otomatik çalıştırmadan önce beklenecek süre (ms). */
    debounce?: number;
    /** Async doğrulamanın ne zaman çalışacağını sınırlar (varsayılan: sync valid ise). */
    when?: LogicFn<TValue, boolean, TPathKind>;
    /**
     * `false` ise değer değişiminde async doğrulama çalışmaz;
     * yalnızca `validateForm()` sırasında çalışır (eski `validateOnChange: false`).
     * Şemanın `createForm()` ile oluşturulmasını gerektirir.
     * @default true
     */
    validateOnChange?: boolean;
    /** Validator throw ederse hata → validation error dönüşümü. */
    onError?: (error: unknown) => ValidationError | readonly ValidationError[];
}

/**
 * Basit bir async validator'ü Signal Forms'a bağlar.
 *
 * - `AbortSignal`: değer tekrar değişince / disable edilince loader iptal edilir.
 * - Sync hatalar zaten varken loader çalışmaz (Angular davranışı).
 * - `validateForm()` pending kalmadan resolve etmez.
 *
 * @example
 * ```ts
 * (path) => validateAsyncFn(path.username, async (value, { signal }) => {
 *     const taken = await checkUsername(value, signal);
 *     return taken ? { kind: 'taken', message: 'already used' } : undefined;
 * }, { debounce: 300 });
 * ```
 */
export function validateAsyncFn<
    TValue,
    TPathKind extends PathKind = PathKind.Root,
    TKey extends string = string,
    const TError extends ValidationError = never,
>(
    path: FieldPath<TValue, TPathKind> & PathKeyBrand<TKey>,
    validator: (value: TValue, context: AsyncValidatorContext) => Promise<
        TError | readonly TError[] | undefined
    >,
    options: ValidateAsyncFnOptions<TValue, TPathKind> = {},
): FieldRule<
    TKey,
    (ValidationError.WithFieldTree & TError) | CustomValidationError<'asyncValidation'>
> {
    const validateOnChange = options.validateOnChange ?? true;
    const params = createParams<TValue>(validateOnChange);

    validateAsync(path, {
        params,
        debounce: options.debounce,
        when: options.when,
        factory: (paramsSignal) =>
            resource({
                params: paramsSignal,
                loader: async ({ params: current, abortSignal }) =>
                    validator(unwrapParams(current, validateOnChange), { signal: abortSignal }),
            }),
        onSuccess: (result) => result,
        onError: (error) => options.onError?.(error) ?? toAsyncError(error),
    });
    return ruleToken();
}

/**
 * Form seviyesinde (root) async çapraz-alan doğrulama.
 * Eski `AsyncFormValidator` karşılığı: tüm model değeri tek seferde girer.
 * Validator eski tarz hata çantası döndürür; `false`/`undefined` değerler hata sayılmaz.
 */
export function validateFormAsync<TModel>(
    path: SchemaPathTree<TModel>,
    validator: (
        values: TModel,
        context: AsyncValidatorContext,
    ) => Promise<ValidationErrors | undefined>,
    options: { debounce?: number; validateOnChange?: boolean } = {},
): void {
    const validateOnChange = options.validateOnChange ?? true;
    const params = createParams<TModel>(validateOnChange);

    validateAsync(path as SchemaPath<TModel>, {
        params,
        debounce: options.debounce,
        factory: (paramsSignal) =>
            resource({
                params: paramsSignal,
                loader: async ({ params: current, abortSignal }) =>
                    bagToErrors(
                        await validator(unwrapParams(current, validateOnChange), {
                            signal: abortSignal,
                        }),
                    ),
            }),
        onSuccess: (result) => result,
        onError: toAsyncError,
    });
}

// Tüketiciler tek bir yerden import edebilsin diye Angular'ın yerleşik
// kuralları ve yardımcıları yeniden dışa aktarılır. `required`, `email`,
// `min`, `max`, `minLength`, `maxLength`, `minDate`, `maxDate`, `pattern`
// bu dosyada tipli kural döndüren sarmalayıcılar olarak tanımlıdır.
export {
    apply,
    applyEach,
    applyWhen,
    applyWhenValue,
    debounce,
    disabled,
    FormField,
    hidden,
    isFieldTree,
    readonly,
    schema,
    submit,
    transformedValue,
    validate,
    validateAsync,
    validateHttp,
    validateTree,
} from '@angular/forms/signals';

export {
    emailError,
    maxDateError,
    maxError,
    maxLengthError,
    minDateError,
    minError,
    minLengthError,
    patternError,
    requiredError,
} from '@angular/forms/signals';

export type {
    FieldContext,
    FieldState,
    FieldTree,
    FieldValidator,
    FormOptions,
    LogicFn,
    MarkAsTouchedOptions,
    PathKind,
    ReadonlyFieldState,
    SchemaPath,
    SchemaPathTree,
    TreeValidator,
    ValidationError,
} from '@angular/forms/signals';