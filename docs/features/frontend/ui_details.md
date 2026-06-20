# Frontend Features Detail

This document provides a deep dive into the frontend functionalities of AnythingLLM.

## 1. Workspace & Chat Management
The core of the user experience, managing how users interact with their data and AI.

### Workspace System
- **Multi-user Architecture**: Supports isolated workspaces for different projects or users.
- **Resource Isolation**: Each workspace maintains its own set of threads, sources, and configuration settings.
- **Management UI**: Includes creation, deletion, and configuration of workspaces (via `frontend/src/pages/WorkspaceSettings/`).

### Threading & Chat
- **Thread System**: Conversations are organized into "Threads" to maintain context. Users can switch between threads within a workspace.
- **Contextual Chat**: The UI sends previous thread history and relevant source context to the backend to ensure coherent responses.
- **Interactive Elements**:
    - **Markdown Rendering**: Full support for bold, italics, lists, and blockquotes.
    - **Syntax Highlighting**: Integration with `highlight.js` for clean code block display.
    - **Katex Support**: Real-time rendering of mathematical formulas and scientific notation.

## 2. Multimedia & Interaction
Advanced capabilities for non-textual interaction.

### Text-to-Speech (TTS)
- **Native Browser Support**: Uses the Web Speech API for basic local text-to-speech.
- **Premium Providers**: Integration with **ElevenLabs** and **Piper** (local).
- **Streaming Audio**: Optimized for low-latency audio playback during AI responses.

### Speech-to-Text (STT)
- **Voice Recognition**: Real-time speech recognition using the browser's Web Speech API.
- **Voice UI**: Allows users to interact with the AI via voice commands, suitable for hands-free operation.

## 3. Authentication & Onboarding
Security and first-time user experience.

### Authentication Flow
- **User Auth**: Secure login/signup flows.
- **Invitation System**: Admin-led workspace invitations for multi-user environments.
- **Session Management**: JWT-based session handling for persistent login across sessions.

### Onboarding Flow
- **Guided Setup**: A step-by-step wizard for new users to select their first LLM, set up a vector database, and perform their first document ingestion.
- **Dynamic UI**: Components react to the user's current step in the onboarding process (via `frontend/src/pages/OnboardingFlow/`).

## 4. Data Visualization
- **Analytics Dashboard**: Real-time usage statistics and logs.
- **Charting Libraries**: 
    - **Recharts**: Used for complex, interactive time-series and bar charts.
    - **Tremor**: Utilized for high-level UI components (cards, stats, etc.) to ensure a polished "dashboard" feel.
