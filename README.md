# cligram

通过 Telegram Bot 远程控制终端的命令行工具，基于 tmux 管理会话。

在手机上打开 Telegram，就能随时随地操作你电脑上的终端——执行命令、查看输出、管理会话。

## 功能特性

- 通过 Telegram 消息远程执行终端命令
- 基于 tmux 的持久会话，断连不丢失
- 支持文本 / 图片两种输出模式（图片模式适合手机端阅读）
- 屏幕变化自动推送，无需手动刷新
- 与本地终端（iTerm2 / Terminal.app）共享 tmux 会话
- 自定义指令映射，一键执行常用命令
- 配对码认证，防止未授权访问
- 支持 macOS (launchd) 和 Linux (systemd) 系统服务

## 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [tmux](https://github.com/tmux/tmux)
- 一个 Telegram 账号

### 安装 tmux

```bash
# macOS
brew install tmux

# Ubuntu / Debian
sudo apt install tmux

# CentOS / Fedora
sudo dnf install tmux
```

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
  "tmuxSocket": "",
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

启动后终端（或日志）中会显示一个 **配对码**：

```
=================================
  cligram 已启动
  配对码: a1b2c3
=================================
```

在 Telegram 中打开你的 bot，发送：

```
/pair a1b2c3
```

配对成功后即可开始使用。

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
| `/new` | 新建终端会话 |

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

### 会话管理

cligram 默认使用系统 tmux socket，与本地终端共享所有 session：

| 指令 | 说明 |
|------|------|
| `/sessions` | 列出所有 tmux 会话 |
| `/attach <session>` | 绑定到指定的 tmux 会话 |
| `/detach` | 解绑当前会话 |
| `/open` | 在本机终端中打开当前会话 |

例如，在 iTerm2 中创建了一个 tmux session：

```bash
tmux new -s work
```

在 Telegram 中就可以：

```
/sessions       → 列出所有 session，会看到 "work"
/attach work    → 切换到 work session
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

## 配置参考

完整配置字段说明：

```json
{
  "botToken": "你的 Telegram Bot Token",
  "pairedUsers": [],
  "outputMode": "text",
  "outputDelayMs": 500,
  "pollIntervalMs": 5000,
  "idleTimeoutMs": 30000,
  "screenLines": 50,
  "tmuxSocket": "",
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
| `outputDelayMs` | number | `500` | 命令执行后等待输出的延迟（毫秒） |
| `pollIntervalMs` | number | `5000` | 屏幕监控轮询间隔（毫秒） |
| `idleTimeoutMs` | number | `30000` | 屏幕无变化自动停止监控的超时（毫秒） |
| `screenLines` | number | `50` | `/screen` 截屏每页行数 |
| `tmuxSocket` | string | `""` | tmux socket 路径，空则使用系统默认 |
| `terminal` | string | `""` | `/open` 使用的终端程序 |
| `font` | object | *见下* | 图片模式字体配置 |
| `customCommands` | object | `{}` | 自定义指令映射 |

### tmuxSocket

- `""` — 使用系统默认 tmux socket，cligram 与 iTerm2 等终端共享所有 session
- 填写路径 — 使用独立 socket，cligram 的 session 与其他终端隔离

### terminal

用于 `/open` 指令，在本机终端打开当前 session：

- `"iterm2"` — 内置预设，通过 AppleScript 打开 iTerm2 新窗口
- `"terminal"` — 内置预设，macOS 自带 Terminal.app
- 自定义命令 — 支持 `$SESSION` 和 `$SOCKET` 占位符，如 `"alacritty -e tmux attach -t $SESSION"`
- `""` — 不配置，`/open` 指令不可用

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

### 日志

日志文件位于：

- 标准输出：`~/.cligram/cligram.log`
- 错误输出：`~/.cligram/cligram.err`

## License

MIT
