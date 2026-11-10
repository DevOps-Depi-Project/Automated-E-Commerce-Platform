# Payment API Contract (Target Demo)

**Current state:** no Payment Service exists. **Target:** internal Mock Payment only. It simulates success/failure synchronously; no real payment provider, webhooks, card entry, or card storage. Prefix: `/internal/payments`; calls require Order service authorization.

| Method | Endpoint | Request | Success |
|---|---|---|---|
| `POST` | `/` | `{"orderId":"order-1","amount":1999.98,"currency":"USD","simulate":"success"}` | `201` mock payment attempt. |
| `GET` | `/:paymentId` | — | `200` attempt result. |

Success response: `{"data":{"paymentId":"pay-1","orderId":"order-1","status":"SUCCEEDED","amount":1999.98,"currency":"USD"}}`. Failure returns a recorded `FAILED` result; Order then releases inventory and sets its status accordingly. `simulate` is a demo switch and should be disabled or ignored outside demo configuration. No card number/CVV fields are accepted.

Use order ID plus an idempotency key to return the same mock attempt on retry. Validate positive amount and supported currency. Statuses: `400 VALIDATION_ERROR`, `401/403`, `404 PAYMENT_NOT_FOUND`, `409 IDEMPOTENCY_KEY_REUSED`, `503 SERVICE_UNAVAILABLE`, `500 INTERNAL_ERROR`. Real webhooks, refund automation, and provider integration are future scope only.
