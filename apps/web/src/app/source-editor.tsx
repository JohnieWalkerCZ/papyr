"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const markdownMarkHighlight = HighlightStyle.define([
  { tag: tags.processingInstruction, class: "papyr-markdown-mark" },
]);

const typst = StreamLanguage.define({
  token(stream) {
    if (stream.match(/\/\/.*$/)) return "comment";
    if (stream.match(/"(?:[^"\\]|\\.)*"|`[^`]*`/)) return "string";
    if (stream.match(/#(?:let|set|show|import|include|if|else|for|while|context|align|text|image|figure)\b/))
      return "keyword";
    if (stream.match(/\b\d+(?:\.\d+)?(?:pt|mm|cm|in|em|%)?\b/)) return "number";
    if (stream.match(/[()[\]{}]/)) return "bracket";
    stream.next();
    return null;
  },
});
const editable = new Compartment();

export function SourceEditor({
  value,
  onChange,
  type,
  readOnly = false,
  label,
  editorRef,
}: {
  value: string;
  onChange: (value: string) => void;
  type: "markdown" | "typst";
  readOnly?: boolean;
  label: string;
  editorRef?: MutableRefObject<EditorView | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValue = useRef(value);
  const readOnlyRef = useRef(readOnly);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  useEffect(() => {
    if (!host.current) return;
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          basicSetup,
          type === "markdown" ? markdown() : typst,
          type === "markdown" ? syntaxHighlighting(markdownMarkHighlight) : [],
          EditorView.lineWrapping,
          editable.of([
            EditorState.readOnly.of(readOnlyRef.current),
            EditorView.editable.of(!readOnlyRef.current),
            EditorView.contentAttributes.of({
              "aria-label": label,
              "aria-multiline": "true",
              "aria-readonly": String(readOnlyRef.current),
            }),
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !readOnlyRef.current) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = instance;
    if (editorRef) editorRef.current = instance;
    if (!readOnlyRef.current) instance.focus();
    return () => {
      view.current = null;
      if (editorRef) editorRef.current = null;
      instance.destroy();
    };
  }, [type, label, editorRef]);

  useEffect(() => {
    const instance = view.current;
    if (instance && instance.state.doc.toString() !== value) {
      instance.dispatch({
        changes: { from: 0, to: instance.state.doc.length, insert: value },
        selection: { anchor: value.length },
      });
    }
  }, [value]);

  useEffect(() => {
    const instance = view.current;
    if (instance)
      instance.dispatch({
        effects: editable.reconfigure([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-multiline": "true",
            "aria-readonly": String(readOnly),
          }),
        ]),
      });
  }, [readOnly, label]);

  return <div className="source-editor" ref={host} />;
}
