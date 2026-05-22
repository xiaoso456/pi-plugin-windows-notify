[简体中文](./README.zh-CN.md) | English
# pi-windows-tip

A [pi](https://github.com/earendil-works/pi) extension that sends Windows desktop notifications when tasks complete, fail, or need your confirmation — so you can step away and come back when Pi needs you.

> ⚠️ **Windows only** — this extension uses Windows-specific APIs and will not work on other platforms.
>
> Compatible with both [Pi](https://github.com/earendil-works/pi) and [OMP (Oh My Pi)](https://github.com/can1357/oh-my-pi).

## Features

- Task completion / failure / confirmation-request notifications
- AFK mode — only notify when you're away from the Pi window
- Minimum task duration filter (skip trivially short tasks)
- 7 languages (en, zh-CN, ja, ko, es, fr, ru) — auto-detected from system locale
- Persistent settings across sessions

## Install

**Pi:**

```bash
pi install npm:@xiaoso/pi-plugin-windows-notify
```

**OMP:**

```bash
omp plugin install @xiaoso/pi-plugin-windows-notify
```

Or from git:

```bash
pi install git:github.com/xiaoso456/pi-plugin-windows-notify
```

## Commands

```text
/notify    — open notification settings
```

## Settings

| Setting | Values | Description |
|---|---|---|
| Enabled | on / off | Master switch |
| Notify Mode | afk / all | afk: only notify when away; all: always notify |
| Language | en / zh-CN / ja / ko / es / fr / ru | Display language |

Config file (Pi): `~/.pi/agent/pi-windows-tip-config.json`
Config file (OMP): `~/.omp/agent/pi-windows-tip-config.json`

## How it works

Listens to Pi lifecycle events and sends notifications via [node-notifier](https://github.com/mikaelbr/node-notifier). In AFK mode, [active-win](https://github.com/sindresorhus/active-win) checks whether the foreground window is still Pi — notifications are suppressed while you're watching.


## License

MIT
