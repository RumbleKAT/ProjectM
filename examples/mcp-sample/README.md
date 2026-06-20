# Node.js MCP Sample (Calculator & In-Memory Database)

This is a reference implementation of a Model Context Protocol (MCP) server using Node.js and TypeScript. It showcases how to expose custom LLM agent tools, handle parameter schemas, run math operations, and interact with a simulated in-memory database.

## Features

- **Calculator Tools**:
  - `add`: Add two numbers together.
  - `multiply`: Multiply two numbers together.
- **In-Memory Database Tools**:
  - `db_query_users`: Query users stored in the in-memory database, with optional filtering by name.
  - `db_add_user`: Register a new user in the in-memory database with a name and email.

## Getting Started

### 1. Install Dependencies

Install the required packages (TypeScript, Node types, and `@modelcontextprotocol/sdk`):

```bash
yarn install
```

### 2. Build the Server

Compile the TypeScript source files to JavaScript in the `build` directory:

```bash
yarn build
```

### 3. Run the Server

Start the server using the standard I/O (stdio) transport:

```bash
yarn start
```

## Configuration for AnythingLLM

To register this server in AnythingLLM, add the following entry to your `mcp-config.json` file under `mcpServers`:

```json
"calculator-sample": {
  "command": "node",
  "args": [
    "./examples/mcp-sample/build/index.js"
  ]
}
```
