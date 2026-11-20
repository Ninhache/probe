import { describe, expect, it } from "vitest";
import { commandForm } from "../src/checkers/command-form";
import { splitWords, wordsText } from "../src/config/shell-words";
import { formFields, formProblem, formRows, formValues } from "../src/dashboard/form";

const WORDS: string[][] = [
  ["psql", "-h", "127.0.0.1", "-p", "5432", "-U", "root", "-d", "wakfuli", "-c", "select 1"],
  ["echo", "it's", 'say "hi"', "both ' and \""],
  ["echo", "", "x"],
  ["echo", "$HOME", "$" + "{VAR}", "*.ts", "~", "`id`"],
  ["echo", "C:\\dir\\file", 'a\\"b', "\\"],
  ["echo", "héllo wörld", "日本語", "🙂"],
  ["["],
  ["[", "-f", "ready", "]"],
];

describe("words of a command", () => {
  it("should show a list the way a shell takes it", () => {
    expect(wordsText(WORDS[0] as string[])).toBe(
      `psql -h 127.0.0.1 -p 5432 -U root -d wakfuli -c 'select 1'`,
    );
  });

  it.each(WORDS)("should read back a list of %j exactly", (...words) => {
    expect(splitWords(wordsText(words))).toEqual(words);
  });

  it("should read both kinds of quotes and escapes", () => {
    expect(splitWords(`a "b c" 'd e' f\\ g "h\\"i" "j\\\\k" "l\\m" 'n\\o' ''`)).toEqual([
      "a",
      "b c",
      "d e",
      "f g",
      'h"i',
      "j\\k",
      "l\\m",
      "n\\o",
      "",
    ]);
  });

  it("should join quoted parts into one word and expand nothing", () => {
    expect(splitWords(`a"b c"'d'$HOME *.ts ~`)).toEqual(["ab cd$HOME", "*.ts", "~"]);
  });

  it("should refuse a quote that is never closed", () => {
    expect(splitWords(`a "b c`)).toBeUndefined();
    expect(splitWords(`a 'b c`)).toBeUndefined();
  });
});

describe("the form of a command that is a list", () => {
  const list = ["psql", "-c", "select 1", "$HOME"];
  const form = commandForm.forService?.({ type: "command", command: list }) ?? commandForm;
  const rows = formRows(false, form);

  it("should show the words and write the list back unchanged", () => {
    const values = formValues({ command: list }, form);

    expect(values.command).toBe(`psql -c 'select 1' '$HOME'`);
    expect(formFields(values, form).command).toEqual(list);
  });

  it("should write the list of what was edited", () => {
    const values = { ...formValues({ command: list }, form), command: `ls "my dir"` };

    expect(formFields(values, form).command).toEqual(["ls", "my dir"]);
  });

  it("should say a quote is not closed", () => {
    const values = { ...formValues({ command: list }, form), command: `ls "my dir` };

    expect(formProblem(rows, values, [], form)?.message).toContain("quote is not closed");
  });

  it("should refuse an empty command", () => {
    const values = { ...formValues({ command: list }, form), command: "  " };

    expect(formProblem(rows, values, [], form)).toBeDefined();
  });

  it("should leave a string command as it is", () => {
    const string = commandForm.forService?.({ type: "command", command: "[ -f ready ]" });

    expect(string).toBe(commandForm);
    expect(formValues({ command: "[ -f ready ]" }, commandForm).command).toBe("[ -f ready ]");
  });

  it("should keep a new command as a string unless a JSON array is typed", () => {
    const typed = (command: string) => formFields({ command, headers: [] }, commandForm).command;

    expect(typed("redis-cli ping")).toBe("redis-cli ping");
    expect(typed('["docker", "ps"]')).toEqual(["docker", "ps"]);
  });
});
