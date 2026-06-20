# UI & Server Functionalities Overview

This document provides a comprehensive overview of the core UI and server functionalities implemented in the ProjectM (AnythingLLM) ecosystem.

## 🎨 UI Functionalities (Frontend)
The frontend is built using **Vite + React**, providing a responsive and interactive user experience.

### 1. Workspace & Chat Management
- **Multi-user Workspace**: Supports multiple independent workspaces with individual settings.
- **Thread System**: Organizes conversations into threads for better context management.
- **Interactive Chat UI**: Features include Markdown support, syntax highlighting for code blocks, and Katex for mathematical equations.

### 2. Authentication & Onboarding
- **User Auth**: Robust login, signup, and invitation systems.
- **Onboarding Flow**: A guided setup process for new users to configure their initial environment.

### 3. Multimedia & Interaction
- **Speech & Audio**:
    - **TTS (Text-to-Speech)**: Supports Piper (Local), ElevenLabs, and OpenAI TTS.
    - **STT (Speech-to-Text)**: Integrated browser-based speech recognition.
- **Drag & Drop**: Intuitive file upload system for documents.
- **Data Visualization**: Utilizes **Recharts** and **Tremor** for rendering analytics and data charts.

### 4. Localization & Accessibility
- **i18n**: Multi-language support across the entire application.
- **QR Codes**: Quick-access QR codes for mobile or desktop sessions.

---

## ⚙️ Server Functionalities (Backend)
The backend is a **Node.js (Express)** server handling high-concurrency AI orchestration and data processing.

### 1. Multi-LLM & Agent Orchestration
- **LangChain Integration**: Seamless connection to OpenAI, Anthropic, Ollama, Google Gemini, Groq, and more.
- **Dynamic Model Routing**: Rules-based routing to select the most appropriate model for a given task.
- **AI Agents**: Support for autonomous agents capable of using external tools (e.g., web browsing).
- **MCP Support**: Compatibility with Model Context Protocol for standardized tool use.

### 2. Vector Database & RAG (Retrieval-Augmented Generation)
- **Extensive Vector DB Support**: Native integration with LanceDB (default), PGVector, Astra DB, Pinecone, Qdrant, Weaviate, Milvus, and Chroma.
- **Document Pipeline**: Automated parsing, chunking, and embedding for PDF, DOCX, Excel, and TXT files.

### 3. Communication & Automation
- **Telegram Bot**: Integrated bot for workspace management, model selection, and status monitoring.
- **Task Scheduling**: Cron-like scheduled jobs using `Bree`.
- **Web Push**: Real-time notifications via Web Push API.

### 4. Data & Infrastructure
- **Database Management**: Persistence via Prisma ORM supporting PostgreSQL, MSSQL, and MySQL.
- **Telemetry**: Anonymous usage tracking via PostHog to improve product experience.
- **API Documentation**: Automated Swagger/OpenAPI documentation for all server endpoints.
