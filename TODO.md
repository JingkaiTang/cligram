# TODO

## P0 - 高优先级

- [x] 持久化输出模式：`/mode` 当前只改内存，重启后丢失。将模式更新写回配置文件。
  - 涉及：`src/config.ts` `src/commands.ts`
- [x] 让配对状态写盘可等待：`tryPair/unpair` 现在异步落盘且未等待，异常退出可能丢状态。
  - 涉及：`src/auth.ts` `src/commands.ts`
- [x] 强化配对安全：增加配对码有效期（TTL）、失败次数限制、冷却时间。
  - 涉及：`src/auth.ts`
- [x] 将输出模式改为按 chat 隔离，避免多用户互相影响。
  - 涉及：`src/config.ts` `src/commands.ts` `src/output.ts`
- [x] 修复 `openInTerminal` 命令拼接的转义/注入风险，统一参数转义。
  - 涉及：`src/tmux.ts`

## P1 - 中优先级

- [x] 优化监控器生命周期：`monitors` stop 后清理，`unpair` 时清理，避免长期运行积累。
  - 涉及：`src/output.ts` `src/commands.ts`
- [x] 优化轮询策略：减少固定轮询 + 全量 capture 的开销（增量检测或 hook）。
  - 涉及：`src/output.ts` `src/tmux.ts`
- [x] 增加命令执行“安全档位”：支持可选白名单/黑名单，降低远程执行风险。
  - 涉及：`src/commands.ts` `src/config.ts`
- [x] 严格校验自定义命令名：限制为 Telegram 合法命令字符集，并在配置解析阶段报错/警告。
  - 涉及：`src/config.ts`
- [x] 统一错误处理与日志：减少静默吞错，增加结构化日志与可定位上下文。
  - 涉及：`src/auth.ts` `src/tmux.ts` `src/output.ts`

## P2 - 低优先级

- [x] 提升服务脚本鲁棒性：补充环境自检（node/tmux/path/权限）及更明确的修复提示。
  - 涉及：`scripts/service.sh`
- [x] 补充测试覆盖：优先配置解析、配对流程、会话映射、命令解析、输出分块。
  - 涉及：`src/config.ts` `src/auth.ts` `src/session.ts` `src/commands.ts` `src/output.ts`
