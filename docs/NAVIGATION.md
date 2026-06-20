# Navigation Logic

The platform uses a sophisticated navigation system to manage user flow within the Telegram interface. Users can move between different entities like Workspaces, Threads, Sources, and Models.

## System Overview
- [UI & Server Functionalities Overview](UI-Server-Features.md)
- [Frontend Details](features/frontend/ui_details.md)
- [Backend Details](features/backend/backend_details.md)
- [Overviews](OVERVIEW.md)
- [Telegram Bot](TELEGRAM_BOT.md)
- [Telemetry](TELEMETRY.md)
- [Vector Databases](VECTOR_DATABASES.md)

## Navigation Features
- **Pagination**: Supports paginated lists for Workspaces, Threads, and Sources to handle large quantities of data.
- **Callbacks**: Handles button clicks (inline keyboards) to navigate between entities.
- **Back Navigation**: Allows users to go back to the previous menu level (e.g., back to Workspaces from a Thread).
- **Selection Logic**: Handles selecting specific items and updating the UI accordingly.

The navigation logic is centralized in `server/utils/telegramBot/utils/navigation/`.
