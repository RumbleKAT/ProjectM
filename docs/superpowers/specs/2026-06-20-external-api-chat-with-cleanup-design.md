# External API Sync/Async Chat with Temp Workspace Cleanup

## Overview

외부 클라이언트가 API 방식으로 Chat을 요청할 때 Sync(동기) 및 Async(비동기 + Webhook) 두 가지 방식을 지원하고, 임시로 생성된 워크스페이스를 자동으로 삭제하는 기능을 추가합니다.

## API Endpoints

### 1. Sync Chat

```
POST /v1/workspace/chat-sync
Content-Type: application/json
Authorization: Bearer <api-key>
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspaceName` | string | yes | 사용할 워크스페이스 이름 (없으면 자동 생성) |
| `message` | string | yes | 사용자 메시지 |
| `mode` | string | no | Chat mode (`chat`, `query`, `automatic`) |
| `sessionId` | string | no | 세션 식별자 (같은 sessionId면 같은 워크스페이스 재사용) |
| `attachments` | array | no | 첨부 파일 목록 |
| `reset` | boolean | no | true면 기존 히스토리 리셋 |

**Behavior:**
- `sessionId`가 있으면 해당 워크스페이스 재사용, 없으면 `temp-` prefix로 새 워크스페이스 생성
- `ApiChatHandler.chatSync()` 호출하여 동기 응답 반환
- 기존 `POST /v1/workspace/chat-auto` 로직을 재사용하되 라우트만 `/chat-sync`로 통일

**Response 200:**
```json
{
  "success": true,
  "response": "LLM 응답 텍스트",
  "workspaceName": "temp-my-session",
  "sources": [...],
  "chatId": 123
}
```

### 2. Async Chat (with Webhook)

```
POST /v1/workspace/chat-async
Content-Type: application/json
Authorization: Bearer <api-key>
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspaceName` | string | yes | 사용할 워크스페이스 이름 |
| `message` | string | yes | 사용자 메시지 |
| `mode` | string | no | Chat mode |
| `sessionId` | string | no | 세션 식별자 |
| `attachments` | array | no | 첨부 파일 목록 |
| `reset` | boolean | no | 히스토리 리셋 |
| `webhookUrl` | string | no | 완료 시 콜백 받을 URL |

**Behavior:**
- Sync와 동일하게 워크스페이스 자동 생성
- `workspace_chats` 테이블에 `{ status: "pending" }` 레코드 저장
- 즉시 `{ chatId, status: "pending" }` 반환
- 백그라운드에서 LLM 질의 실행 (`chatSync` 재사용)
- 완료 시 `webhookUrl`로 POST 콜백 전송
- webhookUrl이 없으면 DB에 결과 저장 후 폴링 가능 (`GET /chat-async/status/:chatId`)

**Response 202:**
```json
{
  "success": true,
  "chatId": 123,
  "status": "pending",
  "workspaceName": "temp-my-session"
}
```

**Webhook Callback (POST):**
```json
{
  "chatId": 123,
  "status": "completed",
  "response": "LLM 응답 텍스트",
  "workspaceName": "temp-my-session",
  "sources": []
}
```

실패 시:
```json
{
  "chatId": 123,
  "status": "error",
  "error": "에러 메시지",
  "workspaceName": "temp-my-session"
}
```

### 3. Async Status Polling (Fallback)

```
GET /v1/workspace/chat-async/status/:chatId
Authorization: Bearer <api-key>
```

**Response:**
```json
{
  "chatId": 123,
  "status": "pending" | "completed" | "error",
  "response": "..." // completed일 때만 포함
}
```

## Backend Components

### Temp Workspace Cleanup Job

**File:** `server/jobs/cleanup-temporary-workspaces.js`

- 12시간 간격으로 실행
- `temp-` prefix를 가진 워크스페이스 중 `createdAt`이 24시간 이상 지난 것 탐색
- 각 워크스페이스에 대해:
  - 관련 `workspace_chats` 레코드 삭제
  - Vector DB namespace 제거
  - 워크스페이스 폴더 및 데이터 삭제
  - `workspaces` 레코드 삭제

**Registration:** `server/utils/BackgroundWorkers/index.js`의 `#alwaysRunJobs`에 추가

### Workspace Model Changes

**File:** `server/models/workspace.js`

- `isTemp` 파라미터 → slug `temp-` prefix (이미 구현됨)

## Implementation Checklist

1. `server/endpoints/api/workspace/index.js`에 `/chat-sync`, `/chat-async`, `/chat-async/status/:chatId` 라우트 추가
2. `server/utils/chats/apiChatHandler.js`에 `chatAsync` 함수 추가 (백그라운드 큐 + webhook)
3. `server/jobs/cleanup-temporary-workspaces.js` 생성
4. `server/utils/BackgroundWorkers/index.js`에 cleanup job 등록
5. Webhook 전송 유틸리티 (`server/utils/http.js`의 `sendWebhook` 등)
