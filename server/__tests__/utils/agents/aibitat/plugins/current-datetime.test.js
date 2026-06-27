process.env.NODE_ENV = "test";

const {
  currentDateTime,
  currentDateTimeParts,
  resolveTimeZone,
} = require("../../../../../utils/agents/aibitat/plugins/current-datetime");

function registerTool(timezone = null) {
  let registered;
  const aibitat = {
    handlerProps: {
      invocation: { timezone },
      log: jest.fn(),
    },
    introspect: jest.fn(),
    function(config) {
      registered = config;
    },
  };

  currentDateTime.plugin().setup(aibitat);
  return registered;
}

describe("get-current-datetime", () => {
  const originalTimeZone = process.env.TZ;

  afterEach(() => {
    jest.useRealTimers();
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  test("uses the next local day and 24-hour time in Asia/Seoul", () => {
    expect(
      currentDateTimeParts({
        now: new Date("2026-06-26T15:30:45.000Z"),
        timeZone: "Asia/Seoul",
      })
    ).toEqual({
      date: "2026-06-27",
      time: "00:30:45",
      weekday: "Saturday",
      timeZone: "Asia/Seoul",
    });
  });

  test("uses the previous local day and 24-hour time in America/Los_Angeles", () => {
    expect(
      currentDateTimeParts({
        now: new Date("2026-06-27T02:05:06.000Z"),
        timeZone: "America/Los_Angeles",
      })
    ).toEqual({
      date: "2026-06-26",
      time: "19:05:06",
      weekday: "Friday",
      timeZone: "America/Los_Angeles",
    });
  });

  test("invalid browser time zone uses the supplied server fallback", () => {
    expect(resolveTimeZone("Mars/Olympus", "Asia/Seoul")).toBe("Asia/Seoul");
  });

  test("missing browser time zone uses the server time zone", () => {
    process.env.TZ = "Asia/Seoul";
    expect(resolveTimeZone(null)).toBe("Asia/Seoul");
  });

  test("registers a parameterless tool that returns date, time, and weekday", async () => {
    jest.useFakeTimers().setSystemTime(
      new Date("2026-06-26T15:30:45.000Z")
    );
    const tool = registerTool("Asia/Seoul");

    expect(tool.name).toBe("get-current-datetime");
    expect(tool.parameters).toEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    await expect(tool.handler.call(tool, {})).resolves.toBe(
      "Current date: 2026-06-27\n" +
        "Current time: 00:30:45\n" +
        "Weekday: Saturday\n" +
        "Time zone: Asia/Seoul"
    );
  });
});
