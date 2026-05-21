import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import notifier from "node-notifier";
import activeWin from "active-win";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PERSIST_PATH = join(homedir(), ".pi", "pi-windows-tip-config.json");

interface PersistedConfig {
  notifyEnabled: boolean;
  onlyNotifyWhenAfk: boolean;
  minTaskDuration: number;
  playSound: boolean;
  afkWindowHwnd?: number;
  afkWindowTitle?: string;
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

const windowDetectionSupported: boolean | null = null;

function loadPersistedConfig(): PersistedConfig {
  try {
    if (existsSync(PERSIST_PATH)) {
      const raw = readFileSync(PERSIST_PATH, "utf-8");
      const saved = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...saved };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg: PersistedConfig): void {
  try {
    const dir = join(homedir(), ".pi");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(PERSIST_PATH, JSON.stringify(cfg, null, 2));
  } catch {
    // ignore
  }
}

const NOTIFY_COOLDOWN_MS = 1000;

interface PluginState {
  notifyEnabled: boolean;
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

async function captureCurrentWindow(logger: Console): Promise<CapturedWindow | null> {
  try {
    const result = await activeWin();
    if (!result) return null;

    const captured: CapturedWindow = {
      hwnd: result.id,
      title: result.title,
    };
    logger.info(`已记录参考窗口: 句柄=0x${captured.hwnd.toString(16)}, 标题="${captured.title}"`);
    return captured;
  } catch (err) {
    logger.warn(`窗口捕获失败: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function isUserAwayFromWindow(logger: Console): Promise<boolean> {
  if (windowDetectionSupported === false || !afkReferenceWindow) return true;

  try {
    const result = await activeWin();
    if (!result) return true;

    return result.id !== afkReferenceWindow.hwnd;
  } catch (err) {
    logger.warn(`窗口检测失败: ${err instanceof Error ? err.message : String(err)}`);
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
  if (!state.notifyEnabled && !force) return;

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
    logger.error(`Failed to send notification: ${err instanceof Error ? err.message : String(err)}`);
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
  logger.info(`Task complete, duration: ${taskDuration}, threshold: ${state.config.minTaskDuration}, error: ${isError}`);

  const taskShortDesc = state.lastUserInput ? `"${state.lastUserInput.slice(0, 20)}${state.lastUserInput.length > 20 ? "..." : ""}"` : ""

  if (isError && state.config.enableFailNotify) {
    const taskLine = taskShortDesc ? `\n你的任务：${taskShortDesc}` : ""
    await sendNotification(
      "❌ 任务执行失败",
      `执行出错：${errorMsg?.slice(0, 50) || "未知错误"}${taskLine}\n请回到Pi查看详情。`,
      state,
      logger,
    );
    return;
  }

  if (state.config.enableSuccessNotify && taskDuration >= state.config.minTaskDuration) {
    const taskLine = taskShortDesc ? `${taskShortDesc} ` : ""
    await sendNotification(
      "✅ 任务执行完成",
      `${taskLine}已完成\n请回到Pi查看结果。`,
      state,
      logger,
    );
  }
}

export default function windowsNotification(pi: ExtensionAPI): void {


  const saved = loadPersistedConfig();
  // AFK模式上次开启过,本次启动需要重新捕获参考窗口
  const needsAfkCapture = saved.onlyNotifyWhenAfk;

  const state: PluginState = {
    notifyEnabled: saved.notifyEnabled,
    lastNotifyTime: 0,
    lastUserInputTime: 0,
    lastUserInput: "",
    lastSentTaskId: "",
    config: saved,
  };

  const logger = console;

  pi.on("input", async (event: any) => {
    state.lastUserInputTime = Date.now();
    // 兼容两种字段名，同时打印所有字段方便排查
    const content = event.text ?? event.content ?? event.message ?? JSON.stringify(event);
    state.lastUserInput = content.trim();
    logger.info(`User input recorded: ${state.lastUserInputTime}, content: ${content.slice(0, 100)}, event keys: ${Object.keys(event)}`);
  });

  pi.on("turn_end", async (_event, ctx) => {
    logger.info("turn_end triggered");
    if (ctx.isIdle()) {
      await handleTaskComplete(state, logger);
    }
  });

  pi.on("agent_end", async (event, _ctx) => {
    logger.info("agent_end triggered");

    await handleTaskComplete(state, logger, (event as any).isError, (event as any).error?.message);
  });

  pi.on("message_end", async (_event, ctx) => {
    logger.info("message_end triggered");
    if (ctx.isIdle()) {
      await handleTaskComplete(state, logger);
    }
  });

  pi.on("tool_call", async (event) => {
    if (event.toolName === "ask" && state.config.enableAskNotify) {

      const questions = (event.input as any).questions as Array<{ question: string; options: Array<{ label: string }> }> ?? [];
      const question = questions[0]?.question ?? "需要你的确认";
      const options = questions[0]?.options ?? [];

      let message = `问题:${question}`;
      if (options.length > 0) {
        message += "\n\n可选操作:\n" + options.map((opt, idx) => `${idx + 1}. ${opt.label}`).join("\n");
      }
      message += "\n请回到Pi回复。";

      await sendNotification("❓ 需要你的确认", message, state, logger);
    }
  });

  pi.registerCommand("notify-on", {
    description: "开启Windows通知功能",
    handler: async (_args, ctx) => {
      state.notifyEnabled = true;
      state.config.notifyEnabled = true;
      saveConfig(state.config);
      ctx.ui.notify("Windows通知已开启", "info");
    },
  });

  pi.registerCommand("notify-off", {
    description: "关闭Windows通知功能",
    handler: async (_args, ctx) => {
      state.notifyEnabled = false;
      state.config.notifyEnabled = false;
      saveConfig(state.config);
      ctx.ui.notify("Windows通知已关闭", "info");
    },
  });

  pi.registerCommand("notify-afk-only", {
    description: "开启仅离开窗口时通知模式(在终端内操作时不发通知)",
    handler: async (_args, ctx) => {
      state.config.onlyNotifyWhenAfk = true;
      let hint = "";

      const captured = await captureCurrentWindow(logger);
      if (captured) {
        afkReferenceWindow = captured;
        hint = `\n已记录参考窗口:0x${captured.hwnd.toString(16)} - "${captured.title}"`;
      } else {
        hint = "\n⚠️ 无法获取当前窗口信息,AFK模式不会生效";
      }

      saveConfig(state.config);
      ctx.ui.notify(`已开启AFK模式${hint}`, "info");
    },
  });

  pi.registerCommand("notify-always", {
    description: "恢复普通模式:所有符合条件的任务都发通知",
    handler: async (_args, ctx) => {
      state.config.onlyNotifyWhenAfk = false;
      afkReferenceWindow = null;
      saveConfig(state.config);
      ctx.ui.notify("已恢复普通模式:所有符合条件都发通知", "info");
    },
  });

  pi.registerCommand("notify-status", {
    description: "查看当前通知开关状态",
    handler: async (_args, ctx) => {
      const status = state.notifyEnabled ? "✅ 已开启" : "❌ 已关闭";
      const threshold = (state.config.minTaskDuration / 1000).toFixed(1);
      const mode = state.config.onlyNotifyWhenAfk ? "🧘 仅离开窗口时通知" : "🔔 所有符合条件都通知";
      const afkRefInfo = afkReferenceWindow ? `\n参考窗口:0x${afkReferenceWindow.hwnd.toString(16)} - ${afkReferenceWindow.title}` : "";
      ctx.ui.notify(`通知状态:${status}\n触发阈值:超过${threshold}秒的任务\n当前模式:${mode}${afkRefInfo}`, "info");
    },
  });

  pi.on("session_start", async (_event, _ctx) => {
    logger.info(`Windows notification plugin loaded, enabled: ${state.notifyEnabled}, afk: ${state.config.onlyNotifyWhenAfk}`);
    // 启动时自动捕获AFK参考窗口
    if (needsAfkCapture) {
      const captured = await captureCurrentWindow(logger);
      if (captured) {
        afkReferenceWindow = captured;
        logger.info(`AFK模式重启,自动记录参考窗口:0x${captured.hwnd.toString(16)}`);
      } else {
        logger.warn("AFK模式重启,但无法捕获当前窗口,本次启动不会生效");
        state.config.onlyNotifyWhenAfk = false;
      }
    }
  });
}
