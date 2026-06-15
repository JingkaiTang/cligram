# cmux Scrollback Fallback 设计

## 背景

`/screen N` 命令通过 `capturePane(target, lines)` 捕获终端历史内容。对于 tmux 后端，`capture-pane -S -N` 可靠返回 scrollback。对于 cmux 后端，`read-screen --scrollback --lines N` 在大部分 surface 上正常工作，但 **TUI 应用（如 Claude Code）使用的 surface 不返回 scrollback**。

原因：TUI 应用使用 alternate screen buffer，cmux 的 `read-screen --scrollback` 对这类 surface 仅返回当前可见屏幕内容。

用户在 cmux TUI surface 中可以使用鼠标滚轮或 Page Up/Down 翻页，说明 scrollback 内容存在于终端中，只是 cmux API 未能暴露。

## 方案

在 `capturePane` 中自动检测 `--scrollback` 是否有效，无效时 fallback 到 `send-key pageup` 滚动捕获。

### 检测逻辑

调用 `read-screen --scrollback --lines N` 后，比较返回行数与请求行数：

- `scrollbackLines > lines * 0.5` → scrollback 有效，直接返回
- 否则 → fallback 到 pageup 滚动捕获

阈值 50% 足以区分"有 scrollback"（通常返回数百行）和"无 scrollback"（仅返回 ~50 行可见屏幕）。

### Pageup 滚动捕获

`captureByPageScroll(runCmux, target, totalLines)` 辅助函数：

1. 计算需要的页数：`pages = Math.ceil(totalLines / visibleLines)`
2. 循环 `pages` 次：
   a. `read-screen` 捕获当前屏幕 → 存入数组
   b. 如果本次内容与上次相同 → 到达顶部，break
   c. `send-key pageup` + `sleep(300ms)`
3. 清理：发送 `pagedown` x 实际滚动页数 回到底部
4. 拼接所有页内容返回（从当前页到最旧页）

关键设计点：
- **去重检测**：连续两次 `read-screen` 内容相同说明已到顶部，提前停止
- **300ms 等待**：实测足够让 cmux 屏幕更新
- **pagedown 清理**：捕获完自动恢复用户终端视图

### 实现位置

修改 `src/terminal/cmux-backend.ts`：
- 修改 `capturePane` 方法，加入检测 + fallback 逻辑
- 新增 `captureByPageScroll` 辅助函数（模块内部）

不修改 `TerminalBackend` 接口，不修改 `output.ts` 或 `commands.ts`。所有调用方（`sendScreen`、`captureAndSend`、`monitor`）自动受益。

## 测试

修改 `tests/cmux-backend.test.ts`，新增 4 个测试用例：

1. **scrollback 有效时正常返回**：mock `--scrollback` 返回足够行数，验证不触发 fallback
2. **scrollback 无效时 fallback**：mock `--scrollback` 返回 ≈ 可见行数，验证发送了 pageup/pagedown
3. **到顶部提前停止**：mock 连续两次 read-screen 返回相同内容，验证提前退出循环
4. **捕获后回到底部**：验证最终发送了正确数量的 pagedown

使用现有 `fakeDeps` mock 模式，通过 `calls` 数组验证 cmux CLI 调用序列。
