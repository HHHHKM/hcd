import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';

export type Locale = 'zh-CN' | 'en';
export const namespaces = [
  'common',
  'auth',
  'docs',
  'reader',
  'editor',
  'review',
  'history',
  'comments',
  'import',
  'settings',
  'admin',
  'ai',
  'share',
  'export',
  'notifications',
  'errors',
] as const;
export function browserLocale(language = typeof navigator === 'undefined' ? 'en' : navigator.language): Locale {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
export function preferredLocale(userLocale?: string | null, language?: string): Locale {
  return userLocale === 'zh-CN' || userLocale === 'en' ? userLocale : browserLocale(language);
}
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { en, 'zh-CN': zhCN },
  lng: browserLocale(),
  fallbackLng: 'en',
  ns: [...namespaces],
  defaultNS: 'common',
  showSupportNotice: false,
  interpolation: {
    escapeValue: false,
    format: (value: unknown, _format?: string, language?: string) =>
      typeof value === 'number' ? new Intl.NumberFormat(language ?? 'en').format(value) : String(value),
  },
  initImmediate: false,
});
export type TranslationValues = Record<string, string | number | boolean | undefined>;
const translators = new Map<Locale, (key: string, values?: TranslationValues) => string>();
export function getLocaleTranslation(locale: Locale) {
  const existing = translators.get(locale);
  if (existing) return existing;
  const translator = (key: string, values?: TranslationValues): string => {
    const separator = key.indexOf('.');
    const ns = separator < 0 ? 'common' : key.slice(0, separator);
    const name = separator < 0 ? key : key.slice(separator + 1);
    return String(i18n.getFixedT(locale, ns)(name, values ?? {}));
  };
  translators.set(locale, translator);
  return translator;
}

export function translate(locale: Locale, key: string, values?: TranslationValues): string {
  return getLocaleTranslation(locale)(key, values);
}
export function useLocaleTranslation(locale: Locale) {
  useTranslation([...namespaces], { i18n, lng: locale });
  return getLocaleTranslation(locale);
}
export function formatDate(
  value: string | number | Date,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? translate(locale, 'common.unknownTime')
    : new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export const formatNumber = (value: number, locale: Locale): string => new Intl.NumberFormat(locale).format(value);
export const formatRelativeTime = (value: number, unit: Intl.RelativeTimeFormatUnit, locale: Locale): string =>
  new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);

export function translateErrorCode(locale: Locale, code: string, fallback: string): string {
  return /^[A-Z][A-Z0-9_]*$/.test(code) && i18n.exists(code, { lng: locale, ns: 'errors' })
    ? translate(locale, `errors.${code}`)
    : fallback;
}
