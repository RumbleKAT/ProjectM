const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

describe("browser time-zone chat wiring", () => {
  test.each(["workspace.js", "workspaceThread.js"])(
    "%s sends the resolved browser time zone",
    (filename) => {
      const source = read(`../../../frontend/src/models/${filename}`);
      expect(source).toContain(
        "Intl.DateTimeFormat().resolvedOptions().timeZone"
      );
      expect(source).toContain(
        "JSON.stringify({ message, attachments, timeZone })"
      );
    }
  );

  test("the web endpoint and chat stream forward the time zone", () => {
    const endpoint = read("../../endpoints/chat.js");
    const stream = read("../../utils/chats/stream.js");

    expect(endpoint).toContain("{ message, attachments = [], timeZone = null }");
    expect(endpoint).toContain("{ timeZone }");
    expect(stream).toContain("requestContext = {}");
    expect(stream).toContain("timeZone: requestContext.timeZone");
  });
});
