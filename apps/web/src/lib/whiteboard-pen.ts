type ToolEditor = { getCurrentToolId(): string; setCurrentTool(id: string): unknown };
type PreviousTool = { current: string | null };

const PEN_BARREL_BUTTON = 2;
const PEN_ERASER_BUTTON = 32;

export function updatePenEraserTool(
  editor: ToolEditor,
  event: Pick<PointerEvent, "pointerType" | "buttons">,
  previousTool: PreviousTool,
) {
  if (event.pointerType !== "pen") return;
  if (event.buttons & (PEN_BARREL_BUTTON | PEN_ERASER_BUTTON)) {
    const currentTool = editor.getCurrentToolId();
    if (previousTool.current === null && currentTool !== "eraser") {
      previousTool.current = currentTool;
      editor.setCurrentTool("eraser");
    }
  } else {
    restorePenEraserTool(editor, previousTool);
  }
}

export function restorePenEraserTool(editor: ToolEditor, previousTool: PreviousTool) {
  const tool = previousTool.current;
  previousTool.current = null;
  if (tool && editor.getCurrentToolId() === "eraser") editor.setCurrentTool(tool);
}
