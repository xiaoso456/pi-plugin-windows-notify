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

const PERSIST_PATH = join(homedir(), ".pi", "pi-windows-tip-config.json");
const PERSIST_DIR = dirname(PERSIST_PATH);

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
}

const DEFAULT_CONFIG: PersistedConfig = {
	notifyEnabled: true,
	enableSuccessNotify: true,
	enableFailNotify: true,
	enableAskNotify: true,
	onlyNotifyWhenAfk: false,
	minTaskDuration: 2000,
	playSound: true,
	notifyTimeout: 15,
	appName: "Pi 助手",
};

function loadPersistedConfig(): PersistedConfig {
	try {
		const raw = readFileSync(PERSIST_PATH, "utf-8");
		const saved = JSON.parse(raw);
		return { ...DEFAULT_CONFIG, ...saved };
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function saveConfig(cfg: PersistedConfig): void {
	try {
		mkdirSync(PERSIST_DIR, { recursive: true });
		writeFileSync(PERSIST_PATH, JSON.stringify(cfg, null, 2));
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

async function captureCurrentWindow(
	logger: Console,
): Promise<CapturedWindow | null> {
	try {
		const result = await activeWin();
		if (!result) return null;

		const captured: CapturedWindow = {
			hwnd: result.id,
			title: result.title,
		};
		logger.info(
			`已记录参考窗口: 句柄=0x${captured.hwnd.toString(16)}, 标题="${captured.title}"`,
		);
		return captured;
	} catch (err) {
		logger.warn(`窗口捕获失败: ${errorMessage(err)}`);
		return null;
	}
}

async function isUserAwayFromWindow(logger: Console): Promise<boolean> {
	if (!afkReferenceWindow) return true;

	try {
		const result = await activeWin();
		if (!result) return true;

		return result.id !== afkReferenceWindow.hwnd;
	} catch (err) {
		logger.warn(`窗口检测失败: ${errorMessage(err)}`);
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
		const userAway = await isUserAwayFromWindow(logger);
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
		const taskLine = taskShortDesc ? `\n你的任务：${taskShortDesc}` : "";
		await sendNotification(
			" 任务执行失败",
			`执行出错：${errorMsg?.slice(0, 50) || "未知错误"}${taskLine}\n请回到Pi查看详情。`,
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
			"✅ 任务执行完成",
			`${taskLine}已完成\n请回到Pi查看结果。`,
			state,
			logger,
		);
	}
}

function createSettingsItems(state: PluginState): SettingItem[] {
	return [
		{
			id: "notifyEnabled",
			label: "Notify",
			currentValue: state.config.notifyEnabled ? "on" : "off",
			values: ["on", "off"],
			description:
				"控制 Windows 系统通知的总开关。关闭后将不再发送任何任务完成或确认通知。",
		},
		{
			id: "notifyMode",
			label: "Notify Mode",
			currentValue: state.config.onlyNotifyWhenAfk ? "afk" : "all",
			values: ["afk", "all"],
			description: state.config.onlyNotifyWhenAfk
				? "AFK 模式：仅当你离开当前窗口时才发送通知。"
				: "全部模式：所有符合条件的任务都会发送通知，无论你是否在窗口前。",
		},
	];
}

function settingsOnChange(state: PluginState, logger: Console) {
	return (id: string, newValue: string) => {
		if (id === "notifyEnabled") {
			const on = newValue === "on";
			state.config.notifyEnabled = on;
			saveConfig(state.config);
		} else if (id === "notifyMode") {
			const isAfk = newValue === "afk";
			state.config.onlyNotifyWhenAfk = isAfk;
			if (!isAfk) {
				afkReferenceWindow = null;
			} else {
				captureCurrentWindow(logger).then((captured) => {
					if (captured) afkReferenceWindow = captured;
				});
			}
			saveConfig(state.config);
		}
	};
}

function buildSettingsUI(
	state: PluginState,
	logger: Console,
	tui: any,
	theme: any,
	done: (result: undefined) => void,
) {
	const items = createSettingsItems(state);
	const container = new Container();
	container.addChild(
		new Text(theme.fg("accent", theme.bold("Windows 通知设置")), 1, 0),
	);

	const settingsList = new SettingsList(
		items,
		items.length,
		getSettingsListTheme(),
		settingsOnChange(state, logger),
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
	defer = false,
): Promise<void> {
	const render = async () => {
		await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (result: undefined) => void) =>
			buildSettingsUI(state, logger, tui, theme, done),
		);
	};
	if (defer) {
		setTimeout(render, 50);
	} else {
		await render();
	}
}

export default function windowsNotification(pi: ExtensionAPI): void {
	const saved = loadPersistedConfig();
	const needsAfkCapture = saved.onlyNotifyWhenAfk;

	const state: PluginState = {
		lastNotifyTime: 0,
		lastUserInputTime: 0,
		lastUserInput: "",
		lastSentTaskId: "",
		config: saved,
	};

	const logPath = join(homedir(), ".pi", "pi-windows-tip.log");

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
			showSettingsUI(state, logger, ctx, true);
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
			const questions =
				((event.input as any).questions as Array<{
					question: string;
					options: Array<{ label: string }>;
				}>) ?? [];
			const question = questions[0]?.question ?? "需要你的确认";
			const options = questions[0]?.options ?? [];

			let message = `问题:${question}`;
			if (options.length > 0) {
				message +=
					"\n\n可选操作:\n" +
					options.map((opt, idx) => `${idx + 1}. ${opt.label}`).join("\n");
			}
			message += "\n请回到Pi回复。";

			await sendNotification("❓ 需要你的确认", message, state, logger);
		}
	});

	pi.registerCommand("notify", {
		description: "Windows通知设置菜单",
		handler: async (_args, ctx) => {
			await showSettingsUI(state, logger, ctx);
		},
	});

	pi.on("session_start", async (_event, _ctx) => {
		logger.info(
			`Windows notification plugin loaded, enabled: ${state.config.notifyEnabled}, afk: ${state.config.onlyNotifyWhenAfk}`,
		);
		if (needsAfkCapture) {
			const captured = await captureCurrentWindow(logger);
			if (captured) {
				afkReferenceWindow = captured;
				logger.info(
					`AFK模式重启,自动记录参考窗口:0x${captured.hwnd.toString(16)}`,
				);
			} else {
				logger.warn("AFK模式重启,但无法捕获当前窗口,本次启动不会生效");
				state.config.onlyNotifyWhenAfk = false;
			}
		}
	});
}
