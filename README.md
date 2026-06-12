# cligram

通过 Telegram Bot 远程控制终端的命令行工具，支持 tmux 与 cmux 终端目标。

在手机上打开 Telegram，就能随时随地操作你电脑上的终端——执行命令、查看输出、管理终端目标。

## 功能特性

- 通过 Telegram 消息远程执行终端命令
- 基于 tmux 或 cmux 的持久终端目标，断连不丢失
- 支持文本 / 图片两种输出模式（图片模式适合手机端阅读）
- 屏幕变化自动推送，无需手动刷新
- 与本地终端（iTerm2 / Terminal.app）共享 tmux 会话，也可连接 cmux surface
- 自定义指令映射，一键执行常用命令
- 配对码 + 本机确认双重认证，防止未授权访问
- 支持 macOS (launchd) 和 Linux (systemd) 系统服务

## 前置要求

- [Node.js](https://nodejs.org/) >= 18
- 一个 Telegram 账号
- 至少一个可用终端后端：[tmux](https://github.com/tmux/tmux) 或 cmux

### 安装 tmux

```bash
# macOS
brew install tmux

# Ubuntu / Debian
sudo apt install tmux

# CentOS / Fedora
sudo dnf install tmux
```

### 使用 cmux

如果使用 cmux，请先安装并启动 cmux。macOS app 内置 CLI 时，可以在配置中通过 `cmuxPath` 指定 CLI 路径。

cmux 默认的 socket 控制模式只允许 cmux 内部启动的终端进程访问；cligram 通常作为 launchd 服务或普通 shell 进程运行，不属于 cmux 子进程，因此需要打开 cmux 的外部自动化访问：

1. 打开 cmux 设置，进入 **Automation**。
2. 将 **Socket Control Mode** 改为 **Automation Mode**。
3. 重启 cmux app，让 socket server 读取新的控制模式。
4. 在普通终端中验证外部 CLI 是否可访问：

   ```bash
   /Applications/cmux.app/Contents/Resources/bin/cmux tree --all --json
   ```

   如果命令能输出 JSON，cligram 就可以通过 `/targets` 或 `/sessions` 列出 cmux surface。

如果仍然看到 `Failed to write to socket (Broken pipe, errno 32)`，通常表示 cmux 仍处于默认的 `cmuxOnly` 控制模式，或者改完 Automation Mode 后还没有重启 cmux app。

可选配置：

```json
{
  "cmuxPath": "/Applications/cmux.app/Contents/Resources/bin/cmux"
}
```

`cmuxPath` 为空时，cligram 会先从 `PATH` 查找 `cmux`，再尝试 macOS app 内置路径。

## 第一步：创建 Telegram Bot

如果你还没有 Telegram Bot，需要先创建一个。整个过程在 Telegram 里完成。

1. 在 Telegram 中搜索 **@BotFather**，打开对话
2. 发送 `/newbot`
3. BotFather 会问你 bot 的显示名称，输入一个你喜欢的名字（比如 `My Terminal`）
4. 接下来输入 bot 的用户名，必须以 `bot` 结尾（比如 `my_terminal_bot`）
5. 创建成功后 BotFather 会回复一段消息，其中包含一串 **token**，格式类似：
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ```
6. **复制这个 token**，后面配置时要用

> 提示：如果想给 bot 设置头像，可以继续在 BotFather 中发送 `/setuserpic`。

## 第二步：安装 cligram

```bash
git clone <your-repo-url> cligram
cd cligram
npm install
```

## 第三步：配置

创建配置文件：

```bash
mkdir -p ~/.cligram
cp config.example.json ~/.cligram/config.json
```

编辑 `~/.cligram/config.json`，将 `botToken` 替换为你在第一步中获取的 token：

```json
{
  "botToken": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
  "pairedUsers": [],
  "outputMode": "text",
  "outputModeByChat": {},
  "sessionStartDir": "",
  "commandSafetyMode": "off",
  "commandAllowlist": [],
  "commandBlocklist": [],
  "tmuxSocket": "",
  "cmuxPath": "",
  "terminal": "iterm2"
}
```

其余字段可先保持默认，后续根据需要调整。

## 第四步：启动

有两种方式运行 cligram：

### 方式一：作为系统服务（推荐）

```bash
npm run service:install
```

这会自动编译项目、注册系统服务、安装全局 `cligram` 命令，并立即启动。

安装过程中会执行环境自检（`node`/`npm`、终端后端可用性、服务管理器可用性、目录写权限、配置文件可读性），失败时会给出具体修复提示。

安装完成后，用 `cligram` 命令管理服务：

```bash
cligram status     # 查看服务状态
cligram log        # 查看日志（包含配对码）
cligram stop       # 停止服务
cligram start      # 启动服务
cligram restart    # 重启服务
cligram uninstall  # 卸载服务
```

### 方式二：前台运行

```bash
npm run build
npm run start
```

或使用开发模式（无需编译）：

```bash
npm run dev
```

## 第五步：配对

配对分两步：

1. 在 Telegram 中发送 `/pair`，机器人会返回一个配对码（包含大写字母和数字）。
2. 在 cligram 所在机器执行：

```bash
cligram pair approve <配对码>
```

执行成功后，该 Telegram 用户即完成授权。

说明：
- 同一个用户 1 小时内只能申请 1 次 `/pair`。
- 配对码默认 1 小时有效，过期后需要重新申请。
- 管理员可在本机查看待审批队列：`cligram pair ls`。

## 使用指南

### 基本操作

在 Telegram 中直接和 bot 对话即可控制终端：

| 指令 | 说明 |
|------|------|
| `/exec <command>` | 执行命令（如 `/exec ls -la`） |
| `/cd <path>` | 切换目录 |
| `/ls` | 列出当前目录文件 |
| `/pwd` | 显示当前目录 |
| `/screen [n]` | 截屏（n 为页数，默认 1） |
| `/mode [text\|image]` | 查看或切换输出模式 |
| `/new` | 新建终端目标 |
| `/pair` | 申请配对码（需本机执行 `cligram pair approve <配对码>` 批准） |

直接输入文本（不带 `/`）会将内容发送到终端，但不按回车。适合交互式输入。

### 按键操作

| 指令 | 说明 |
|------|------|
| `/enter` | 回车键 |
| `/up` `/down` `/left` `/right` | 方向键 |
| `/esc` | Escape 键 |
| `/ctrl + <key>` | Ctrl 组合键（如 `/ctrl + c`） |
| `/alt + <key>` | Alt 组合键 |
| `/shift + <key>` | Shift 组合键 |
| `/cmd + <key>` | Cmd 组合键（映射为 Ctrl） |

### 终端目标管理

cligram 支持管理 tmux session 与 cmux surface。tmux 默认使用系统 socket，可与本地终端共享所有 session。
cmux 需要先在 cmux 设置中开启 Automation Mode，并重启 cmux app 后，外部进程才能通过 cmux CLI 列出和控制 surface。

| 指令 | 说明 |
|------|------|
| `/targets` | 列出所有终端目标 |
| `/sessions` | 兼容别名，等同于 `/targets` |
| `/attach <target>` | 绑定到指定终端目标 |
| `/detach` | 解绑当前终端目标 |
| `/open` | 在本机终端中打开当前目标；当前主要用于 tmux，本机 cmux target 可能返回暂不支持 |

`target` 支持以下引用格式：

- `tmux:<session>`：tmux session
- `cmux:<surface>`：当前 cmux workspace 下的 surface
- `cmux:<workspace>/<surface>`：指定 cmux workspace 下的 surface

兼容旧用法：`/attach work` 会按 tmux session 处理，等同于 `/attach tmux:work`。

例如，在 iTerm2 中创建了一个 tmux session：

```bash
tmux new -s work
```

在 Telegram 中就可以：

```
/targets        → 列出所有终端目标，会看到 "tmux:work"
/attach work    → 切换到 work session（兼容旧用法）
/open           → 在 iTerm2 中也打开 work session
```

### 自定义指令

在配置文件中添加 `customCommands`，可以定义快捷指令：

```json
{
  "customCommands": {
    "git": { "command": "git $args", "description": "Git 操作" },
    "top": { "command": "htop", "description": "系统监控" },
    "df":  { "command": "df -h", "description": "磁盘用量" }
  }
}
```

然后在 Telegram 中直接使用 `/git status`、`/top`、`/df` 等。

`$args` 会被替换为指令后面的参数。

自定义指令名必须符合 Telegram 规范：仅允许 `a-z`、`0-9`、`_`，长度 1-32。非法名称会在启动解析配置时被跳过并打印警告。

## 配置参考

完整配置字段说明：

```json
{
  "botToken": "你的 Telegram Bot Token",
  "pairedUsers": [],
  "outputMode": "text",
  "outputModeByChat": {},
  "sessionStartDir": "",
  "commandSafetyMode": "off",
  "commandAllowlist": [],
  "commandBlocklist": [],
  "outputDelayMs": 500,
  "pollIntervalMs": 5000,
  "idleTimeoutMs": 30000,
  "screenLines": 50,
  "tmuxSocket": "",
  "cmuxPath": "",
  "terminal": "iterm2",
  "font": {
    "family": "Menlo, 'SF Mono', Consolas, monospace",
    "size": 14,
    "lineHeight": 18,
    "charWidth": 8.4
  },
  "customCommands": {}
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `botToken` | string | *必填* | Telegram Bot Token |
| `pairedUsers` | number[] | `[]` | 已配对的用户 ID 列表（自动维护） |
| `outputMode` | string | `"text"` | 输出模式：`text` 或 `image` |
| `outputModeByChat` | object | `{}` | 按 chatId 保存的输出模式；未命中时回退到 `outputMode` |
| `sessionStartDir` | string | `""` | 新建终端目标起始目录；对 tmux/cmux 创建命令均适用，空值表示用户 HOME |
| `commandSafetyMode` | string | `"off"` | 命令安全档位：`off`/`whitelist`/`blacklist` |
| `commandAllowlist` | string[] | `[]` | `whitelist` 模式下允许执行的命令名（首 token） |
| `commandBlocklist` | string[] | `[]` | `blacklist` 模式下禁止执行的命令名（首 token） |
| `outputDelayMs` | number | `500` | 命令执行后等待输出的延迟（毫秒） |
| `pollIntervalMs` | number | `5000` | 屏幕监控轮询间隔（毫秒） |
| `idleTimeoutMs` | number | `30000` | 屏幕无变化自动停止监控的超时（毫秒） |
| `screenLines` | number | `50` | `/screen` 截屏每页行数 |
| `tmuxSocket` | string | `""` | tmux socket 路径，空则使用系统默认 |
| `cmuxPath` | string | `""` | cmux CLI 路径，空则从 PATH 查找 |
| `terminal` | string | `""` | `/open` 使用的终端程序；当前主要用于 tmux，本机 cmux target 可能返回暂不支持 |
| `font` | object | *见下* | 图片模式字体配置 |
| `customCommands` | object | `{}` | 自定义指令映射 |

### tmuxSocket

- `""` — 使用系统默认 tmux socket，cligram 与 iTerm2 等终端共享所有 session
- 填写路径 — 使用独立 socket，cligram 的 session 与其他终端隔离

### sessionStartDir

- `""`（默认）— 新建终端目标从用户 HOME 目录启动
- 填写绝对路径 — 新建终端目标从指定目录启动

### cmuxPath

- `""` — 从 PATH 查找 `cmux`
- 填写路径 — 使用指定 cmux CLI，例如 macOS app 内置 CLI 路径：`/Applications/cmux.app/Contents/Resources/bin/cmux`

使用 cmux 时，还需要在 cmux app 中将 **Settings > Automation > Socket Control Mode** 设置为 **Automation Mode**，然后重启 cmux app。可以用下面的命令确认外部 CLI 已经可用：

```bash
/Applications/cmux.app/Contents/Resources/bin/cmux tree --all --json
```

如果该命令在普通终端中失败，但在 cmux 内部终端中成功，说明外部自动化访问还没有生效。

### terminal

用于 `/open` 指令，在本机终端打开当前目标。当前主要用于 tmux，本机 cmux target 可能返回暂不支持：

- `"iterm2"` — 内置预设，通过 AppleScript 打开 iTerm2 新窗口
- `"terminal"` — 内置预设，macOS 自带 Terminal.app
- 自定义命令 — 支持 `$SESSION` 和 `$SOCKET` 占位符，如 `"alacritty -e tmux attach -t $SESSION"`
- `""` — 不配置，`/open` 指令不可用

### 命令安全档位

- 当前作用于 `/exec` 与自定义指令执行路径。
- `commandSafetyMode: "off"` — 不限制命令执行（默认）
- `commandSafetyMode: "whitelist"` — 仅允许 `commandAllowlist` 中的命令（按首 token 匹配）
- `commandSafetyMode: "blacklist"` — 拒绝 `commandBlocklist` 中的命令（按首 token 匹配）

### font

图片模式下终端截图的渲染字体：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `family` | `"Menlo, 'SF Mono', ..."` | CSS font-family 字体族 |
| `size` | `14` | 字号（px） |
| `lineHeight` | `18` | 行高（px） |
| `charWidth` | `8.4` | 等宽字符宽度（px） |

## 系统服务

### macOS (launchd)

`npm run service:install` 会在 `~/Library/LaunchAgents/` 下创建 plist 文件，登录后自动启动。

### Linux (systemd)

`npm run service:install` 会在 `~/.config/systemd/user/` 下创建 unit 文件，使用 `systemctl --user` 管理，不需要 root 权限。

VPS / SSH 场景建议（重要）：

- 必须启用 user linger，否则退出 SSH 后 `systemd --user` 可能停止，Bot 会离线。
- 安装脚本会自动检查 `linger`，未开启时会提示并可引导执行：

```bash
sudo loginctl enable-linger "$USER"
```

可手动检查：

```bash
loginctl show-user "$USER" -p Linger
```

### 日志

日志文件位于：

- 标准输出：`~/.cligram/cligram.log`
- 错误输出：`~/.cligram/cligram.err`

## 测试

运行单元测试：

```bash
npm test
```

当前覆盖重点：配置解析、配对流程、终端目标映射、命令解析、输出分块。

## License

MIT
