import { Annotation, EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

// SSH 配置按行解析：指令、Host / Match 区段、参数和注释各有语义色。
const ssh = StreamLanguage.define({
  name: "ssh-config",
  startState: () => ({ directive: true }),
  token(stream, state) {
    if (stream.sol()) state.directive = true;
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (state.directive) {
      state.directive = false;
      if (stream.match(/^[a-zA-Z][\w-]*/)) {
        return /^(Host|Match|Include)$/i.test(stream.current()) ? "keyword" : "propertyName";
      }
    }
    if (stream.eat("=")) return "operator";
    if (stream.match(/^"(?:[^"\\]|\\.)*(?:"|$)|^'(?:[^'\\]|\\.)*(?:'|$)/)) return "string";
    if (stream.match(/^[^\s=]+/)) {
      const value = stream.current();
      if (/^\d+$/.test(value)) return "number";
      if (/^(yes|no|true|false|none)$/i.test(value)) return "bool";
      return "string";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
});

const highlighting = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--code-property)" },
  { tag: tags.string, color: "var(--code-string)" },
  { tag: tags.number, color: "var(--code-number)" },
  { tag: [tags.keyword, tags.bool, tags.null], color: "var(--code-keyword)" },
  { tag: tags.comment, color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [tags.punctuation, tags.operator], color: "var(--color-graphite-text)" },
]);

/* 代码区走独立石墨面（docs/design/specification.md §8.1），底色 / 文字读 graphite token；
   行号、语法、选区和当前行共用固定深色阅读角色。 */
const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--color-graphite)",
      color: "var(--color-graphite-text)",
      fontSize: "14px",
      colorScheme: "dark",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "var(--font-mono)",
      fontSize: "14px",
      lineHeight: "1.55",
    },
    ".cm-content": { padding: "10px 0", caretColor: "var(--color-graphite-text)" },
    ".cm-line": { padding: "0 12px" },
    ".cm-line:hover": { backgroundColor: "var(--code-active-line)" },
    ".cm-gutters": { backgroundColor: "var(--color-graphite)", color: "var(--code-comment)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 8px" },
    ".cm-activeLine, .cm-activeLine:hover": {
      backgroundColor: "var(--code-active-line)",
      boxShadow: "inset 2px 0 var(--code-property)",
    },
    ".cm-activeLineGutter": { backgroundColor: "var(--code-active-line)", color: "var(--color-graphite-text)" },
    ".cm-selectionBackground": { backgroundColor: "var(--code-selection)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "var(--code-selection)",
    },
    // drawSelection 绘制选区底色；原生选中文字保持亮色，覆盖浅色壳的 ink。
    ".cm-content ::selection, .cm-content::selection": { color: "var(--color-graphite-text) !important" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-graphite-text)", borderLeftWidth: "2px" },
  },
  { dark: true },
);

// Controlled value updates are loads, not edits made in the editor.
const valueSync = Annotation.define<boolean>();

export function CodeSurface({
  value,
  language = "ssh",
  readOnly = true,
  onChange,
}: {
  value: string;
  language?: "json" | "ssh";
  readOnly?: boolean;
  onChange?: (value: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          language === "json" ? json() : ssh,
          syntaxHighlighting(highlighting),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            "aria-label": language === "json" ? "JSON 文本" : "SSH 配置文本",
            ...(readOnly ? { tabindex: "0" } : {}),
          }),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && update.transactions.some((tr) => tr.docChanged && !tr.annotation(valueSync))) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [language, readOnly]);

  useEffect(() => {
    const parent = hostRef.current;
    const view = parent?.querySelector(".cm-editor");
    if (!view) return;
    const editor = EditorView.findFromDOM(view as HTMLElement);
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: valueSync.of(true),
    });
  }, [value]);

  return <div ref={hostRef} className="cm-editor-host h-full min-h-[240px]" />;
}
