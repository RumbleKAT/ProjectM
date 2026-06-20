-- CreateIndex
CREATE INDEX "workspace_chats_thread_id_idx" ON "workspace_chats"("thread_id");

-- CreateIndex
CREATE INDEX "workspace_agent_invocations_thread_id_idx" ON "workspace_agent_invocations"("thread_id");

-- CreateIndex
CREATE INDEX "workspace_parsed_files_threadId_idx" ON "workspace_parsed_files"("threadId");
