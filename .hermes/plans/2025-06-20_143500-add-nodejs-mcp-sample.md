# Add Node.js MCP Tool Sample Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Provide a reference implementation of a Node.js-based MCP server within the project.

**Architecture:** A standalone Node.js/TypeScript MCP server located in `examples/mcp-sample` that provides basic calculator tools.

**Tech Stack:** Node.js, TypeScript, @modelcontextprotocol/sdk

---

### Task 1: Create directory structure

**Objective:** Create the directory for the MCP sample.

**Files:**
- Create: `examples/mcp-sample`

**Step 1: Create directory**
Run: `mkdir -p examples/mcp-sample`

**Step 2: Commit**
```bash
git add examples/mcp-sample
git commit -m "chore: create mcp-sample directory"
```

### Task 2: Initialize Node.js project

**Objective:** Initialize a TypeScript project with necessary configurations.

**Files:**
- Create: `examples/mcp-sample/package.json`
- Create: `examples/mcp-sample/tsconfig.json`

**Step 1: Write package.json**
```json
{
  "name": "mcp-sample",
  "version": "1.0.0",
  "description": "Node.js MCP server sample",
  "main": "build/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node build/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Step 2: Write tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

**Step 3: Install dependencies**
Run: `cd examples/mcp-sample && yarn install`

**Step 4: Commit**
```bash
git add examples/mcp-sample
git commit -m "chore: initialize mcp-sample project"
```

### Task 3: Implement Calculator MCP Server

**Objective:** Create the core logic for the MCP server providing addition and multiplication tools.

**Files:**
- Create: `examples/mcp-sample/src/index.ts`

**Step 1: Write implementation**
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { stdioTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({
  name: "calculator-sample",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "add") {
    const a = Number(args?.a);
    const b = Number(args?.b);
    if (isNaN(a) || isNaN(b)) {
      return { content: [{ type: "text", text: "Invalid numbers provided" }], isError: true };
    }
    return {
      content: [{ type: "text", text: String(a + b) }],
    };
  }

  if (name === "multiply") {
    const a = Number(args?.a);
    const b = Number(args?.b);
    if (isNaN(a) || isNaN(b)) {
      return { content: [{ type: "text", text: "Invalid numbers provided" }], isError: true };
    }
    return {
      content: [{ type: "text", text: String(a * b) }],
    };
  }

  throw new Error(`Tool ${name} not found`);
});

async function main() {
  const transport = new stdioTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

**Step 2: Build and test**
Run: `cd examples/mcp-sample && yarn build`
Verify: Check if `build/index.js` exists.

**Step 3: Commit**
```bash
git add examples/mcp-sample
git commit -m "feat: implement calculator mcp server"
```

### Task 4: Create documentation

**Objective:** Provide a README for the sample.

**Files:**
- Create: `examples/mcp-sample/README.md`

**Step 1: Write README.md**
```markdown
# Node.js MCP Sample

This is a reference implementation of an MCP server using Node.js and TypeScript.

## Getting Started

1. Install dependencies:
   ```bash
   yarn install
   ```

2. Build the project:
   ```bash
   yarn build
   ```

3. Run the server:
   ```bash
   yarn start
   ```

## Tools
- `add`: Adds two numbers.
- `multiply`: Multiplies two numbers.
```

**Step 2: Commit**
```bash
git add examples/mcp-sample
git commit -m "docs: add readme for mcp-sample"
```

### Task 5: Update main config

**Objective:** Register the sample in the project configuration.

**Files:**
- Modify: `mcp-config.json`

**Step 1: Update mcp-config.json**
Add the following to `mcpServers`:
```json
"calculator-sample": {
  "command": "node",
  "args": [
    "./examples/mcp-sample/build/index.js"
  ]
}
```

**Step 2: Verify configuration**
Check `mcp-config.json` to ensure it is correctly merged.

**Step 3: Commit**
```bash
git add mcp-config.json
git commit -m "chore: register calculator-sample in mcp-config"
```
