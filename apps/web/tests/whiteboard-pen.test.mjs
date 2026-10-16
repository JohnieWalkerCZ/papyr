import assert from "node:assert/strict";
import test from "node:test";
import { restorePenEraserTool, updatePenEraserTool } from "../src/lib/whiteboard-pen.ts";

function setup(tool = "draw") {
  const editor = {
    tool,
    getCurrentToolId() {
      return this.tool;
    },
    setCurrentTool(value) {
      this.tool = value;
    },
  };
  return { editor, previous: { current: null } };
}

test("pen barrel button temporarily selects eraser and restores the previous tool", () => {
  const { editor, previous } = setup();
  updatePenEraserTool(editor, { pointerType: "pen", buttons: 2 }, previous);
  assert.equal(editor.getCurrentToolId(), "eraser");
  updatePenEraserTool(editor, { pointerType: "pen", buttons: 1 }, previous);
  assert.equal(editor.getCurrentToolId(), "draw");
});

test("pen eraser end selects eraser while mouse buttons are ignored", () => {
  const { editor, previous } = setup("select");
  updatePenEraserTool(editor, { pointerType: "mouse", buttons: 2 }, previous);
  assert.equal(editor.getCurrentToolId(), "select");
  updatePenEraserTool(editor, { pointerType: "pen", buttons: 32 }, previous);
  assert.equal(editor.getCurrentToolId(), "eraser");
  restorePenEraserTool(editor, previous);
  assert.equal(editor.getCurrentToolId(), "select");
});

test("release does not override a tool changed manually while erasing", () => {
  const { editor, previous } = setup();
  updatePenEraserTool(editor, { pointerType: "pen", buttons: 2 }, previous);
  editor.setCurrentTool("hand");
  updatePenEraserTool(editor, { pointerType: "pen", buttons: 0 }, previous);
  assert.equal(editor.getCurrentToolId(), "hand");
});
