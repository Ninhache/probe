/** Whether the locale names a UTF-8 charset. */
export function utf8Locale(env: NodeJS.ProcessEnv): boolean {
  return /UTF-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || "");
}

export const NOTIFY_SEND = (title: string, text: string): string[] => [
  "notify-send",
  "--app-name=probe",
  "--",
  title,
  text,
];
