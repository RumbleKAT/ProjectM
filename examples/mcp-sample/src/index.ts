import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Define interface for user database records
interface UserRecord {
  id: number;
  name: string;
  email: string;
}

// In-Memory Database Simulation
class InMemoryDB {
  private users: UserRecord[] = [
    { id: 1, name: "Alice", email: "alice@example.com" },
    { id: 2, name: "Bob", email: "bob@example.com" },
    { id: 3, name: "Charlie", email: "charlie@example.com" },
  ];

  public getUsers(nameFilter?: string): UserRecord[] {
    if (!nameFilter) {
      return this.users;
    }
    const filterLower = nameFilter.toLowerCase();
    return this.users.filter((user) =>
      user.name.toLowerCase().includes(filterLower)
    );
  }

  public addUser(name: string, email: string): UserRecord {
    const nextId =
      this.users.length > 0
        ? Math.max(...this.users.map((u) => u.id)) + 1
        : 1;
    const newRecord: UserRecord = { id: nextId, name, email };
    this.users.push(newRecord);
    return newRecord;
  }
}

const db = new InMemoryDB();

// Initialize Server
const server = new Server(
  {
    name: "calculator-and-db-sample",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools discovery handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "add",
        description: "Adds two numbers together.",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number", description: "First number" },
            b: { type: "number", description: "Second number" },
          },
          required: ["a", "b"],
        },
      },
      {
        name: "multiply",
        description: "Multiplies two numbers together.",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number", description: "First number" },
            b: { type: "number", description: "Second number" },
          },
          required: ["a", "b"],
        },
      },
      {
        name: "db_query_users",
        description: "Queries/searches users in the in-memory database.",
        inputSchema: {
          type: "object",
          properties: {
            nameFilter: {
              type: "string",
              description: "Optional case-insensitive substring search for name",
            },
          },
        },
      },
      {
        name: "db_add_user",
        description: "Adds a new user to the in-memory database.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "The name of the user" },
            email: { type: "string", description: "The email address of the user" },
          },
          required: ["name", "email"],
        },
      },
    ],
  };
});

// Register tools execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "add": {
      const a = Number(args?.a);
      const b = Number(args?.b);
      if (isNaN(a) || isNaN(b)) {
        return {
          content: [{ type: "text", text: "Error: Invalid numbers provided" }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: String(a + b) }],
      };
    }

    case "multiply": {
      const a = Number(args?.a);
      const b = Number(args?.b);
      if (isNaN(a) || isNaN(b)) {
        return {
          content: [{ type: "text", text: "Error: Invalid numbers provided" }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: String(a * b) }],
      };
    }

    case "db_query_users": {
      const nameFilter = args?.nameFilter ? String(args.nameFilter) : undefined;
      const results = db.getUsers(nameFilter);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }

    case "db_add_user": {
      const name = args?.name ? String(args.name) : "";
      const email = args?.email ? String(args.email) : "";

      if (!name || !email) {
        return {
          content: [{ type: "text", text: "Error: Both 'name' and 'email' are required." }],
          isError: true,
        };
      }

      const newUser = db.addUser(name, email);
      return {
        content: [
          {
            type: "text",
            text: `Successfully added user: ${JSON.stringify(newUser, null, 2)}`,
          },
        ],
      };
    }

    default:
      throw new Error(`Tool ${name} not found`);
  }
});

// Start the server with standard input/output transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error running MCP server:", error);
  process.exit(1);
});
