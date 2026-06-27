export function agentReplyReducer(currentState, action) {
  switch (action.type) {
    case "INVOCATION_ESTABLISHED":
    case "SUBMIT_FOLLOW_UP":
      return true;

    case "WEBSOCKET_MESSAGE": {
      const data = action.payload;
      if (!data) return currentState;
      if (data.type === "WAITING_ON_INPUT" || data.type === "wssFailure") {
        return false;
      }
      return currentState;
    }

    case "WEBSOCKET_CLOSE":
    case "WEBSOCKET_ERROR":
    case "ABORT":
      return false;

    default:
      return currentState;
  }
}
