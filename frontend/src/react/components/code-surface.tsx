import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { searchKeymap } from "@codemirror/search";
import {
  EditorView,
  drawSelection,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

/* 代码区走独立石墨面（DESIGN.md §8.1），底色 / 文字读 graphite token；
   行号、当前行等编辑器主题色按规范例外保留硬编码。 */
const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--color-graphite)",
      color: "var(--color-graphite-text)",
      fontSize: "14px",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "var(--font-mono)",
      fontSize: "14px",
      lineHeight: "1.55",
    },
    ".cm-gutters": { backgroundColor: "var(--color-graphite)", color: "#8b98a8", border: "none" },
    ".cm-activeLine": { backgroundColor: "#232830" },
  },
  { dark: true },
);

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
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          language === "json" ? json() : [],
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
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
    });
  }, [value]);

  return <div ref={hostRef} className="cm-editor-host h-full min-h-[240px]" />;
}
