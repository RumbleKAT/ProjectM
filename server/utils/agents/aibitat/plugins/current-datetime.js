function isValidTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value.trim(),
    }).format();
    return true;
  } catch {
    return false;
  }
}

function serverTimeZone() {
  let runtimeTimeZone = null;
  try {
    runtimeTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {}

  return [process.env.TZ, runtimeTimeZone, "UTC"].find(isValidTimeZone) || "UTC";
}

function resolveTimeZone(candidate, fallback = serverTimeZone()) {
  if (isValidTimeZone(candidate)) return candidate.trim();
  if (isValidTimeZone(fallback)) return fallback.trim();
  return "UTC";
}

function currentDateTimeParts({ now = new Date(), timeZone = null } = {}) {
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}:${value("second")}`,
    weekday: value("weekday"),
    timeZone: resolvedTimeZone,
  };
}

const currentDateTime = {
  name: "get-current-datetime",
  startupConfig: { params: {} },
  plugin: function () {
    return {
      name: this.name,
      setup(aibitat) {
        aibitat.function({
          super: aibitat,
          name: this.name,
          description:
            "Get the actual current date, time, and weekday. You MUST use this before answering questions about today's date, the current date, today's weekday, the current time, or what time it is. Never guess.",
          examples: [
            { prompt: "What is today's date?", call: JSON.stringify({}) },
            { prompt: "오늘 날짜와 요일이 뭐야?", call: JSON.stringify({}) },
            { prompt: "지금 몇 시야?", call: JSON.stringify({}) },
          ],
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          handler: async function () {
            try {
              const result = currentDateTimeParts({
                timeZone: this.super.handlerProps.invocation?.timezone,
              });
              this.super.introspect(
                `${this.caller}: Checking the current date and time in ${result.timeZone}.`
              );
              return (
                `Current date: ${result.date}\n` +
                `Current time: ${result.time}\n` +
                `Weekday: ${result.weekday}\n` +
                `Time zone: ${result.timeZone}`
              );
            } catch (error) {
              this.super.handlerProps.log(
                `get-current-datetime raised an error. ${error.message}`
              );
              return "The current date and time could not be determined. Do not guess them; tell the user the lookup failed.";
            }
          },
        });
      },
    };
  },
};

module.exports = {
  currentDateTime,
  currentDateTimeParts,
  isValidTimeZone,
  resolveTimeZone,
  serverTimeZone,
};
