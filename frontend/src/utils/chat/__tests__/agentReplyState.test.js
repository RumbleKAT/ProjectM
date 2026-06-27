import { test } from "node:test";
import assert from "node:assert";
import { agentReplyReducer } from "../agentReplyState.js";

test("agentReplyReducer - invocation/follow-up start events set pending to true", () => {
  let state = false;

  state = agentReplyReducer(state, { type: "INVOCATION_ESTABLISHED" });
  assert.strictEqual(state, true);

  state = false;
  state = agentReplyReducer(state, { type: "SUBMIT_FOLLOW_UP" });
  assert.strictEqual(state, true);
});

test("agentReplyReducer - WAITING_ON_INPUT, failure, close, abort, error clear pending", () => {
  assert.strictEqual(
    agentReplyReducer(true, {
      type: "WEBSOCKET_MESSAGE",
      payload: { type: "WAITING_ON_INPUT" },
    }),
    false
  );

  assert.strictEqual(
    agentReplyReducer(true, {
      type: "WEBSOCKET_MESSAGE",
      payload: { type: "wssFailure" },
    }),
    false
  );

  assert.strictEqual(
    agentReplyReducer(true, { type: "WEBSOCKET_CLOSE" }),
    false
  );

  assert.strictEqual(
    agentReplyReducer(true, { type: "WEBSOCKET_ERROR" }),
    false
  );

  assert.strictEqual(agentReplyReducer(true, { type: "ABORT" }), false);
});

test("agentReplyReducer - intermediate events preserve pending", () => {
  assert.strictEqual(
    agentReplyReducer(true, {
      type: "WEBSOCKET_MESSAGE",
      payload: { type: "textResponse" },
    }),
    true
  );

  assert.strictEqual(
    agentReplyReducer(true, {
      type: "WEBSOCKET_MESSAGE",
      payload: { type: "statusResponse" },
    }),
    true
  );

  assert.strictEqual(
    agentReplyReducer(false, {
      type: "WEBSOCKET_MESSAGE",
      payload: { type: "textResponse" },
    }),
    false
  );
});
