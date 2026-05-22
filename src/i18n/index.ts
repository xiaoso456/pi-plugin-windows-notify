import enRaw from "./en.json";
import zhCNRaw from "./zh-CN.json";
import jaRaw from "./ja.json";
import koRaw from "./ko.json";
import esRaw from "./es.json";
import frRaw from "./fr.json";
import ruRaw from "./ru.json";

export type Locale = "en" | "zh-CN" | "ja" | "ko" | "es" | "fr" | "ru";

export const SUPPORTED_LOCALES: Locale[] = [
	"en",
	"zh-CN",
	"ja",
	"ko",
	"es",
	"fr",
	"ru",
];
/** Map system locale strings (e.g. "zh-CN", "zh_CN", "zh-Hans-CN") to our supported Locale */
const SYSTEM_LOCALE_MAP: Record<string, Locale> = {
	en: "en",
	"en-US": "en",
	"en-GB": "en",
	"en-AU": "en",
	"en-CA": "en",
	"en-NZ": "en",
	"zh-CN": "zh-CN",
	"zh-Hans-CN": "zh-CN",
	"zh-Hans": "zh-CN",
	"zh-SG": "zh-CN",
	"zh-TW": "zh-CN",
	"zh-Hant-TW": "zh-CN",
	"zh-Hant": "zh-CN",
	"zh-HK": "zh-CN",
	"zh-MO": "zh-CN",
	ja: "ja",
	"ja-JP": "ja",
	ko: "ko",
	"ko-KR": "ko",
	es: "es",
	"es-ES": "es",
	"es-MX": "es",
	"es-AR": "es",
	"es-CO": "es",
	"es-CL": "es",
	fr: "fr",
	"fr-FR": "fr",
	"fr-CA": "fr",
	"fr-BE": "fr",
	"fr-CH": "fr",
	ru: "ru",
	"ru-RU": "ru",
};

export function detectSystemLocale(): Locale {
	try {
		const sys = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || "").split(".")[0].trim();
		if (sys && SYSTEM_LOCALE_MAP[sys]) return SYSTEM_LOCALE_MAP[sys];
		// Try base language: "zh_CN" → "zh"
		const base = sys.split(/[-_]/)[0];
		if (base && SYSTEM_LOCALE_MAP[base]) return SYSTEM_LOCALE_MAP[base];
	} catch {
		// ignore
	}
	return "en";
}

export const LOCALE_LABELS: Record<Locale, string> = {
	en: "English",
	"zh-CN": "简体中文",
	ja: "日本語",
	ko: "한국어",
	es: "Español",
	fr: "Français",
	ru: "Русский",
};

/** Replace {key} placeholders in a template string with values from the params object */
function tmpl(template: string, params: Record<string, string | number>): string {
	return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

export interface Translations {
	settings: {
		title: string;
		enabled: string;
		enabledDesc: string;
		notifyMode: string;
		notifyModeAfkDesc: string;
		notifyModeAllDesc: string;
		language: string;
		languageDesc: string;
	};
	notifications: {
		taskFailed: string;
		taskFailedMsg: (errorMsg: string, taskLine: string) => string;
		taskComplete: string;
		taskCompleteMsg: (taskLine: string) => string;
		askConfirm: string;
		askQuestion: (question: string) => string;
		askOptions: string;
		askOptionItem: (idx: number, label: string) => string;
		askReturn: string;
		unknownError: string;
		yourTask: (task: string) => string;
		returnToPi: string;
		returnToPiResult: string;
	};
	commands: {
		notifyDescription: string;
	};
	logs: {
		referenceWindow: (hwnd: string, title: string) => string;
		windowCaptureFailed: (err: string) => string;
		windowCheckFailed: (err: string) => string;
		afkRestartCaptured: (hwnd: string) => string;
		afkRestartFailed: string;
		pluginLoaded: (enabled: boolean, afk: boolean) => string;
	};
}

/** Raw JSON shape — all values are strings with {placeholder} templates */
interface RawTranslations {
	settings: Record<string, string>;
	notifications: Record<string, string>;
	commands: Record<string, string>;
	logs: Record<string, string>;
}

function compileTranslations(raw: RawTranslations): Translations {
	return {
		settings: {
			title: raw.settings.title,
			enabled: raw.settings.enabled,
			enabledDesc: raw.settings.enabledDesc,
			notifyMode: raw.settings.notifyMode,
			notifyModeAfkDesc: raw.settings.notifyModeAfkDesc,
			notifyModeAllDesc: raw.settings.notifyModeAllDesc,
			language: raw.settings.language,
			languageDesc: raw.settings.languageDesc,
		},
		notifications: {
			taskFailed: raw.notifications.taskFailed,
			taskFailedMsg: (errorMsg, taskLine) =>
				tmpl(raw.notifications.taskFailedMsg, { errorMsg, taskLine }),
			taskComplete: raw.notifications.taskComplete,
			taskCompleteMsg: (taskLine) =>
				tmpl(raw.notifications.taskCompleteMsg, { taskLine }),
			askConfirm: raw.notifications.askConfirm,
			askQuestion: (question) =>
				tmpl(raw.notifications.askQuestion, { question }),
			askOptions: raw.notifications.askOptions,
			askOptionItem: (idx, label) =>
				tmpl(raw.notifications.askOptionItem, { idx, label }),
			askReturn: raw.notifications.askReturn,
			unknownError: raw.notifications.unknownError,
			yourTask: (task) =>
				tmpl(raw.notifications.yourTask, { task }),
			returnToPi: raw.notifications.returnToPi,
			returnToPiResult: raw.notifications.returnToPiResult,
		},
		commands: {
			notifyDescription: raw.commands.notifyDescription,
		},
		logs: {
			referenceWindow: (hwnd, title) =>
				tmpl(raw.logs.referenceWindow, { hwnd, title }),
			windowCaptureFailed: (err) =>
				tmpl(raw.logs.windowCaptureFailed, { err }),
			windowCheckFailed: (err) =>
				tmpl(raw.logs.windowCheckFailed, { err }),
			afkRestartCaptured: (hwnd) =>
				tmpl(raw.logs.afkRestartCaptured, { hwnd }),
			afkRestartFailed: raw.logs.afkRestartFailed,
			pluginLoaded: (enabled, afk) =>
				tmpl(raw.logs.pluginLoaded, { enabled: String(enabled), afk: String(afk) }),
		},
	};
}

const localeData: Record<Locale, RawTranslations> = {
	en: enRaw as RawTranslations,
	"zh-CN": zhCNRaw as RawTranslations,
	ja: jaRaw as RawTranslations,
	ko: koRaw as RawTranslations,
	es: esRaw as RawTranslations,
	fr: frRaw as RawTranslations,
	ru: ruRaw as RawTranslations,
};

const cache = new Map<Locale, Translations>();

export function getTranslations(locale: Locale): Translations {
	const cached = cache.get(locale);
	if (cached) return cached;

	const raw = localeData[locale] ?? localeData.en;
	const translations = compileTranslations(raw);
	cache.set(locale, translations);
	return translations;
}

export function clearCache(): void {
	cache.clear();
}
