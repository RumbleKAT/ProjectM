# Telegram Bot Interface

The Telegram bot serves as the primary user interface for the platform. It handles user authentication, commands, and stateful navigation.

## Core Components
- **Command Handlers**: Processes user commands like `/start`, `/reset`, `/status`, and `/proof`.
- **Message Queue**: Manages incoming messages to ensure sequential processing and prevent rate limiting.
- **Media Handling**: Processes and sends media (images, files) within the chat.
- **Bot Utilities**: Includes helpers for formatting, verification, and general Telegram API interaction.

## Key Commands
- `/start`: Initializes the session and shows the main menu.
- `/reset`: Clears the current session state.
- `/status`: Displays current session information.
- `/proof`: Provides evidence or logs for specific actions.

## Bot Logic
The bot is designed to be stateful, allowing users to navigate through nested menus without restarting the session.
