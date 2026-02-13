#!/usr/bin/env bash
#
# cligram 服务管理脚本（支持 macOS launchd / Linux systemd）
# 用法: scripts/service.sh <install|uninstall|start|stop|restart|status|log>
#

set -euo pipefail

# ── 平台检测 ──

OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)
    echo "错误: 不支持的操作系统 $OS（仅支持 macOS 和 Linux）"
    exit 1
    ;;
esac

# ── 公共变量 ──

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/.cligram"
LOG_FILE="$LOG_DIR/cligram.log"
ERR_FILE="$LOG_DIR/cligram.err"
ENTRY_POINT="${PROJECT_DIR}/dist/index.js"

# 探测 node 绝对路径
NODE_BIN="$(which node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  echo "错误: 找不到 node，请确保 node 已安装并在 PATH 中"
  exit 1
fi

# 探测 tmux 所在目录，加入 PATH
TMUX_BIN="$(which tmux 2>/dev/null || true)"
EXTRA_PATHS=""
if [ -n "$TMUX_BIN" ]; then
  EXTRA_PATHS="$(dirname "$TMUX_BIN")"
fi

# 构建 PATH: node 所在目录 + tmux 所在目录 + 常见路径
SERVICE_PATH="$(dirname "$NODE_BIN")"
if [ -n "$EXTRA_PATHS" ] && [ "$EXTRA_PATHS" != "$(dirname "$NODE_BIN")" ]; then
  SERVICE_PATH="${SERVICE_PATH}:${EXTRA_PATHS}"
fi
SERVICE_PATH="${SERVICE_PATH}:/usr/local/bin:/usr/bin:/bin"

# ── macOS launchd ──

LABEL="com.cligram"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

generate_plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${ENTRY_POINT}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${SERVICE_PATH}</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>

    <key>StandardErrorPath</key>
    <string>${ERR_FILE}</string>
</dict>
</plist>
EOF
}

# ── Linux systemd ──

UNIT_NAME="cligram"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_PATH="${UNIT_DIR}/${UNIT_NAME}.service"

generate_unit() {
  cat <<EOF
[Unit]
Description=cligram - Telegram Bot 远程终端控制
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
ExecStart=${NODE_BIN} ${ENTRY_POINT}
Restart=always
RestartSec=5
Environment=PATH=${SERVICE_PATH}
Environment=HOME=${HOME}
StandardOutput=append:${LOG_FILE}
StandardError=append:${ERR_FILE}

[Install]
WantedBy=default.target
EOF
}

# ── 统一命令实现 ──

ensure_built() {
  if [ ! -f "$ENTRY_POINT" ]; then
    echo "dist/index.js 不存在，先执行编译..."
    (cd "$PROJECT_DIR" && npm run build)
  fi
}

cmd_install() {
  ensure_built
  mkdir -p "$LOG_DIR"

  # 注册全局 CLI 命令
  echo "注册 cligram 命令..."
  (cd "$PROJECT_DIR" && npm link 2>/dev/null) || echo "警告: npm link 失败，cligram 命令可能不可用（可尝试 sudo npm link）"

  if [ "$PLATFORM" = "macos" ]; then
    if [ -f "$PLIST_PATH" ]; then
      echo "检测到已有服务，先卸载..."
      cmd_uninstall_service
    fi
    mkdir -p "$(dirname "$PLIST_PATH")"
    generate_plist > "$PLIST_PATH"
    launchctl load "$PLIST_PATH"
    echo ""
    echo "cligram 服务已安装并启动 (launchd)"
    echo ""
    echo "  plist: $PLIST_PATH"
  else
    if [ -f "$UNIT_PATH" ]; then
      echo "检测到已有服务，先卸载..."
      cmd_uninstall_service
    fi
    mkdir -p "$UNIT_DIR"
    generate_unit > "$UNIT_PATH"
    systemctl --user daemon-reload
    systemctl --user enable --now "$UNIT_NAME"
    echo ""
    echo "cligram 服务已安装并启动 (systemd)"
    echo ""
    echo "  unit: $UNIT_PATH"
  fi

  echo "  日志: $LOG_FILE"
  echo "  错误: $ERR_FILE"
  echo ""
  echo "配对码请查看日志: cligram log"
  echo ""
  echo "现在可以使用 cligram 命令管理服务:"
  echo "  cligram status    查看状态"
  echo "  cligram stop      停止服务"
  echo "  cligram start     启动服务"
  echo "  cligram restart   重启服务"
  echo "  cligram log       查看日志"
  echo "  cligram uninstall 卸载服务"
}

# 仅卸载系统服务（不移除 CLI，供 install 内部复用）
cmd_uninstall_service() {
  if [ "$PLATFORM" = "macos" ]; then
    if [ ! -f "$PLIST_PATH" ]; then
      return
    fi
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm -f "$PLIST_PATH"
  else
    if [ ! -f "$UNIT_PATH" ]; then
      return
    fi
    systemctl --user disable --now "$UNIT_NAME" 2>/dev/null || true
    rm -f "$UNIT_PATH"
    systemctl --user daemon-reload
  fi
}

cmd_uninstall() {
  cmd_uninstall_service

  # 移除全局 CLI 命令
  echo "移除 cligram 命令..."
  (cd "$PROJECT_DIR" && npm unlink 2>/dev/null) || true

  echo "cligram 服务已卸载"
}

cmd_start() {
  if [ "$PLATFORM" = "macos" ]; then
    if [ ! -f "$PLIST_PATH" ]; then
      echo "服务未安装，请先执行: cligram install"
      exit 1
    fi
    launchctl load "$PLIST_PATH" 2>/dev/null || true
  else
    if [ ! -f "$UNIT_PATH" ]; then
      echo "服务未安装，请先执行: cligram install"
      exit 1
    fi
    systemctl --user start "$UNIT_NAME"
  fi
  echo "cligram 服务已启动"
}

cmd_stop() {
  if [ "$PLATFORM" = "macos" ]; then
    if [ ! -f "$PLIST_PATH" ]; then
      echo "服务未安装"
      return
    fi
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
  else
    if [ ! -f "$UNIT_PATH" ]; then
      echo "服务未安装"
      return
    fi
    systemctl --user stop "$UNIT_NAME" 2>/dev/null || true
  fi
  echo "cligram 服务已停止"
}

cmd_restart() {
  if [ "$PLATFORM" = "macos" ]; then
    cmd_stop
    sleep 1
    cmd_start
  else
    if [ ! -f "$UNIT_PATH" ]; then
      echo "服务未安装，请先执行: cligram install"
      exit 1
    fi
    systemctl --user restart "$UNIT_NAME"
    echo "cligram 服务已重启"
  fi
}

cmd_status() {
  if [ "$PLATFORM" = "macos" ]; then
    local info
    info="$(launchctl list 2>/dev/null | grep "$LABEL" || true)"
    if [ -z "$info" ]; then
      if [ -f "$PLIST_PATH" ]; then
        echo "cligram: 已安装但未运行"
      else
        echo "cligram: 未安装"
      fi
    else
      local pid
      pid="$(echo "$info" | awk '{print $1}')"
      if [ "$pid" = "-" ]; then
        echo "cligram: 已注册但进程未运行"
      else
        echo "cligram: 运行中 (PID $pid)"
      fi
    fi
  else
    if [ ! -f "$UNIT_PATH" ]; then
      echo "cligram: 未安装"
      return
    fi
    systemctl --user status "$UNIT_NAME" --no-pager 2>/dev/null || true
  fi
}

cmd_enable() {
  if [ "$PLATFORM" = "macos" ]; then
    if [ ! -f "$PLIST_PATH" ]; then
      echo "服务未安装，请先执行: cligram install"
      exit 1
    fi
    # 将 RunAtLoad 设置为 true
    if command -v plutil &>/dev/null; then
      plutil -replace RunAtLoad -bool true "$PLIST_PATH"
    else
      # fallback: sed 替换
      sed -i '' 's|<key>RunAtLoad</key>.*<false/>|<key>RunAtLoad</key>\n    <true/>|' "$PLIST_PATH" 2>/dev/null || true
    fi
    echo "cligram 开机启动已开启"
  else
    if [ ! -f "$UNIT_PATH" ]; then
      echo "服务未安装，请先执行: cligram install"
      exit 1
    fi
    systemctl --user enable "$UNIT_NAME"
    echo "cligram 开机启动已开启"
  fi
}

cmd_disable() {
  if [ "$PLATFORM" = "macos" ]; then
    if [ ! -f "$PLIST_PATH" ]; then
      echo "服务未安装"
      return
    fi
    # 将 RunAtLoad 设置为 false
    if command -v plutil &>/dev/null; then
      plutil -replace RunAtLoad -bool false "$PLIST_PATH"
    else
      sed -i '' 's|<key>RunAtLoad</key>.*<true/>|<key>RunAtLoad</key>\n    <false/>|' "$PLIST_PATH" 2>/dev/null || true
    fi
    echo "cligram 开机启动已关闭（服务仍在运行，重启后不再自动启动）"
  else
    if [ ! -f "$UNIT_PATH" ]; then
      echo "服务未安装"
      return
    fi
    systemctl --user disable "$UNIT_NAME"
    echo "cligram 开机启动已关闭（服务仍在运行，重启后不再自动启动）"
  fi
}

cmd_log() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "日志文件不存在: $LOG_FILE"
    exit 1
  fi
  tail -f "$LOG_FILE"
}

# ── main ──

case "${1:-}" in
  install)   cmd_install   ;;
  uninstall) cmd_uninstall ;;
  start)     cmd_start     ;;
  stop)      cmd_stop      ;;
  restart)   cmd_restart   ;;
  enable)    cmd_enable    ;;
  disable)   cmd_disable   ;;
  status)    cmd_status    ;;
  log)       cmd_log       ;;
  *)
    echo "用法: $0 <install|uninstall|start|stop|restart|enable|disable|status|log>"
    echo ""
    echo "  install   — 编译项目、注册并启动服务"
    echo "  uninstall — 停止并移除服务"
    echo "  start     — 启动服务"
    echo "  stop      — 停止服务"
    echo "  restart   — 重启服务"
    echo "  enable    — 开启开机自动启动"
    echo "  disable   — 关闭开机自动启动"
    echo "  status    — 查看服务状态"
    echo "  log       — 实时查看日志"
    echo ""
    if [ "$PLATFORM" = "macos" ]; then
      echo "当前平台: macOS (launchd)"
    else
      echo "当前平台: Linux (systemd --user)"
    fi
    exit 1
    ;;
esac
