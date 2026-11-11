import type { EditingState } from "./types";

// Selection is transient UI state; stale saved carets must not place library inserts.
const selected = { positive: [] as string[], negative: [] as string[] };
export function rememberPromptSelection(negative: boolean, ids: string[]) {
  selected[negative ? "negative" : "positive"] = ids;
}
export function promptInsertionStart(
  state: EditingState,
  negative = state.IsNegative,
) {
  const workspace = negative ? state.Negative : state.Positive;
  const ids = selected[negative ? "negative" : "positive"];
  return (
    workspace.Active.find((term) => ids.includes(term.Id))?.Start ??
    workspace.Text.length
  );
}
