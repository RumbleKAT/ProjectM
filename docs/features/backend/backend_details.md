# Backend Features Detail

This document provides a deep dive into the backend architecture and AI orchestration capabilities.

## 1. Multi-LLM & Agent Orchestration
The core engine that connects users to diverse AI models and autonomous capabilities.

### LLM Provider Integration
Supports a wide array of closed and open-source providers:
- **Closed Source**: OpenAI, Anthropic, Google Gemini, Groq, Mistral, Perplexity.
- **Local/Self-hosted**: Ollama, LM Studio, LocalAI, LiteLLM.
- **Infrastructure**: Native support for AWS Bedrock, Azure OpenAI, and NVIDIA NIM.

### Dynamic Model Routing
- **Router Logic**: A rules-based system that automatically selects the most appropriate model based on the user's request (e.g., selecting a faster model for simple chats vs. a more capable model for complex reasoning).
- **Cost & Performance Balance**: Allows administrators to set limits and preferences for different conversation types.

### AI Agents & Tool Use
- **Agentic Workflows**: Support for agents that can autonomously perform tasks like web searching or executing custom code.
- **Model Context Protocol (MCP)**: Implements MCP compatibility for standardized tool integration.
- **Skill Execution**: Ability to dynamically load and execute specialized "skills" (proven workflows) for specific tasks.

## 2. Vector Database & RAG
Handles the ingestion, embedding, and retrieval of private documents.

### Vector Database Support
Supports a comprehensive list of vector stores for scalability:
- **Default**: LanceDB (Optimized for local-first use).
- **Cloud/Enterprise**: Pinecone, Astra DB, Weaviate, Qdrant, Milvus, Zilliz.
- **SQL-based**: PGVector (PostgreSQL).

### Document Ingestion Pipeline
- **Collectors**: A dedicated collector service (via `collector/` directory) for parsing various file types.
- **Supported Formats**: PDF, DOCX, TXT, Excel.
- **Parsing Logic**: Intelligent chunking strategies to ensure that relevant context is preserved for the RAG process.
- **Embedding**: Seamless integration with multiple embedding models (OpenAI, Voyage, Mistral, etc.).

## 3. Communication & Automation
Mechanisms for external interaction and scheduled tasks.

### Telegram Bot
- **Navigation**: Full navigation system within Telegram to manage workspaces, threads, and models.
- **Command Handlers**: Specific handlers for starting/resetting chats, viewing workspace status, and proof-of-work.
- **Media Handling**: Support for sending and receiving media via the bot.

### Automation & Scheduling
- **Cron Jobs**: Scheduled tasks managed by the `Bree` library.
- **Task Types**: Automated summarization, periodic data syncing, or recurring agent prompts.
- **Web Push Notifications**: Real-time alerts for long-running tasks or new messages.

## 4. Infrastructure & Data Management
The foundation of the application's persistence and observability.

### Database Persistence
- **Prisma ORM**: Used for all SQL database interactions (PostgreSQL, MySQL, MSSQL).
- **Migrations**: Version-controlled schema management.

### Telemetry & Observability
- **PostHog**: Integration for anonymous usage tracking.
- **Metrics**: Tracking of model usage, latency, and document processing times to inform product roadmaps.
- **Swagger/OpenAPI**: Automatically generated documentation for all backend endpoints.
