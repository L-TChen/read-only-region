import * as vscode from "vscode";

type OffsetRange = {
  start: number;
  end: number;
};

type DocumentState = {
  acceptedText: string;
  protectedRegions: OffsetRange[];
  applyingRevert: boolean;
};

const documentStates = new Map<string, DocumentState>();

const protectedDecoration = vscode.window.createTextEditorDecorationType({
  backgroundColor: "rgba(255, 200, 0, 0.18)",
  border: "1px solid rgba(255, 179, 0, 0.45)",
  borderRadius: "3px"
});

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(protectedDecoration);

  context.subscriptions.push(
    vscode.commands.registerCommand("readOnlyRegion.protectSelection", protectSelection),
    vscode.commands.registerCommand("readOnlyRegion.clearSelection", clearSelection),
    vscode.commands.registerCommand("readOnlyRegion.clearAll", clearAllProtectedRegions),
    vscode.workspace.onDidChangeTextDocument((event) => {
      void handleDocumentChange(event);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      documentStates.delete(document.uri.toString());
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      refreshAllVisibleDecorations();
    })
  );

  refreshAllVisibleDecorations();
}

export function deactivate(): void {
  documentStates.clear();
}

async function protectSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Open an editor before protecting a region.");
    return;
  }

  const regions = editor.selections
    .filter((selection) => !selection.isEmpty)
    .map((selection) => toOffsetRange(editor.document, selection));

  if (regions.length === 0) {
    void vscode.window.showWarningMessage("Select a text range to protect.");
    return;
  }

  const document = editor.document;
  const state = getOrCreateState(document);
  state.acceptedText = document.getText();
  state.protectedRegions = mergeRanges([...state.protectedRegions, ...regions]);

  refreshDecorations(document);
  void vscode.window.showInformationMessage(`Added ${regions.length} protected region${regions.length === 1 ? "" : "s"}.`);
}

async function clearSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Open an editor before clearing protected regions.");
    return;
  }

  const document = editor.document;
  const state = documentStates.get(document.uri.toString());
  if (!state || state.protectedRegions.length === 0) {
    void vscode.window.showInformationMessage("There are no protected regions in this document.");
    return;
  }

  state.acceptedText = document.getText();
  const targets = editor.selections.map((selection) => (
    selection.isEmpty
      ? toPointRange(document, selection.active)
      : toOffsetRange(document, selection)
  ));

  const nextRegions = state.protectedRegions.filter((region) => {
    return !targets.some((target) => targetMatchesRegion(target, region));
  });

  state.protectedRegions = mergeRanges(nextRegions);
  refreshDecorations(document);

  if (state.protectedRegions.length === 0) {
    documentStates.delete(document.uri.toString());
  }

  void vscode.window.showInformationMessage("Cleared matching protected regions.");
}

async function clearAllProtectedRegions(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Open an editor before clearing protected regions.");
    return;
  }

  documentStates.delete(editor.document.uri.toString());
  refreshDecorations(editor.document);
  void vscode.window.showInformationMessage("Cleared all protected regions in the active document.");
}

async function handleDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
  const document = event.document;
  const state = documentStates.get(document.uri.toString());
  if (!state) {
    return;
  }

  if (state.applyingRevert) {
    state.applyingRevert = false;
    state.acceptedText = document.getText();
    refreshDecorations(document);
    return;
  }

  if (state.protectedRegions.length === 0) {
    state.acceptedText = document.getText();
    return;
  }

  let nextText = state.acceptedText;
  let nextRegions = state.protectedRegions.map(cloneRange);
  let blockedChangeCount = 0;

  const changes = [...event.contentChanges].sort((left, right) => right.rangeOffset - left.rangeOffset);

  for (const change of changes) {
    const changeStart = change.rangeOffset;
    const changeEnd = change.rangeOffset + change.rangeLength;

    if (touchesProtectedRegion(changeStart, changeEnd, nextRegions)) {
      blockedChangeCount += 1;
      continue;
    }

    nextText = applyTextChange(nextText, changeStart, change.rangeLength, change.text);
    nextRegions = shiftRangesAfterChange(nextRegions, changeStart, changeEnd, change.text.length - change.rangeLength);
  }

  state.acceptedText = nextText;
  state.protectedRegions = mergeRanges(nextRegions);
  refreshDecorations(document);

  if (document.getText() === nextText) {
    return;
  }

  state.applyingRevert = true;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, entireDocumentRange(document), nextText);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    state.applyingRevert = false;
    void vscode.window.showWarningMessage("Read Only Region could not restore the protected text.");
    return;
  }

  if (blockedChangeCount > 0) {
    void vscode.window.setStatusBarMessage("Read Only Region reverted edits inside a protected range.", 2500);
  }
}

function getOrCreateState(document: vscode.TextDocument): DocumentState {
  const key = document.uri.toString();
  const existing = documentStates.get(key);
  if (existing) {
    return existing;
  }

  const created: DocumentState = {
    acceptedText: document.getText(),
    protectedRegions: [],
    applyingRevert: false
  };

  documentStates.set(key, created);
  return created;
}

function refreshAllVisibleDecorations(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    refreshDecorations(editor.document);
  }
}

function refreshDecorations(document: vscode.TextDocument): void {
  const ranges = documentStates.get(document.uri.toString())?.protectedRegions ?? [];
  const decorations = ranges.map((region) => {
    const start = document.positionAt(region.start);
    const end = document.positionAt(region.end);
    return new vscode.Range(start, end);
  });

  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === document.uri.toString()) {
      editor.setDecorations(protectedDecoration, decorations);
    }
  }
}

function toOffsetRange(document: vscode.TextDocument, selection: vscode.Selection): OffsetRange {
  return {
    start: document.offsetAt(selection.start),
    end: document.offsetAt(selection.end)
  };
}

function toPointRange(document: vscode.TextDocument, position: vscode.Position): OffsetRange {
  const offset = document.offsetAt(position);
  return { start: offset, end: offset };
}

function touchesProtectedRegion(changeStart: number, changeEnd: number, regions: OffsetRange[]): boolean {
  for (const region of regions) {
    if (changeStart === changeEnd) {
      if (changeStart > region.start && changeStart < region.end) {
        return true;
      }

      continue;
    }

    if (changeStart < region.end && changeEnd > region.start) {
      return true;
    }
  }

  return false;
}

function shiftRangesAfterChange(
  regions: OffsetRange[],
  changeStart: number,
  changeEnd: number,
  delta: number
): OffsetRange[] {
  return regions.map((region) => {
    if (changeEnd <= region.start) {
      return {
        start: region.start + delta,
        end: region.end + delta
      };
    }

    if (changeStart >= region.end) {
      return cloneRange(region);
    }

    throw new Error("Allowed change unexpectedly overlapped a protected region.");
  });
}

function applyTextChange(text: string, rangeOffset: number, rangeLength: number, insertedText: string): string {
  return text.slice(0, rangeOffset) + insertedText + text.slice(rangeOffset + rangeLength);
}

function mergeRanges(ranges: OffsetRange[]): OffsetRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = ranges
    .map(cloneRange)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: OffsetRange[] = [sorted[0]];
  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function rangesOverlap(left: OffsetRange, right: OffsetRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function targetMatchesRegion(target: OffsetRange, region: OffsetRange): boolean {
  if (target.start === target.end) {
    return target.start > region.start && target.start < region.end;
  }

  return rangesOverlap(target, region);
}

function cloneRange(range: OffsetRange): OffsetRange {
  return {
    start: range.start,
    end: range.end
  };
}

function entireDocumentRange(document: vscode.TextDocument): vscode.Range {
  const textLength = document.getText().length;
  return new vscode.Range(document.positionAt(0), document.positionAt(textLength));
}
