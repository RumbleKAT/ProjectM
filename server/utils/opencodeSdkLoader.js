let sdk = null;
let serverModule = null;

async function loadOpencodeSdk() {
  if (sdk) return sdk;
  try {
    sdk = await import("@opencode-ai/sdk");
    return sdk;
  } catch (e) {
    console.error("Failed to load @opencode-ai/sdk.", e.message);
    return null;
  }
}

async function loadOpencodeServerModule() {
  if (serverModule) return serverModule;
  try {
    serverModule = await import("@opencode-ai/sdk/server");
    return serverModule;
  } catch (e) {
    console.error("Failed to load @opencode-ai/sdk/server.", e.message);
    return null;
  }
}

module.exports = { loadOpencodeSdk, loadOpencodeServerModule };
