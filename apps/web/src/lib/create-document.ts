import { createNote, type LocalNote } from "./local-db";
import { scheduleSync } from "./sync";

export async function createLocalDocument(type: LocalNote["type"], title: string, folderId: string | null) {
  const note = await createNote(title, type, undefined, folderId);
  scheduleSync();
  return note;
}
