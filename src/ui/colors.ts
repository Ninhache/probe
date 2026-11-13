export interface Colors {
  green(text: string): string;
  red(text: string): string;
  yellow(text: string): string;
  dim(text: string): string;
  bold(text: string): string;
}

export function colorEnabled(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): boolean {
  return Boolean(stream.isTTY) && !env.NO_COLOR;
}

export function createColors(enabled: boolean): Colors {
  const wrap = (open: number, close: number) => (text: string) =>
    enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  return {
    green: wrap(32, 39),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}
