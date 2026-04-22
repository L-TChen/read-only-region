# Read Only Region

This VS Code extension protects selected text ranges by watching document edits and reverting any change that touches a protected range.

VS Code does not provide native read-only spans inside a normal text editor, so this extension uses a workaround:

1. The user marks one or more selections as protected.
2. The extension remembers the last accepted document content.
3. When an edit touches a protected span, the extension reconstructs the document and restores the protected text.

## Commands

- `Read Only Region: Protect Selection`
- `Read Only Region: Clear Protection in Selection`
- `Read Only Region: Clear All Protected Regions`

Protected ranges are highlighted in the editor.

## Installation

### Build the `.vsix`

1. Install dependencies:

```bash
npm install
```

2. Compile the extension:

```bash
npm run compile
```

3. Package the extension as a `.vsix`:

```bash
npm run package:vsix
```

This creates a file like `read-only-region-0.0.1.vsix` in the project root.

### Install the packaged `.vsix`

1. Build or obtain the extension package:
   `read-only-region-0.0.1.vsix`
2. In VS Code, open the Extensions view.
3. Open the Extensions view menu in the top-right corner.
4. Choose `Install from VSIX...`.
5. Select `read-only-region-0.0.1.vsix`.
6. Reload VS Code if prompted.

You can also install from the command line:

```bash
code --install-extension read-only-region-0.0.1.vsix
```

For Cursor:

```bash
cursor --install-extension read-only-region-0.0.1.vsix
```

### Run from source during development

1. Open this folder in VS Code.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` to launch an Extension Development Host window.
5. In that window, open a file and run `Read Only Region: Protect Selection`.

## Usage

1. Select the text you want to protect.
2. Run `Read Only Region: Protect Selection`.
3. Edit the file normally. Changes outside protected spans are preserved.
4. If an edit overlaps a protected span, that part is reverted automatically.

To remove protection from a region:

- Select an overlapping range and run `Read Only Region: Clear Protection in Selection`, or
- Put the cursor inside a protected region and run the same command.

## Limits

- Protection is stored in memory for the current VS Code session.
- Because the behavior is implemented after the edit event, a blocked edit may briefly appear before being reverted.
- Undo history is still managed by VS Code, so protected-region reverts may add extra undo steps depending on the edit.
