# Agent & Project Guidelines

## Project Overview
This project is a Telegram-based Retrieval-Augmented Generation (RAG) platform that enables users to interact with large-scale datasets and multiple AI models through a structured, stateful conversation interface.

## Technical Stack
- **Runtime**: Node.js
- **Language**: JavaScript / TypeScript
- **Primary Interface**: Telegram Bot API (Stateful Navigation)
- **Data Layer**: Multi-provider Vector Database support
- **Key Technologies**:
  - **RAG Architecture**: Retrieval-Augmented Generation for context-aware AI responses.
  - **Provider Pattern**: Modular architecture for swapping vector database providers (Zilliz, Weaviate, Qdrant, Pinecone, pgvector, Milvus, LanceDB, ChromaCloud, AstraDB).
  - **State Management**: Handled via Telegram session persistence to allow multi-step navigation (Workspace -> Thread -> Source -> Model).

## Project Structure & Conventions
- **Server Logic**: Located in `server/utils/`
- **Vector DBs**: Providers are organized in `server/utils/vectorDbProviders/`. Each has a dedicated implementation and a `SETUP.md` file.
- **Bot Logic**: Centralized in `server/utils/telegramBot/` with dedicated sub-folders for navigation, commands, and media.
- **Navigation**: A dedicated navigation engine handles complex flows including pagination and callback responses.
- **Telemetry**: Integrated monitoring for tracking performance and errors.

## Development Rules
1. **Absolute Paths**: Always use absolute paths for file system operations.
2. **Verification**: Check `package.json` or project manifests before assuming library availability.
3. **Style**: Follow existing patterns in `server/utils/`—maintain consistency in naming and directory structure.
4. **Statefulness**: Ensure that all navigation logic correctly updates the session state to prevent UI/UX desync.
5. **Error Handling**: Use the telemetry system to log errors and ensure the bot remains responsive even when a provider fails.
