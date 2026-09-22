<template>
  <div class="code-editor" :class="{ 'is-readonly': readOnly }">
    <div ref="editorHost" class="code-editor__surface" />
  </div>
</template>

<script setup lang="ts">
import { EditorState, type Extension } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { searchKeymap } from "@codemirror/search";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: "json" | "ssh";
    readOnly?: boolean;
  }>(),
  { language: "json", readOnly: false },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const editorHost = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--m3-on-surface)",
    backgroundColor: "#f8fafc",
    fontFamily: '"SF Mono", "SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: "12px",
  },
  ".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
  ".cm-content": { minHeight: "100%", padding: "14px 0 28px" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": {
    backgroundColor: "#eef2f7",
    color: "#91a0b4",
    border: "0",
    borderRight: "1px solid #d9e1eb",
  },
  ".cm-activeLine": { backgroundColor: "rgba(35, 100, 210, 0.055)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(35, 100, 210, 0.09)" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#cfe0ff !important" },
  ".cm-focused": { outline: "none" },
  ".cm-search": {
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #d9e1eb",
    padding: "6px 8px",
  },
  ".cm-button": { fontFamily: "inherit" },
});

function languageExtension(): Extension {
  return props.language === "json" ? json() : [];
}

function createEditor(): EditorView | null {
  if (!editorHost.value) return null;
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        highlightActiveLine(),
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.lineWrapping,
        EditorState.readOnly.of(props.readOnly),
        EditorView.editable.of(!props.readOnly),
        languageExtension(),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit("update:modelValue", update.state.doc.toString());
          }
        }),
      ],
    }),
    parent: editorHost.value,
  });
  return view;
}

watch(
  () => props.modelValue,
  (value) => {
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  },
);

watch(
  () => [props.language, props.readOnly] as const,
  () => {
    if (!view) return;
    const value = view.state.doc.toString();
    view.destroy();
    view = null;
    if (editorHost.value) {
      editorHost.value.replaceChildren();
      const nextView = createEditor();
      if (nextView && nextView.state.doc.toString() !== value) {
        nextView.dispatch({ changes: { from: 0, to: nextView.state.doc.length, insert: value } });
      }
    }
  },
);

function focus() {
  view?.focus();
}

defineExpose({ focus });

onMounted(createEditor);
onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<style scoped lang="scss">
.code-editor {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid #d9e1eb;
  border-radius: 12px;
  background: #f8fafc;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);

  &.is-readonly {
    opacity: 0.92;
  }
}

.code-editor__surface {
  height: 100%;
  min-height: 0;
}
</style>
