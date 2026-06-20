const { spawn } = require("child_process");
const path = require("path");

const serverPath = path.join(__dirname, "build", "index.js");
console.log("Starting MCP Server E2E Test on:", serverPath);

const child = spawn("node", [serverPath]);

let buffer = "";
const pendingResolves = new Map();
let messageId = 1;

// Helper to write JSON-RPC messages to stdio
function writeMessage(method, params, id = null) {
  const msg = {
    jsonrpc: "2.0",
    ...(id !== null ? { id } : {}),
    method,
    params,
  };
  const serialized = JSON.stringify(msg) + "\n";
  child.stdin.write(serialized);
}

// Helper to write JSON-RPC responses (in case server queries client, though not needed here)
function sendResponse(id, result) {
  const msg = {
    jsonrpc: "2.0",
    id,
    result,
  };
  child.stdin.write(JSON.stringify(msg) + "\n");
}

// Send request and return promise of the response
function sendRequest(method, params) {
  const id = messageId++;
  writeMessage(method, params, id);
  return new Promise((resolve, reject) => {
    pendingResolves.set(id, { resolve, reject });
  });
}

// Parse incoming data as new-line separated JSON objects
child.stdout.on("data", (data) => {
  buffer += data.toString();
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.substring(0, newlineIdx).trim();
    buffer = buffer.substring(newlineIdx + 1);
    if (!line) continue;

    try {
      const msg = JSON.parse(line);
      if (msg.id && pendingResolves.has(msg.id)) {
        const { resolve } = pendingResolves.get(msg.id);
        pendingResolves.delete(msg.id);
        resolve(msg);
      } else {
        // Handle notifications or requests from server
        console.log("[Server Notification/Request]:", msg);
      }
    } catch (e) {
      console.error("Failed to parse server output:", line, e);
    }
  }
});

child.stderr.on("data", (data) => {
  console.log("[Server Log]:", data.toString().trim());
});

child.on("close", (code) => {
  console.log(`MCP server exited with code ${code}`);
});

async function runTests() {
  try {
    // 1. Initialize handshake
    console.log("--- Step 1: Handshake ---");
    const initResponse = await sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e-test-client", version: "1.0.0" },
    });
    
    if (initResponse.error) {
      throw new Error(`Init failed: ${JSON.stringify(initResponse.error)}`);
    }
    console.log("Handshake initialized successfully!");

    // Send initialized notification
    const initNotification = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    child.stdin.write(JSON.stringify(initNotification) + "\n");

    // 2. Test calculator tools: add
    console.log("\n--- Step 2: Test 'add' Tool ---");
    const addResult = await sendRequest("tools/call", {
      name: "add",
      arguments: { a: 15, b: 27 },
    });
    console.log("Result:", JSON.stringify(addResult));
    const addText = addResult.result.content[0].text;
    if (addText !== "42") {
      throw new Error(`Add tool failed. Expected "42", got "${addText}"`);
    }
    console.log("✓ Add tool passed!");

    // 3. Test calculator tools: multiply
    console.log("\n--- Step 3: Test 'multiply' Tool ---");
    const multiplyResult = await sendRequest("tools/call", {
      name: "multiply",
      arguments: { a: 6, b: 7 },
    });
    console.log("Result:", JSON.stringify(multiplyResult));
    const multiplyText = multiplyResult.result.content[0].text;
    if (multiplyText !== "42") {
      throw new Error(`Multiply tool failed. Expected "42", got "${multiplyText}"`);
    }
    console.log("✓ Multiply tool passed!");

    // 4. Test DB tool: query users
    console.log("\n--- Step 4: Test 'db_query_users' Tool (All) ---");
    const queryAllResult = await sendRequest("tools/call", {
      name: "db_query_users",
      arguments: {},
    });
    console.log("Result:", JSON.stringify(queryAllResult));
    const allUsers = JSON.parse(queryAllResult.result.content[0].text);
    if (!Array.isArray(allUsers) || allUsers.length !== 3) {
      throw new Error(`Query all failed. Expected 3 users, got: ${JSON.stringify(allUsers)}`);
    }
    console.log("✓ Query all users passed!");

    // 5. Test DB tool: add user
    console.log("\n--- Step 5: Test 'db_add_user' Tool ---");
    const addUserResult = await sendRequest("tools/call", {
      name: "db_add_user",
      arguments: { name: "Dave", email: "dave@example.com" },
    });
    console.log("Result:", JSON.stringify(addUserResult));
    const addUserText = addUserResult.result.content[0].text;
    if (!addUserText.includes("Dave") || !addUserText.includes("dave@example.com")) {
      throw new Error(`Add user failed: ${addUserText}`);
    }
    console.log("✓ Add user passed!");

    // 6. Test DB tool: query users with filter
    console.log("\n--- Step 6: Test 'db_query_users' Tool (Filter) ---");
    const queryFilterResult = await sendRequest("tools/call", {
      name: "db_query_users",
      arguments: { nameFilter: "Dave" },
    });
    console.log("Result:", JSON.stringify(queryFilterResult));
    const filteredUsers = JSON.parse(queryFilterResult.result.content[0].text);
    if (!Array.isArray(filteredUsers) || filteredUsers.length !== 1 || filteredUsers[0].name !== "Dave") {
      throw new Error(`Query with filter failed: ${JSON.stringify(filteredUsers)}`);
    }
    console.log("✓ Query filtered users passed!");

    console.log("\n=========================");
    console.log("All E2E tests passed successfully!");
    console.log("=========================");
    child.kill();
    process.exit(0);

  } catch (error) {
    console.error("\nFAIL: E2E Test encountered an error:", error);
    child.kill();
    process.exit(1);
  }
}

// Start running test suite after 500ms startup delay
setTimeout(runTests, 500);
