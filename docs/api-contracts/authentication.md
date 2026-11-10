# Authentication API Contract (Target Demo)

**Current state:** no Authentication Service or auth middleware exists in the repository. **Target:** a simple JWT login for the university demo. Prefix: `/api/v1/auth`. No Refresh Tokens or OAuth are included. The JWT signing key is supplied through `JWT_SECRET`, not committed, and used consistently by the services that verify tokens locally.

## Endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/register` | Public | Create a customer account; public registration cannot create admins. |
| `POST` | `/login` | Public | Verify credentials and issue a JWT valid for 3600 seconds. |
| `GET` | `/me` | Valid Bearer JWT | Return the current user's ID and role. |

Admin accounts are created through an administrative demo seed step, not through `POST /register`. The seed account credentials must be provided through local demo configuration and must not be committed as real credentials. Register must ignore or reject any submitted role; it assigns `customer`.

## Requests and successful responses

Register request:

```json
{"email":"student@example.com","password":"DemoPass123!","name":"Student"}
```

Response `201`:

```json
{"data":{"id":"user-1","email":"student@example.com","name":"Student","role":"customer"}}
```

Login request:

```json
{"email":"student@example.com","password":"DemoPass123!"}
```

Response `200`:

```json
{"data":{"token":"<jwt>","tokenType":"Bearer","expiresIn":3600,"user":{"id":"user-1","email":"student@example.com","role":"customer"}}}
```

`GET /me` response:

```json
{"data":{"id":"user-1","email":"student@example.com","role":"customer"}}
```

## Password storage and JWT

Hash passwords with **bcrypt** before database storage. Never store, log, or return the original password or password hash. Compare login input with the stored bcrypt hash.

JWT lifetime is **3600 seconds**. The token includes these claims:

| Claim | Meaning |
|---|---|
| `sub` | User ID. |
| `role` | User role, such as `customer` or `admin`. |
| `iat` | Issued-at timestamp (Unix time). |
| `exp` | Expiration timestamp (Unix time), 3600 seconds after issue. |

Example decoded payload (illustrative): `{"sub":"user-1","role":"customer","iat":1760000000,"exp":1760003600}`. Authentication and every protected service reject a missing, malformed, incorrectly signed, or expired token. Protected routes return `401` when no valid JWT is supplied; return `403` when a valid token lacks the required role.

## Validation rules

- **Email:** trim leading/trailing whitespace, convert to lowercase for storage and lookup, require a conventional `local-part@domain` format, and limit to 254 characters. The normalized value is unique.
- **Password:** required string of 8–72 UTF-8 bytes (to stay within bcrypt's input limit); do not trim or alter it. Never echo it in validation errors.
- **Name:** trim leading/trailing whitespace, require 1–80 characters after trimming, and reject control characters.
- **Role:** public registration always creates `customer`; never accept privilege from request data.

## Error response and status codes

All errors use this shape:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":[{"field":"email","message":"Must be a valid email address"}]}}
```

Use `400 VALIDATION_ERROR` for invalid fields, `401 INVALID_CREDENTIALS` for a generic login failure, `401 TOKEN_REQUIRED` when a protected request omits a token, `401 TOKEN_INVALID` for malformed/incorrectly signed tokens, `401 TOKEN_EXPIRED` for expired tokens, `403 FORBIDDEN` for insufficient role, `409 EMAIL_ALREADY_EXISTS` for duplicate normalized email, and `500 INTERNAL_ERROR` for unexpected failures. Never include credentials, token contents, password hashes, or stack traces in errors.

Demo logout is client-side token removal. Server-side token revocation and refresh are outside this demo contract.
