# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本文件是项目的主要 AI Agent 配置。通用 Agent 指导请参考 [AGENTS.md](./AGENTS.md)。

## 项目概述

cligram 是一个通过 Telegram Bot 远程控制终端的命令行工具，支持 tmux 和 cmux 两种终端后端。

## 常用命令

```bash
# 开发模式运行（无需编译）
npm run dev

# 编译 TypeScript
npm run build

# 运行所有测试
npm test

# 运行单个测试文件
node --import tsx --test tests/commands.test.ts

# 前台运行
npm run start

# 系统服务管理
npm run service:install    # 安装并启动服务
npm run service:uninstall  # 卸载服务
cligram status             # 查看服务状态
cligram log                # 查看日志（含配对码）
cligram restart            # 重启服务
```

## 架构概览

### 核心模块

- **src/index.ts** — 入口文件，初始化 bot 和终端后端
- **src/commands.ts** — Telegram 命令处理器（/exec, /cd, /screen, /targets 等）
- **src/config.ts** — 配置加载与解析（~/.cligram/config.json）
- **src/session.ts** — 会话管理（绑定/解绑终端目标）
- **src/output.ts** — 输出捕获与发送（支持 text/image 模式）
- **src/auth.ts** — 用户配对认证
- **src/pair-request.ts** — 配对码生成与验证

### 终端后端 (src/terminal/)

终端后端采用插件式架构，通过 `TerminalBackend` 接口抽象：

- **types.ts** — 核心类型定义（TerminalTarget, TerminalBackend, BackendKind）
- **registry.ts** — 后端注册表，管理多后端生命周期
- **tmux-backend.ts** — tmux 后端实现
- **cmux-backend.ts** — cmux 后端实现（支持超时检测）
- **target-ref.ts** — 目标引用解析（tmux:session, cmux:workspace/surface）

### 关键设计

1. **双后端优先级**：默认 tmux > cmux，通过 `defaultBackendPriority` 控制
2. **目标引用格式**：`tmux:<session>` 或 `cmux:<workspace>/<surface>`
3. **输出模式**：text（纯文本）和 image（截图渲染），可按 chat 切换
4. **配对认证**：Telegram /pair → 本机 cligram pair approve 两步验证

## 测试规范

- 测试文件位于 `tests/` 目录，命名为 `*.test.ts`
- 使用 Node.js 内置测试框架（`node:test`）
- 测试命令：`npm test` 或 `node --import tsx --test tests/<file>.test.ts`
- 测试并发设置为 1（`--test-concurrency=1`）

## 技术栈

- TypeScript (ES2022, Node16 模块)
- ESM 模块系统（"type": "module"）
- Telegraf 4.x（Telegram Bot 框架）
- sharp（图片处理，用于 image 输出模式）

## 配置文件

配置位于 `~/.cligram/config.json`，关键字段：
- `botToken` — Telegram Bot Token（必填）
- `pairedUsers` — 已配对用户 ID 列表
- `outputMode` — 输出模式：text 或 image
- `commandSafetyMode` — 命令安全档位：off/whitelist/blacklist
- `customCommands` — 自定义指令映射

## 注意事项

- 所有 `.js` 导入需显式写扩展名（ESM 要求）
- 终端后端错误需友好处理，返回可用性诊断信息
- cmux CLI 调用有 5 秒超时限制
- 配对码有效期 1 小时，每用户每小时限申请 1 次
