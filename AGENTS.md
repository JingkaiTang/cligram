# AGENTS.md

本文件为各类 AI Agent 提供通用开发指导。详细的项目架构和命令说明请参考 [CLAUDE.md](./CLAUDE.md)。

## 快速参考

```bash
# 开发
npm run dev              # 开发模式运行
npm run build            # 编译
npm test                 # 运行所有测试
node --import tsx --test tests/<file>.test.ts  # 单文件测试

# 服务管理
npm run service:install  # 安装服务
cligram status           # 查看状态
cligram restart          # 重启
```

## 项目结构

```
src/
├── index.ts            # 入口
├── commands.ts         # Telegram 命令处理
├── config.ts           # 配置管理
├── session.ts          # 会话管理
├── output.ts           # 输出捕获
├── auth.ts             # 认证
└── terminal/           # 终端后端（tmux/cmux）
    ├── types.ts        # 类型定义
    ├── registry.ts     # 后端注册
    ├── tmux-backend.ts
    └── cmux-backend.ts
```

## 代码规范

- TypeScript ESM 模块，导入需写 `.js` 扩展名
- 测试使用 `node:test` 框架
- 错误处理返回用户友好的诊断信息
- 中文注释和提交信息

## Agent 兼容性

本项目支持以下 AI Agent 工具：

| Agent | 配置文件 | 说明 |
|-------|----------|------|
| Claude Code | [CLAUDE.md](./CLAUDE.md) | 主要配置，包含详细架构说明 |
| Cursor | `.cursorrules` | 可按需创建 |
| GitHub Copilot | `.github/copilot-instructions.md` | 可按需创建 |

## 相关文档

- [CLAUDE.md](./CLAUDE.md) — 完整的项目指导文档
- [README.md](./README.md) — 用户使用指南
