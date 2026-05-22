[English](./README.md) | 简体中文
# pi-windows-tip

一个 [pi](https://github.com/earendil-works/pi) 扩展，在任务完成、失败或需要你确认时发送 Windows 桌面通知——让你可以离开工位，Pi 需要你时再回来。

> ⚠️ **仅限 Windows** — 本扩展使用 Windows 专用 API，无法在其他平台运行。
>
> 同时兼容 [Pi](https://github.com/earendil-works/pi) 和 [OMP (Oh My Pi)](https://github.com/can1357/oh-my-pi)。

## 功能

- 任务完成 / 失败 / 需要确认时发送通知
- AFK 模式——仅在你离开 Pi 窗口时通知
- 最小任务时长过滤（跳过过短任务）
- 7 种语言（en, zh-CN, ja, ko, es, fr, ru）——自动检测系统语言
- 设置跨会话持久化

## 安装

**Pi:**

```bash
pi install npm:@xiaoso/pi-plugin-windows-notify
```

**OMP:**

```bash
omp plugin install @xiaoso/pi-plugin-windows-notify
```

或从 Git 安装：

```bash
pi install git:github.com/xiaoso456/pi-plugin-windows-notify
```

## 命令

```text
/notify    — 打开通知设置
```

## 设置

| 设置项 | 可选值 | 说明 |
|---|---|---|
| Enabled | on / off | 总开关 |
| Notify Mode | afk / all | afk：仅离开窗口时通知；all：始终通知 |
| Language | en / zh-CN / ja / ko / es / fr / ru | 显示语言 |

配置文件 (Pi)：`~/.pi/agent/pi-windows-tip-config.json`
配置文件 (OMP)：`~/.omp/agent/pi-windows-tip-config.json`

## 工作原理

监听 Pi 生命周期事件，通过 [node-notifier](https://github.com/mikaelbr/node-notifier) 发送通知。AFK 模式下，使用 [active-win](https://github.com/sindresorhus/active-win) 检测当前前台窗口是否仍为 Pi——如果你正在看 Pi，则抑制通知。

## 许可证

MIT
