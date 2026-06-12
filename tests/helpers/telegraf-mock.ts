/**
 * Telegraf mock 工具，用于测试命令处理器
 */

export interface MockReply {
  text: string;
  options?: unknown;
}

export interface MockContext {
  chat: { id: number };
  from: { id: number; username?: string };
  message: { text: string };
  reply: (text: string, options?: unknown) => Promise<void>;
  telegram: {
    sendMessage: (chatId: number, text: string, options?: unknown) => Promise<void>;
  };
}

type MiddlewareFn = (ctx: MockContext, next: () => Promise<void>) => Promise<void> | void;
type HandlerFn = (ctx: MockContext) => Promise<void> | void;

export interface MockBot {
  start: (...args: any[]) => void;
  command: (name: string, ...args: any[]) => void;
  on: (filter: unknown, ...args: any[]) => void;
  /** 获取已注册的命令处理器（自动处理中间件链） */
  getHandler: (name: string) => HandlerFn | undefined;
  /** 获取 start 处理器 */
  getStartHandler: () => HandlerFn | undefined;
  /** 获取 text 消息处理器 */
  getTextHandler: () => HandlerFn | undefined;
}

export function createMockContext(overrides: Partial<MockContext> = {}): MockContext {
  const replies: MockReply[] = [];
  const sentMessages: Array<{ chatId: number; text: string; options?: unknown }> = [];

  const ctx: MockContext = {
    chat: { id: 100 },
    from: { id: 42, username: "testuser" },
    message: { text: "" },
    reply: async (text: string, options?: unknown) => {
      replies.push({ text, options });
    },
    telegram: {
      sendMessage: async (chatId: number, text: string, options?: unknown) => {
        sentMessages.push({ chatId, text, options });
      },
    },
    ...overrides,
  };

  // 附加收集器到 ctx 上以便测试断言
  (ctx as any).__replies = replies;
  (ctx as any).__sentMessages = sentMessages;

  return ctx;
}

export function getReplies(ctx: MockContext): MockReply[] {
  return (ctx as any).__replies ?? [];
}

export function getSentMessages(ctx: MockContext): Array<{ chatId: number; text: string; options?: unknown }> {
  return (ctx as any).__sentMessages ?? [];
}

/**
 * 将中间件链组合成单个处理器
 */
function composeMiddleware(args: any[]): HandlerFn {
  // 提取所有函数参数（中间件和最终处理器）
  const fns: Array<(ctx: MockContext, next: () => Promise<void>) => Promise<void> | void> = [];
  for (const arg of args) {
    if (typeof arg === "function") {
      fns.push(arg);
    }
  }

  if (fns.length === 0) {
    return async () => {};
  }

  // 返回一个组合后的处理器，自动执行中间件链
  return async (ctx: MockContext) => {
    let index = 0;
    const next = async (): Promise<void> => {
      if (index < fns.length) {
        const fn = fns[index++];
        await fn(ctx, next);
      }
    };
    await next();
  };
}

export function createMockBot(): MockBot {
  const commands = new Map<string, HandlerFn>();
  let startHandler: HandlerFn | undefined;
  let textHandler: HandlerFn | undefined;

  const bot: MockBot = {
    start: (...args: any[]) => {
      startHandler = composeMiddleware(args);
    },
    command: (name: string, ...args: any[]) => {
      commands.set(name, composeMiddleware(args));
    },
    on: (_filter: unknown, ...args: any[]) => {
      textHandler = composeMiddleware(args);
    },
    getHandler: (name: string) => commands.get(name),
    getStartHandler: () => startHandler,
    getTextHandler: () => textHandler,
  };

  return bot;
}
