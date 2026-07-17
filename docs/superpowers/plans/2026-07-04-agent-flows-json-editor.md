# Agent Flows Code Editor Mode (JSON) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON Code Editor mode to the Agent Flows builder, allowing users to directly edit the underlying JSON configuration instead of using the visual blocks.

**Architecture:** A lightweight JSON text editor (using `<textarea>`) will be added to the Agent Builder interface. State will manage toggling between "Visual" and "Code" modes. Converting from Visual to Code serializes blocks to JSON. Converting from Code to Visual parses JSON, validates it, and updates the blocks. Invalid JSON will display an error and prevent saving.

**Tech Stack:** React, TailwindCSS

---

## File Map

- Modify `frontend/src/pages/Admin/AgentBuilder/index.jsx` to manage `editorMode` state, handle JSON parsing/serialization, and conditionally render the code editor.
- Modify `frontend/src/pages/Admin/AgentBuilder/HeaderMenu.jsx` to include a toggle button for switching modes.
- Create `frontend/src/pages/Admin/AgentBuilder/JsonEditor.jsx` for the text area and syntax validation.

### Task 1: Create the JsonEditor component

**Files:**
- Create: `frontend/src/pages/Admin/AgentBuilder/JsonEditor.jsx`

- [ ] **Step 1: Implement the editor component**
Create a component that accepts `value`, `onChange`, and `error` props. It should render a styled `<textarea>` with monospace font and a dark/light theme background. If `error` is present, it should render the error message below the textarea.

### Task 2: Add mode toggle to HeaderMenu

**Files:**
- Modify: `frontend/src/pages/Admin/AgentBuilder/HeaderMenu.jsx`

- [ ] **Step 1: Add toggle button**
Add props for `editorMode` and `onToggleMode`. Add a toggle UI (button or switch) in the header to switch between "Visual" and "Code" modes.

### Task 3: Integrate editor mode into AgentBuilder

**Files:**
- Modify: `frontend/src/pages/Admin/AgentBuilder/index.jsx`

- [ ] **Step 1: Add state and JSON conversion logic**
Add `[editorMode, setEditorMode] = useState("visual")` and `[jsonContent, setJsonContent] = useState("")` and `[jsonError, setJsonError] = useState(null)`.

- [ ] **Step 2: Handle mode switching**
When switching to "code" mode, serialize the `blocks` state to JSON (excluding `flow_info` and `finish` specifics if needed, or serialize the whole `flowEntity` equivalent).
When switching to "visual" mode, parse the JSON. If parsing fails, set `jsonError` and prevent switching or saving.

- [ ] **Step 3: Update render**
Conditionally render either the `BlockList` and `AddBlockMenu`, or the `JsonEditor` based on `editorMode`.

- [ ] **Step 4: Update saveFlow logic**
Ensure `saveFlow` uses the parsed JSON content if saved while in "code" mode. If the JSON is invalid, block saving and show a toast error.

### Task 4: Full verification

- [ ] **Step 1: Manual testing**
Verify that switching between modes preserves data.
Verify that typing invalid JSON shows an error.
Verify that saving from Code mode works correctly.
