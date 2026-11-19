import type { Modal } from "../../tui/modal";
import { defaultTheme as t } from "../../tui/theme";
import { strWidth } from "../../tui/width";
import type { News } from "../../update/whats-new";

/** Notes wrap here, as the terminal width is not known when the dashboard opens. */
const WRAP_WIDTH = 54;
const PADDING = 2;
const MARK_WIDTH = 2;

/** `text` cut at spaces into lines of at most `width` columns. */
function wrapped(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && strWidth(`${line} ${word}`) > width) {
      out.push(line);
      line = word;
    } else line = line === "" ? word : `${line} ${word}`;
  }
  return [...out, line];
}

/** "What's new": the notes of an update, closed with Esc. */
export function whatsNewModal(news: News): Modal {
  const rows = news.lines.flatMap(({ mark, text }) =>
    wrapped(text, WRAP_WIDTH).map((part, i) => ({ mark: i === 0 ? mark : " ", text: part })),
  );
  const widest = Math.max(
    strWidth(news.link),
    ...rows.map(({ text }) => strWidth(text) + MARK_WIDTH),
  );
  return {
    title: `What's new · ${news.version}`,
    footer: "esc close",
    size: { w: widest + 2 * PADDING + 2, h: rows.length + 4 },
    draw(screen, inner) {
      const x = inner.x + PADDING;
      rows.forEach(({ mark, text }, i) => {
        const y = inner.y + i;
        screen.text(x, y, mark, { fg: mark === "!" ? t.warn : t.accent, bold: true }, inner.w);
        screen.text(x + MARK_WIDTH, y, text, { fg: t.fg }, inner.w);
      });
      screen.text(x, inner.y + rows.length + 1, news.link, { fg: t.muted }, inner.w);
    },
  };
}
