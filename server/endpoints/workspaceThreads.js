const {
  multiUserMode,
  userFromSession,
  reqBody,
  safeJsonParse,
} = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { Telemetry } = require("../models/telemetry");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { EventLogs } = require("../models/eventLogs");
const { WorkspaceThread } = require("../models/workspaceThread");
const {
  validWorkspaceSlug,
  validWorkspaceAndThreadSlug,
} = require("../utils/middleware/validWorkspace");
const { WorkspaceChats } = require("../models/workspaceChats");
const { convertToChatHistory, convertToPromptHistory } = require("../utils/helpers/chat/responses");
const { getModelTag } = require("./utils");
const { TokenManager } = require("../utils/helpers/tiktoken");
const { getLLMProvider } = require("../utils/helpers");
const { Workspace } = require("../models/workspace");

function workspaceThreadEndpoints(app) {
  if (!app) return;

  app.post(
    "/workspace/:slug/thread/new",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const { thread, message } = await WorkspaceThread.new(
          workspace,
          user?.id
        );
        await Telemetry.sendTelemetry(
          "workspace_thread_created",
          {
            multiUserMode: multiUserMode(response),
            LLMSelection: process.env.LLM_PROVIDER || "openai",
            Embedder: process.env.EMBEDDING_ENGINE || "inherit",
            VectorDbSelection: process.env.VECTOR_DB || "lancedb",
            TTSSelection: process.env.TTS_PROVIDER || "native",
            LLMModel: getModelTag(),
          },
          user?.id
        );

        await EventLogs.logEvent(
          "workspace_thread_created",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          user?.id
        );
        response.status(200).json({ thread, message });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/threads",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const threads = await WorkspaceThread.where({
          workspace_id: workspace.id,
          user_id: user?.id || null,
        });

        const defaultThreadChatCount = await WorkspaceChats.count({
          workspaceId: workspace.id,
          user_id: user?.id || null,
          thread_id: null,
          api_session_id: null,
          include: true,
        });

        response.status(200).json({ threads, defaultThreadChatCount });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/thread/:threadSlug",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    async (_, response) => {
      try {
        const thread = response.locals.thread;
        await WorkspaceThread.delete({ id: thread.id });
        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/thread-bulk-delete",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { slugs = [] } = reqBody(request);
        if (slugs.length === 0) return response.sendStatus(200).end();

        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        await WorkspaceThread.delete({
          slug: { in: slugs },
          user_id: user?.id ?? null,
          workspace_id: workspace.id,
        });
        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/thread/:threadSlug/chats",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const thread = response.locals.thread;
        const history = await WorkspaceChats.where(
          {
            workspaceId: workspace.id,
            user_id: user?.id || null,
            thread_id: thread.id,
            api_session_id: null, // Do not include API session chats.
            include: true,
          },
          null,
          { id: "asc" }
        );

        response.status(200).json({ history: convertToChatHistory(history) });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/thread/:threadSlug/update",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    async (request, response) => {
      try {
        const data = reqBody(request);
        const currentThread = response.locals.thread;
        const { thread, message } = await WorkspaceThread.update(
          currentThread,
          data
        );
        response.status(200).json({ thread, message });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/thread/:threadSlug/delete-edited-chats",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    async (request, response) => {
      try {
        const { startingId } = reqBody(request);
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const thread = response.locals.thread;

        await WorkspaceChats.delete({
          workspaceId: Number(workspace.id),
          thread_id: Number(thread.id),
          user_id: user?.id,
          id: { gte: Number(startingId) },
        });

        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/thread/:threadSlug/update-chat",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    async (request, response) => {
      try {
        const { chatId, newText = null, role = "assistant" } = reqBody(request);
        if (!newText || !String(newText).trim())
          throw new Error("Cannot save empty edit");

        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const thread = response.locals.thread;
        const existingChat = await WorkspaceChats.get({
          workspaceId: workspace.id,
          thread_id: thread.id,
          user_id: user?.id,
          id: Number(chatId),
        });
        if (!existingChat) throw new Error("Invalid chat.");

        if (role === "user") {
          await WorkspaceChats._update(existingChat.id, {
            prompt: String(newText),
          });
        } else {
          const chatResponse = safeJsonParse(existingChat.response, null);
          if (!chatResponse) throw new Error("Failed to parse chat response");
          await WorkspaceChats._update(existingChat.id, {
            response: JSON.stringify({
              ...chatResponse,
              text: String(newText),
            }),
          });
        }

        response.sendStatus(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/thread/:threadSlug/context-usage",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const thread = response.locals.thread;

        const limit = Workspace._getContextWindow(workspace) || 4096;
        const tokenManager = new TokenManager(workspace.chatModel);

        const systemPromptTokenCount = tokenManager.countFromString(
          workspace.openAiPrompt || Workspace.defaultPrompt || ""
        );

        const history = await WorkspaceChats.where(
          {
            workspaceId: workspace.id,
            user_id: user?.id || null,
            thread_id: thread.id,
            api_session_id: null,
            include: true,
          },
          null,
          { id: "asc" }
        );

        const promptHistory = convertToPromptHistory(history);
        const historyTokenCount = promptHistory.length > 0 ? tokenManager.statsFrom(promptHistory) : 0;
        const docTokenCount = await Workspace._getCurrentContextTokenCount(
          workspace.id,
          thread.id
        );

        const totalTokens = systemPromptTokenCount + historyTokenCount + docTokenCount;
        const percentage = Math.min((totalTokens / limit) * 100, 100).toFixed(1);

        response.status(200).json({ limit, usage: totalTokens, percentage });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/thread/:threadSlug/compact",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.all]),
      validWorkspaceAndThreadSlug,
    ],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const thread = response.locals.thread;

        const history = await WorkspaceChats.where(
          {
            workspaceId: workspace.id,
            user_id: user?.id || null,
            thread_id: thread.id,
            api_session_id: null,
            include: true,
          },
          null,
          { id: "asc" }
        );

        if (history.length === 0) {
          return response.status(200).json({ success: true });
        }

        const promptHistory = convertToPromptHistory(history);
        
        const llmProvider = workspace.chatProvider || process.env.LLM_PROVIDER || null;
        const llmModel = workspace.chatModel || null;
        const llm = getLLMProvider({ provider: llmProvider, model: llmModel });
        
        if (!llm) {
          throw new Error("No LLM provider available for compaction.");
        }

        const compactionPrompt = `Summarize the following conversation into a concise summary that retains all important context, entities, and facts so it can be used to remember the conversation later:\n\n${JSON.stringify(promptHistory)}`;

        const messages = [{ role: "user", content: compactionPrompt }];
        const summary = await llm.getChatCompletion(messages, { temperature: 0.2 });

        // Delete all old chats in the thread
        await WorkspaceChats.delete({
          workspaceId: workspace.id,
          user_id: user?.id || null,
          thread_id: thread.id,
        });

        // Insert new summary chat
        await WorkspaceChats.new({
          workspaceId: workspace.id,
          prompt: "이전 대화 내역 요약",
          response: { text: summary, type: "text", sources: [] },
          user: user,
          threadId: thread.id,
          include: true,
        });

        response.status(200).json({ success: true });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { workspaceThreadEndpoints };
