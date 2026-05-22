import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import notifier from "node-notifier";
import activeWin from "active-win";

import {
	Container,
	type SettingItem,
	SettingsList,
	Text,
} from "@earendil-works/pi-tui";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type Locale,
	type Translations,
	SUPPORTED_LOCALES,
	detectSystemLocale,
	getTranslations,
} from "./i18n/index";

function resolveAgentDir(): string {
	// Mirror the logic of getAgentDir() from pi-coding-agent / omp-coding-agent:
	//   1. PI_CODING_AGENT_DIR — full override for agent directory
	//   2. PI_CONFIG_DIR — config root dirname under home (OMP default ".omp", Pi default ".pi")
	//   3. Detect runtime from process.argv[1] (contains @oh-my-pi or @earendil-works)
	if (process.env.PI_CODING_AGENT_DIR) {
		return process.env.PI_CODING_AGENT_DIR;
	}
	const configDirName = process.env.PI_CONFIG_DIR;
	if (configDirName) {
		return join(homedir(), configDirName, "agent");
	}
	// No env vars set: detect runtime from the CLI entry point path.
	// OMP loads @oh-my-pi/pi-coding-agent; Pi loads @earendil-works/pi-coding-agent.
	const cliPath = (process.argv[1] || "").toLowerCase();
	const isOmp = cliPath.includes("@oh-my-pi") || cliPath.includes("oh-my-pi");
	const defaultConfigDir = isOmp ? ".omp" : ".pi";
	return join(homedir(), defaultConfigDir, "agent");
}


function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

interface PersistedConfig {
	notifyEnabled: boolean;
	enableSuccessNotify: boolean;
	enableFailNotify: boolean;
	enableAskNotify: boolean;
	onlyNotifyWhenAfk: boolean;
	minTaskDuration: number;
	playSound: boolean;
	notifyTimeout: number;
	appName: string;
	locale: Locale;
}

const DEFAULT_CONFIG: PersistedConfig = {
	notifyEnabled: true,
	enableSuccessNotify: true,
	enableFailNotify: true,
	enableAskNotify: true,
	onlyNotifyWhenAfk: true,
	minTaskDuration: 2000,
	playSound: true,
	notifyTimeout: 15,
	appName: "Pi Assistant",
	locale: detectSystemLocale(),
};

function loadPersistedConfig(agentDir: string): PersistedConfig {
	const persistPath = join(agentDir, "pi-windows-tip-config.json");
	try {
		const raw = readFileSync(persistPath, "utf-8");
		const saved = JSON.parse(raw);
		return { ...DEFAULT_CONFIG, ...saved };
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function saveConfig(cfg: PersistedConfig, agentDir: string): void {
	const persistPath = join(agentDir, "pi-windows-tip-config.json");
	try {
		mkdirSync(dirname(persistPath), { recursive: true });
		writeFileSync(persistPath, JSON.stringify(cfg, null, 2));
	} catch {
		// ignore
	}
}

const NOTIFY_COOLDOWN_MS = 1000;

interface PluginState {
	lastNotifyTime: number;
	lastUserInputTime: number;
	lastUserInput: string;
	lastSentTaskId: string;
	config: PersistedConfig;
}

interface CapturedWindow {
	hwnd: number;
	title: string;
}

let afkReferenceWindow: CapturedWindow | null = null;

function i18n(state: PluginState): Translations {
	return getTranslations(state.config.locale);
}

async function captureCurrentWindow(
	logger: Console,
	t: Translations,
): Promise<CapturedWindow | null> {
	try {
		const result = await activeWin();
		if (!result) return null;

		const captured: CapturedWindow = {
			hwnd: result.id,
			title: result.title,
		};
		logger.info(
			t.logs.referenceWindow(`0x${captured.hwnd.toString(16)}`, captured.title),
		);
		return captured;
	} catch (err) {
		logger.warn(t.logs.windowCaptureFailed(errorMessage(err)));
		return null;
	}
}

async function isUserAwayFromWindow(logger: Console, t: Translations): Promise<boolean> {
	if (!afkReferenceWindow) return true;

	try {
		const result = await activeWin();
		if (!result) return true;

		return result.id !== afkReferenceWindow.hwnd;
	} catch (err) {
		logger.warn(t.logs.windowCheckFailed(errorMessage(err)));
		return true;
	}
}

async function sendNotification(
	title: string,
	message: string,
	state: PluginState,
	logger: Console,
	force = false,
): Promise<void> {
	if (!state.config.notifyEnabled && !force) return;

	const now = Date.now();
	if (now - state.lastNotifyTime < NOTIFY_COOLDOWN_MS && !force) return;

	if (state.config.onlyNotifyWhenAfk && !force) {
		const userAway = await isUserAwayFromWindow(logger, i18n(state));
		if (!userAway) return;
	}

	state.lastNotifyTime = now;

	try {
		notifier.notify({
			title,
			message,
			// @ts-expect-error node-notifier accepts these extra options
			sound: state.config.playSound,
			wait: false,
			appID: state.config.appName,
			timeout: state.config.notifyTimeout,
		});
		logger.info(`Notification sent: ${title}`);
	} catch (err) {
		logger.error(`Failed to send notification: ${errorMessage(err)}`);
	}
}

async function handleTaskComplete(
	state: PluginState,
	logger: Console,
	isError = false,
	errorMsg = "",
): Promise<void> {
	const t = i18n(state);
	const taskDuration = Date.now() - state.lastUserInputTime;
	const taskId = `${state.lastUserInputTime}-${taskDuration}`;

	if (taskId === state.lastSentTaskId) return;

	state.lastSentTaskId = taskId;
	logger.info(
		`Task complete, duration: ${taskDuration}, threshold: ${state.config.minTaskDuration}, error: ${isError}`,
	);

	const taskShortDesc = state.lastUserInput
		? `"${state.lastUserInput.slice(0, 20)}${state.lastUserInput.length > 20 ? "..." : ""}"`
		: "";

	if (isError && state.config.enableFailNotify) {
		const taskLine = taskShortDesc
			? "\n" + t.notifications.yourTask(taskShortDesc)
			: "";
		await sendNotification(
			t.notifications.taskFailed,
			t.notifications.taskFailedMsg(
				errorMsg?.slice(0, 50) || t.notifications.unknownError,
				taskLine,
			),
			state,
			logger,
		);
		return;
	}

	if (
		state.config.enableSuccessNotify &&
		taskDuration >= state.config.minTaskDuration
	) {
		const taskLine = taskShortDesc ? `${taskShortDesc} ` : "";
		await sendNotification(
			t.notifications.taskComplete,
			t.notifications.taskCompleteMsg(taskLine),
			state,
			logger,
		);
	}
}

function createSettingsItems(state: PluginState): SettingItem[] {
	const t = i18n(state);
	return [
		{
			id: "notifyEnabled",
			label: t.settings.enabled,
			currentValue: state.config.notifyEnabled ? "on" : "off",
			values: ["on", "off"],
			description: t.settings.enabledDesc,
		},
		{
			id: "notifyMode",
			label: t.settings.notifyMode,
			currentValue: state.config.onlyNotifyWhenAfk ? "afk" : "all",
			values: ["afk", "all"],
			description: state.config.onlyNotifyWhenAfk
				? t.settings.notifyModeAfkDesc
				: t.settings.notifyModeAllDesc,
		},
		{
			id: "locale",
			label: t.settings.language,
			currentValue: state.config.locale,
			values: SUPPORTED_LOCALES,
			description: t.settings.languageDesc,
		},
	];
}

function settingsOnChange(state: PluginState, logger: Console, agentDir: string) {
	return (id: string, newValue: string) => {
		if (id === "notifyEnabled") {
			const on = newValue === "on";
			state.config.notifyEnabled = on;
			saveConfig(state.config, agentDir);
		} else if (id === "notifyMode") {
			const isAfk = newValue === "afk";
			state.config.onlyNotifyWhenAfk = isAfk;
			if (!isAfk) {
				afkReferenceWindow = null;
			} else {
				captureCurrentWindow(logger, i18n(state)).then((captured) => {
					if (captured) afkReferenceWindow = captured;
				});
			}
			saveConfig(state.config, agentDir);
		} else if (id === "locale") {
			state.config.locale = newValue as Locale;
			saveConfig(state.config, agentDir);
		}
	};
}

function buildSettingsUI(
	state: PluginState,
	logger: Console,
	tui: any,
	theme: any,
	done: (result: undefined) => void,
	agentDir: string,
) {
	const t = i18n(state);
	const items = createSettingsItems(state);
	const container = new Container();
	container.addChild(
		new Text(theme.fg("accent", theme.bold(t.settings.title)), 1, 0),
	);

	const settingsList = new SettingsList(
		items,
		items.length,
		getSettingsListTheme(),
		settingsOnChange(state, logger, agentDir),
		() => done(undefined),
	);
	container.addChild(settingsList);

	return {
		render(width: number) {
			return container.render(width);
		},
		invalidate() {
			container.invalidate();
		},
		handleInput(data: string) {
			settingsList.handleInput?.(data);
			tui.requestRender();
		},
	};
}

async function showSettingsUI(
	state: PluginState,
	logger: Console,
	ctx: any,
	agentDir: string,
	defer = false,
): Promise<void> {
	const render = async () => {
		await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (result: undefined) => void) =>
			buildSettingsUI(state, logger, tui, theme, done, agentDir),
		);
	};
	if (defer) {
		setTimeout(render, 50);
	} else {
		await render();
	}
}

export default function windowsNotification(pi: ExtensionAPI): void {
	const agentDir = resolveAgentDir();
	const saved = loadPersistedConfig(agentDir);
	const needsAfkCapture = saved.onlyNotifyWhenAfk;

	const state: PluginState = {
		lastNotifyTime: 0,
		lastUserInputTime: 0,
		lastUserInput: "",
		lastSentTaskId: "",
		config: saved,
	};

	const logPath = join(agentDir, "pi-windows-tip.log");

	// Ensure log directory exists once at startup
	try {
		mkdirSync(dirname(logPath), { recursive: true });
	} catch {
		// ignore
	}

	const logger: Console = (() => {
		const log = (level: string, ...args: unknown[]) => {
			try {
				appendFileSync(
					logPath,
					`${new Date().toISOString()} [${level}] ${args.map((a) =>
						typeof a === "string" ? a : JSON.stringify(a),
					).join(" ")}\n`,
				);
			} catch {
				/* ignore */
			}
		};
		return {
			info: (...a: unknown[]) => log("INFO", ...a),
			warn: (...a: unknown[]) => log("WARN", ...a),
			error: (...a: unknown[]) => log("ERROR", ...a),
		} as Console;
	})();

	pi.on("input", async (event: any, ctx: any) => {
		const content =
			event.text ?? event.content ?? event.message ?? JSON.stringify(event);
		const trimmed = content.trim();

		if (trimmed === "/notify") {
			showSettingsUI(state, logger, ctx, agentDir, true);
			return { handled: true } as any;
		}

		state.lastUserInputTime = Date.now();
		state.lastUserInput = trimmed;
		logger.info(
			`User input recorded: ${state.lastUserInputTime}, content: ${content.slice(0, 100)}, event keys: ${Object.keys(event)}`,
		);
	});

	pi.on("turn_end", async (_event, ctx) => {
		logger.info("turn_end triggered");
		if (ctx.isIdle()) {
			await handleTaskComplete(state, logger);
		}
	});

	pi.on("agent_end", async (event, _ctx) => {
		logger.info("agent_end triggered");
		await handleTaskComplete(
			state,
			logger,
			(event as any).isError,
			(event as any).error?.message,
		);
	});

	pi.on("message_end", async (_event, ctx) => {
		logger.info("message_end triggered");
		if (ctx.isIdle()) {
			await handleTaskComplete(state, logger);
		}
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName === "ask" && state.config.enableAskNotify) {
			const t = i18n(state);
			const questions =
				((event.input as any).questions as Array<{
					question: string;
					options: Array<{ label: string }>;
				}>) ?? [];
			const question = questions[0]?.question ?? t.notifications.askConfirm;
			const options = questions[0]?.options ?? [];

			let message = t.notifications.askQuestion(question);
			if (options.length > 0) {
				message +=
					"\n\n" + t.notifications.askOptions + "\n" +
					options.map((opt, idx) => t.notifications.askOptionItem(idx + 1, opt.label)).join("\n");
			}
			message += "\n" + t.notifications.askReturn;

			await sendNotification(t.notifications.askConfirm, message, state, logger);
		}
	});

	pi.registerCommand("notify", {
		description: i18n(state).commands.notifyDescription,
		handler: async (_args, ctx) => {
			await showSettingsUI(state, logger, ctx, agentDir);
		},
	});

	pi.on("session_start", async (_event, _ctx) => {
		const t = i18n(state);
		logger.info(
			t.logs.pluginLoaded(state.config.notifyEnabled, state.config.onlyNotifyWhenAfk),
		);
		if (needsAfkCapture) {
			const captured = await captureCurrentWindow(logger, t);
			if (captured) {
				afkReferenceWindow = captured;
				logger.info(
					t.logs.afkRestartCaptured(`0x${captured.hwnd.toString(16)}`),
				);
			} else {
				logger.warn(t.logs.afkRestartFailed);
				state.config.onlyNotifyWhenAfk = false;
			}
		}
	});
}
