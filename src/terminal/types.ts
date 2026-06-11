export type BackendKind = "tmux" | "cmux";

export interface BaseTerminalTarget {
  backend: BackendKind;
  id: string;
  label: string;
  ref: string;
}

export interface TmuxTarget extends BaseTerminalTarget {
  backend: "tmux";
  tmuxSession: string;
}

export interface CmuxTarget extends BaseTerminalTarget {
  backend: "cmux";
  cmuxWorkspace?: string;
  cmuxSurface: string;
}

export type TerminalTarget = TmuxTarget | CmuxTarget;

export interface BackendAvailability {
  available: boolean;
  reason?: string;
  detail?: string;
}

export interface CreateTargetOptions {
  cwd?: string;
  name?: string;
}

export interface TerminalBackend {
  kind: BackendKind;
  isAvailable(): Promise<BackendAvailability>;
  defaultTarget(chatId: number): Promise<TerminalTarget>;
  createTarget(chatId: number, options?: CreateTargetOptions): Promise<TerminalTarget>;
  targetExists(target: TerminalTarget): Promise<boolean>;
  listTargets(): Promise<TerminalTarget[]>;
  sendText(target: TerminalTarget, text: string): Promise<void>;
  sendTextAndEnter(target: TerminalTarget, text: string): Promise<void>;
  sendKey(target: TerminalTarget, key: string): Promise<void>;
  capturePane(target: TerminalTarget, lines?: number): Promise<string>;
  captureVisible(target: TerminalTarget): Promise<string>;
  targetSignature(target: TerminalTarget): Promise<string>;
  openInTerminal(target: TerminalTarget): Promise<void>;
}

export class TerminalTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalTargetError";
  }
}
