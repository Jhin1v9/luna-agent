# Luna API Documentation

## Nexo Workspace - AI Agent Integration

**Version:** 1.0.0
**Base URL:** `https://<workspace-nexo-host>/api/luna`
**Authentication:** `X-Luna-Key` header

---

## Overview

The Luna API provides REST endpoints for AI agents (Luna and other authorized agents) to interact with the Nexo Workspace domain. All endpoints follow the same conventions:

- Standardized request/response format
- Authentication via `X-Luna-Key` header
- Rate limiting (100 requests/minute per API key)
- CORS enabled for cross-origin requests
- Comprehensive request logging (with masked API keys)

---

## Authentication

All endpoints require the `X-Luna-Key` header:

```http
X-Luna-Key: your-luna-api-key-here
```

The API key is validated against the `LUNA_API_KEY` environment variable. Contact the Nexo team to obtain a key.

### 401 Unauthorized

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing X-Luna-Key header.",
    "suggestion": "Ensure the X-Luna-Key header is set with a valid Luna API key. Contact the Nexo team if you need a key."
  },
  "meta": {
    "timestamp": "2026-07-16T10:00:00Z",
    "version": "1.0.0"
  }
}
```

---

## Response Format

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-07-16T10:00:00Z",
    "version": "1.0.0"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description",
    "suggestion": "How to fix or work around the error"
  },
  "meta": {
    "timestamp": "2026-07-16T10:00:00Z",
    "version": "1.0.0"
  }
}
```

---

## Rate Limiting

- **Limit:** 100 requests per minute per API key
- **Headers on 429 response:**
  - `Retry-After`: Seconds to wait before retry
  - `X-RateLimit-Limit`: Maximum requests per window
  - `X-RateLimit-Reset`: ISO timestamp when the window resets

### 429 Too Many Requests

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Maximum 100 requests per minute.",
    "suggestion": "Wait 45 seconds before retrying. Consider implementing request batching or caching."
  },
  "meta": { ... }
}
```

---

## CORS

All endpoints support CORS preflight:

```http
OPTIONS /api/luna/<endpoint>

Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Luna-Key
```

---

## Endpoints

### 1. Analyze Request

**Tool:** `workspaceAnalyzeRequest` | **Capability:** `AnalyzeRequest`

```http
POST /api/luna/analyze-request
```

Analyzes a client request and returns structured analysis including identified needs, suggested priority, complexity, and recommended actions.

**Body:**

```json
{
  "requestId": "req_abc123",
  "instructions": "Focus on performance issues"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "request": {
      "id": "req_abc123",
      "content": "The carousel is slow and some images don't appear",
      "status": "ANALYZING",
      "project": { "name": "Corporate Website" },
      "attachments": [...],
      "comments": [...]
    },
    "history": [...],
    "suggestedPriority": "HIGH",
    "suggestedComplexity": "MEDIUM",
    "needs": [
      {
        "title": "Fix carousel transition speed",
        "description": "Transition between slides is taking 5 seconds...",
        "complexity": "LOW",
        "priority": "HIGH"
      }
    ],
    "action": "analyze"
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 2. Create Need

**Tool:** `workspaceCreateNeed` | **Capability:** `CreateNeed`

```http
POST /api/luna/create-need
```

Creates a new Need from Luna's analysis. Needs are operational entities that decouple client language from technical team language.

**Body:**

```json
{
  "requestId": "req_abc123",
  "title": "Fix carousel transition speed",
  "description": "The transition between carousel slides is taking 5 seconds instead of the expected 300ms.",
  "complexity": "LOW",
  "priority": "HIGH"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "need": {
      "id": "need_xyz789",
      "requestId": "req_abc123",
      "title": "Fix carousel transition speed",
      "description": "...",
      "complexity": "LOW",
      "priority": "HIGH",
      "status": "Created",
      "createdAt": "2026-07-16T10:00:00Z",
      "createdBy": "Luna"
    },
    "event": {
      "id": "evt_123",
      "type": "LUNA_NEED_CREATED",
      ...
    }
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 3. List Needs

**Tool:** `workspaceListNeeds` | **Capability:** `ListNeeds`

```http
GET /api/luna/list-needs?requestId=req_abc123
```

Lists all Needs linked to a Request. **Never exposed to clients** - internal use only.

**Response:**

```json
{
  "success": true,
  "data": {
    "needs": [...],
    "count": 3
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 4. List Pending Actions

**Tool:** `workspaceListPendingClientActions` | **Capability:** `ListPendingClientActions`

```http
GET /api/luna/list-pending-actions?requestId=req_abc123
```

Lists all pending client actions, optionally filtered by requestId.

**Response:**

```json
{
  "success": true,
  "data": {
    "actions": [
      {
        "id": "act_789",
        "type": "Send images",
        "description": "We need you to send the photos...",
        "status": "PENDING_CLIENT",
        "deadline": "2026-07-20",
        "required": true
      }
    ],
    "count": 1,
    "mostUrgent": { ... }
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 5. Complete Action

**Tool:** `workspaceCompleteClientAction` | **Capability:** `CompleteClientAction`

```http
POST /api/luna/complete-action
```

Marks a client action as completed. Updates Request status if all actions are resolved.

**Body:**

```json
{
  "actionId": "act_789",
  "response": "Sent the photos in the previous comment",
  "attachments": ["photo1.jpg", "photo2.jpg"]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "action": { "id": "act_789", "status": "COMPLETED", ... },
    "event": { "type": "LUNA_ACTION_COMPLETED", ... },
    "statusUpdate": { "requestId": "req_abc", "previousStatus": "WAITING_CLIENT", "newStatus": "IN_DEVELOPMENT" },
    "allPendingResolved": true
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 6. Create Request

**Tool:** `workspaceCreateRequest` | **Capability:** `CreateRequest`

```http
POST /api/luna/create-request
```

Creates a new Request within a Project. Entry point for all client communication.

**Body:**

```json
{
  "projectId": "proj_xyz789",
  "content": "The carousel is slow and some images don't appear",
  "urgencyHint": "It's affecting sales"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "request": {
      "id": "req_456def",
      "content": "The carousel is slow...",
      "status": "Received",
      "projectId": "proj_xyz789",
      "createdAt": "2026-07-16T10:00:00Z",
      "nextSteps": ["Analysis by Luna", "Team review"]
    }
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 7. Get Request

**Tool:** `workspaceGetRequest` | **Capability:** `GetRequest`

```http
GET /api/luna/get-request?id=req_456def
```

Retrieves a specific Request with full context: comments, timeline, client actions, approvals, attachments.

**Response:**

```json
{
  "success": true,
  "data": {
    "request": {
      "id": "req_456def",
      "content": "...",
      "status": "IN_DEVELOPMENT",
      "project": { "id": "proj_xyz", "name": "...", "type": "..." },
      "organization": { "id": "org_abc", "name": "..." },
      "attachments": [...],
      "comments": [...],
      "clientActions": [...],
      "approvals": [...],
      "needs": [...],
      "timeline": [...],
      "nextStep": "...",
      "createdAt": "...",
      "updatedAt": "..."
    }
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 8. List Requests

**Tool:** `workspaceListRequests` | **Capability:** `ListRequests`

```http
GET /api/luna/list-requests?organizationId=org_abc123&projectId=proj_xyz&status=IN_DEVELOPMENT
```

Lists requests for an organization or project, with optional filters.

**Response:**

```json
{
  "success": true,
  "data": {
    "requests": [...],
    "summary": {
      "total": 12,
      "open": 3,
      "inDevelopment": 5,
      "waitingClient": 2,
      "inReview": 1,
      "closed": 1
    },
    "filters": { "organizationId": "org_abc", "projectId": "proj_xyz", "status": "IN_DEVELOPMENT" }
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 9. Create Comment

**Tool:** `workspaceCreateComment` | **Capability:** `CreateComment`

```http
POST /api/luna/create-comment
```

Adds a contextual comment to a Request. Luna can only create internal (non-client-visible) comments.

**Body:**

```json
{
  "requestId": "req_456def",
  "content": "Internal note about the analysis...",
  "visibility": "internal",
  "replyTo": "cmt_111aaa"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "comment": {
      "id": "cmt_222bbb",
      "requestId": "req_456def",
      "content": "Internal note...",
      "visibility": "internal",
      "author": "Luna",
      "replyTo": "cmt_111aaa",
      "createdAt": "2026-07-16T10:00:00Z"
    }
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 10. List Events

**Tool:** `workspaceListEvents` | **Capability:** `ListEvents`

```http
GET /api/luna/list-events?requestId=req_456def&fromDate=2026-07-01&toDate=2026-07-15&type=StatusChange&limit=50
```

Reconstructs a Request's timeline from Events. Events are immutable.

**Response:**

```json
{
  "success": true,
  "data": {
    "events": [...],
    "count": 15,
    "stats": {
      "totalDuration": 120,
      "statusBreakdown": { "RECEIVED": 1, "IN_DEVELOPMENT": 3 },
      "actorBreakdown": { "Cliente": 5, "Luna": 4, "Equipe": 6 },
      "totalEvents": 15
    }
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 11. Summarize Timeline

**Tool:** `workspaceSummarizeTimeline` | **Capability:** `SummarizeTimeline`

```http
GET /api/luna/summarize-timeline?requestId=req_456def&style=detailed&focus=pendencies
```

Generates an intelligent summary of a Request's timeline. Never invents information.

**Response:**

```json
{
  "success": true,
  "data": {
    "requestId": "req_456def",
    "summary": "Timeline summary (15 events): ...",
    "keyPoints": [...],
    "pendencies": [...],
    "nextSteps": [...],
    "style": "detailed",
    "focus": "pendencies",
    "eventCount": 15,
    "generatedAt": "2026-07-16T10:00:00Z"
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 12. Notify Client

**Tool:** `workspaceNotifyClient` | **Capability:** `SendNotification`

```http
POST /api/luna/notify-client
```

Creates a notification event and triggers delivery to the client.

**Body:**

```json
{
  "requestId": "req_456def",
  "message": "Your carousel fix is ready for review!",
  "channel": "email",
  "priority": "high"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "notification": {
      "id": "not_777",
      "eventId": "evt_888",
      "requestId": "req_456def",
      "message": "Your carousel fix is ready for review!",
      "channel": "email",
      "priority": "high",
      "status": "QUEUED",
      "createdAt": "2026-07-16T10:00:00Z"
    },
    "event": { "type": "NOTIFICATION_SENT", ... }
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 13. Request Approval

**Tool:** `workspaceRequestApproval` | **Capability:** `RequestApproval`

```http
POST /api/luna/request-approval
```

Requests formal client approval for a delivery. Changes Request status to CLIENT_REVIEWING.

**Body:**

```json
{
  "requestId": "req_456def",
  "message": "Your carousel is ready! Check the preview and let us know what you think.",
  "previewUrl": "https://preview.nexo.app/carousel-fix",
  "checklist": ["Images load", "Smooth transition", "Mobile ok"]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "approval": {
      "id": "app_999",
      "requestId": "req_456def",
      "message": "Your carousel is ready!...",
      "status": "REQUESTED",
      "previewUrl": "https://preview.nexo.app/carousel-fix",
      "checklist": [...],
      "createdAt": "2026-07-16T10:00:00Z"
    },
    "event": { "type": "APPROVAL_REQUESTED", ... },
    "statusUpdate": { "requestId": "req_456def", "previousStatus": "IN_DEVELOPMENT", "newStatus": "CLIENT_REVIEWING" }
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 14. Approve Request

**Tool:** `workspaceApproveRequest` | **Capability:** `Approve`

```http
POST /api/luna/approve-request
```

Client approves a delivery. Closes the operational cycle.

**Body:**

```json
{
  "approvalId": "app_999",
  "feedback": "It turned out perfect, thank you!"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "approval": { "id": "app_999", "status": "APPROVED", ... },
    "statusUpdate": { "requestId": "req_456def", "previousStatus": "CLIENT_REVIEWING", "newStatus": "CLOSED" },
    "events": [
      { "type": "APPROVAL_APPROVED", ... },
      { "type": "REQUEST_COMPLETED", ... }
    ]
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

### 15. Reject Request

**Tool:** `workspaceRejectRequest` | **Capability:** `Reject`

```http
POST /api/luna/reject-request
```

Client rejects a delivery and requests adjustments. Keeps the Request open and creates a new Client Action.

**Body:**

```json
{
  "approvalId": "app_999",
  "feedback": "The images are distorted on mobile",
  "attachments": ["mobile_bug.png"]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "approval": { "id": "app_999", "status": "REJECTED", ... },
    "statusUpdate": { "requestId": "req_456def", "previousStatus": "CLIENT_REVIEWING", "newStatus": "IN_DEVELOPMENT" },
    "clientAction": {
      "id": "act_new",
      "type": "Detail adjustments",
      "description": "Client rejected delivery. Please detail necessary adjustments.",
      "status": "PENDING_CLIENT",
      "required": true
    },
    "events": [
      { "type": "APPROVAL_REJECTED", ... },
      { "type": "CLIENT_ACTION_CREATED", ... }
    ]
  },
  "meta": { "timestamp": "...", "version": "1.0.0" }
}
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing X-Luna-Key header |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests (100/min limit) |
| `VALIDATION_ERROR` | 422 | Missing or invalid request fields |
| `REQUEST_NOT_FOUND` | 404 | Request ID does not exist |
| `PROJECT_NOT_FOUND` | 404 | Project ID does not exist |
| `ACTION_NOT_FOUND` | 404 | Client Action ID does not exist |
| `APPROVAL_NOT_FOUND` | 404 | Approval ID does not exist |
| `PENDING_CLIENT_ACTIONS` | 422 | Client actions must be completed first |
| `ALREADY_COMPLETED` | 422 | Resource is already in completed state |
| `ALREADY_APPROVED` | 422 | Approval was already processed |
| `DUPLICATE_APPROVAL` | 422 | A pending approval already exists |
| `INVALID_STATUS_TRANSITION` | 422 | Status change not allowed |
| `FORBIDDEN` | 403 | Luna key lacks permission for this action |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Domain Rules

- Luna **never** has operational authority — it prepares, the team decides
- Luna **never** publishes comments visible to clients (only internal)
- Needs are **never** exposed to clients — they're internal operational entities
- Every action generates an **Event** for complete audit trail
- Every **Notification** references an Event
- Status transitions follow the [Domain Blueprint](./Domain%20Blueprint.md)

---

## Webhook Events

The following events are available via webhook:

- `request.created` - New request created
- `request.status_changed` - Request status changed
- `request.completed` - Request completed
- `client_action.created` - Client action created
- `client_action.completed` - Client action completed
- `approval.requested` - Approval requested
- `approval.approved` - Approval approved
- `approval.rejected` - Approval rejected
- `comment.created` - Comment created
- `need.created` - Need created

---

*This API follows the Interface Blueprint and AI Native Tools Catalog specifications. All endpoints converge on the same Capabilities and Domain rules, regardless of the consumer (Luna, Dashboard, Workspace, or external integrations).*
