# PayNetWorx Integration Plan

## Overview

Implement PayNetWorx integration with 3DS card verification and tokenization. Flow: verify card via 3DS → tokenize via Hosted Payments → store token/metadata → use tokens for future transactions.

## Schema Changes

### 1. Create PaymentMethod Model (`prisma/schema.prisma`)

Add new `PaymentMethod` model to store PayNetWorx tokens and card metadata:

- `id`, `UserId` (relation to Users)
- `Provider` (enum: "paynetworx", potentially "stripe" for backward compatibility)
- `ProviderPaymentMethodId` (PayNetWorx token - Varchar)
- `CardLast4` (Varchar(4))
- `CardBrand` (Varchar)
- `CardExpMonth` (Varchar(2))
- `CardExpYear` (Varchar(4))
- `IsDefault` (Boolean)
- `Active` (Boolean)
- `Verified` (Boolean) - tracks if card passed 3DS verification
- `created_at`, `updated_at` (DateTime)
- Relations: Users, Transaction[]
- Indexes on UserId, ProviderPaymentMethodId

### 2. Update Transaction Model (`prisma/schema.prisma`)

Add PayNetWorx fields:

- `PaymentMethodId` (Int, nullable, relation to PaymentMethod)
- `PaynetworxPaymentId` (Varchar, nullable)
- `Paynetworx3DSId` (Varchar, nullable - stores threeDSServerTransID)
- Keep existing `StripePaymentIntentId`, `StripePayoutId` for backward compatibility

### 3. Update Users Model (`prisma/schema.prisma`)

Add relation to PaymentMethod[] (for querying user's saved cards)

### 4. Migration

Create migration: `npx prisma migrate dev --name add_paynetworx_payment_methods`

## New Services

### 1. `services/paynetworxService.js`

PayNetWorx 3DS API integration:

**Functions:**

- `initiate3DSAuth(req, res)` - POST `/v0/transaction/auth` with card details, handles all 3DS response types (frictionless, challenge, method URL)
- `check3DSMethod(req, res)` - GET `/v0/transaction/auth/{tranId}/3ds_method` after browser fingerprinting
- `checkChallengeResult(req, res)` - GET `/v0/transaction/auth/{tranId}/auth_challenge` with polling/retry logic
- `processPaymentWithToken(req, res)` - Process payment using saved PayNetWorx token (uses standard Payment API if available, or 3DS with token if required)
- Helper: `getAuthHeader()` - HTTP Basic Auth header generation using `btoa()`
- Helper: `waitForChallenge(tranId, maxRetries)` - Polling helper for challenge results

**Configuration:**

- `PAYNETWORX_3DS_API_URL` (env var) - Base URL for 3DS API
- `PAYNETWORX_PAYMENT_API_URL` (env var, optional - may be same as 3DS API base URL)
- `PAYNETWORX_ACCESS_TOKEN_USER`, `PAYNETWORX_ACCESS_TOKEN_PASSWORD` (env vars)
- Use axios for HTTP requests
- Request headers: Authorization (Basic via btoa), Content-Type, Request-ID (uuid v4)

### 2. `services/paymentMethodService.js`

Payment method management and tokenization:

**Functions:**

- `initializeTokenizationSession(req, res)` - POST to Hosted Payments `/v1/payments/sessions/create` with `payment_session_use: "TOKENIZE"`, returns session URL for iframe
- `saveTokenizedPaymentMethod(req, res)` - Save token and metadata after frontend receives tokenized data via postMessage
- `getUserPaymentMethods(req, res)` - List all active payment methods for authenticated user (exclude tokens, return metadata only)
- `setDefaultPaymentMethod(req, res)` - Set one payment method as default, unset others
- `deletePaymentMethod(req, res)` - Soft delete (set Active=false), handle default reassignment
- `verifyAndTokenizeCard(req, res)` - Orchestrates: initiate 3DS → wait for verification → tokenize → save (this combines verification and tokenization in one flow)

## Updated Services

### `services/stripeService.js`

Keep existing Stripe functionality for backward compatibility.

## API Endpoints (`app.js`)

### PayNetWorx 3DS Endpoints (all require authentication)

- `POST /paynetworx/3ds/initiate` - Initiate 3DS authentication
- `GET /paynetworx/3ds/method/:tranId` - Check 3DS method status after fingerprinting
- `GET /paynetworx/3ds/challenge/:tranId` - Poll challenge completion result

### Payment Method Management (all require authentication)

- `POST /payment-methods/tokenize/session` - Initialize Hosted Payments tokenization session
- `POST /payment-methods/tokenize/save` - Save tokenized payment method after frontend completes
- `GET /payment-methods` - List user's payment methods
- `PUT /payment-methods/:paymentMethodId/default` - Set default payment method
- `DELETE /payment-methods/:paymentMethodId` - Delete payment method

### Combined Verification + Tokenization Flow

- `POST /payment-methods/verify-and-tokenize` - Complete flow: 3DS verify → tokenize → save

### Transaction Endpoints

- `POST /paynetworx/payment` - Process payment with saved token (requires authentication)
- Update existing `/add-funds` to support PayNetWorx tokens as paymentMethodId option

## Dependencies

Add to `package.json`:

- `axios` (for HTTP requests to PayNetWorx APIs)
- `uuid` (for Request-ID headers)

## Environment Variables

**QA Environment:**
```
