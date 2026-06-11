import {
  TerminalTargetError,
  type CmuxTarget,
  type TerminalTarget,
  type TmuxTarget,
} from "./types.js";

export type AttachRef =
  | { kind: "target"; target: TerminalTarget }
  | { kind: "legacy-tmux"; sessionName: string };

type TargetLike =
  | ({ backend: "tmux" } & Partial<TmuxTarget>)
  | ({ backend: "cmux" } & Partial<CmuxTarget>);

export function formatTargetRef(target: TargetLike): string {
  if (target.backend === "tmux") {
    if (!target.tmuxSession) {
      throw new TerminalTargetError("tmux target 缺少 session 名称");
    }
    return `tmux:${target.tmuxSession}`;
  }

  if (!target.cmuxSurface) {
    throw new TerminalTargetError("cmux target 缺少 surface");
  }
  if (target.cmuxWorkspace) {
    return `cmux:${target.cmuxWorkspace}/${target.cmuxSurface}`;
  }
  return `cmux:${target.cmuxSurface}`;
}

export function parseTargetRef(value: string): TerminalTarget {
  const raw = value.trim();
  if (!raw) {
    throw new TerminalTargetError("目标不能为空");
  }

  const separatorIndex = raw.indexOf(":");
  if (separatorIndex < 0) {
    throw new TerminalTargetError("缺少后端前缀，请使用 tmux:<session> 或 cmux:<surface>");
  }

  const backend = raw.slice(0, separatorIndex);
  const body = raw.slice(separatorIndex + 1);
  if (backend === "tmux") {
    return parseTmuxTarget(body);
  }
  if (backend === "cmux") {
    return parseCmuxTarget(body);
  }

  throw new TerminalTargetError(`不支持的目标后端 "${backend}"，支持 tmux 和 cmux`);
}

export function parseAttachRef(value: string): AttachRef {
  const raw = value.trim();
  if (!raw) {
    throw new TerminalTargetError("目标不能为空");
  }

  if (!raw.includes(":")) {
    return { kind: "legacy-tmux", sessionName: raw };
  }

  return { kind: "target", target: parseTargetRef(raw) };
}

function parseTmuxTarget(body: string): TmuxTarget {
  if (!body || body.includes("/") || body.includes(":")) {
    throw new TerminalTargetError("tmux target 格式应为 tmux:<session>");
  }

  return {
    backend: "tmux",
    id: body,
    label: body,
    ref: `tmux:${body}`,
    tmuxSession: body,
  };
}

function parseCmuxTarget(body: string): CmuxTarget {
  if (!body) {
    throw new TerminalTargetError("cmux target 格式应为 cmux:<surface> 或 cmux:<workspace>/<surface>");
  }

  const parts = body.split("/");
  if (parts.length === 1) {
    const surface = parts[0];
    if (!surface) {
      throw new TerminalTargetError("cmux target 缺少 surface");
    }
    return {
      backend: "cmux",
      id: surface,
      label: surface,
      ref: `cmux:${surface}`,
      cmuxWorkspace: undefined,
      cmuxSurface: surface,
    };
  }

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new TerminalTargetError("cmux target 格式应为 cmux:<surface> 或 cmux:<workspace>/<surface>");
  }

  const [workspace, surface] = parts;
  const id = `${workspace}/${surface}`;
  return {
    backend: "cmux",
    id,
    label: id,
    ref: `cmux:${id}`,
    cmuxWorkspace: workspace,
    cmuxSurface: surface,
  };
}
