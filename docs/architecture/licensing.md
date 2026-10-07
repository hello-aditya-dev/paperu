# Architecture: licensing

This document describes Paperu's licensing architecture: the
editions, the entitlement abstraction, the activation state, the
offline grace state, and the boundary between payment, entitlement
and feature gating. The relevant code is in
`apps/desktop/src-tauri/src/licensing/mod.rs`.

The foundation's licensing is intentionally a **placeholder**. There
are no production licence keys, no Razorpay integration, no
activation flow. The architecture is established so future agents
do not hardwire business assumptions into the core.

See also ADR `docs/decisions/0010-commercial-licensing-boundary.md`.

---

## Editions

```rust
pub enum Edition {
    Free,
    Personal,
    Business,
}
```

- **Free** — the default edition. All foundation features are
  available under Free. Future paid engines (when they exist) will
  require `Personal` or `Business`.
- **Personal** — a future lifetime edition (planned price: ₹399).
- **Business** — a future lifetime edition (planned price: ₹799).

The planned prices are documented in `licensing/mod.rs` for
traceability but are not enforced anywhere in the foundation. The
desktop client never trusts itself for payment truth — see the
boundary section below.

---

## Entitlement

```rust
pub struct Entitlement {
    pub edition: Edition,
    pub activated: bool,
    pub offline_grace_days: Option<u32>,
}
```

The `Entitlement` is the **local view** of what the user is allowed
to do. It is:

- **Local.** Stored locally (eventually in the `licence_state`
  SQLite table). The desktop client reads it to decide which
  features to enable.
- **Not the source of truth for payment.** The source of truth
  for payment is a server the desktop client does not control.
  The local entitlement is the desktop client's *cached* view of
  what the server says the user is allowed to do.
- **Subject to offline grace.** If the desktop client cannot reach
  the server to revalidate, it continues to honour the last known
  entitlement for a grace period. After the grace period, paid
  features are disabled until revalidation succeeds.

The `current_entitlement()` function in the foundation always
returns the default (`Edition::Free`, `activated: false`,
`offline_grace_days: None`). A future activation command will
replace this with a verified view.

---

## Activation state

`Entitlement.activated: bool` records whether the entitlement has
been activated by a real licence. In the foundation:

- `activated` is always `false` (no activation flow exists).
- `edition` is always `Free`.
- The `licence_state` SQLite table exists in the schema
  (see `docs/architecture/database.md`) to hold the local
  activation view, but is empty in the foundation.

A future activation flow will:

1. Accept a licence key from the user (typed via a future command).
2. Send the key to a Paperu-controlled server (over HTTPS).
3. Receive a signed entitlement blob back.
4. Verify the signature against a pinned public key embedded in
   the desktop client.
5. Persist the verified entitlement locally (in `licence_state`).
6. Update `current_entitlement()` to return the verified view.

The desktop client **never** verifies payment itself. It only
verifies the signature on the entitlement blob the server returns.
This is the boundary.

---

## Offline grace

`Entitlement.offline_grace_days: Option<u32>` records how many
days the desktop client will continue to honour a paid entitlement
without revalidation. In the foundation this is `None` (no
activated entitlement, no grace).

When the activation flow lands:

- The signed entitlement blob includes an expiry timestamp.
- The desktop client continues to honour the entitlement until
  the expiry, even if it cannot reach the server.
- After the expiry, paid features are disabled (not removed —
  revalidation can re-enable them).
- The user is told their entitlement needs revalidation, not that
  they have lost their licence.

The grace window will be generous (days, not hours). The exact
value will be set when the activation flow is implemented.

---

## The boundary: payment → entitlement → feature gating

Paperu keeps three concerns separate:

1. **Payment.** Handled by a server (the future Razorpay
   integration lives server-side only). The desktop client never
   sees payment credentials, never verifies a payment, never
   decides a payment succeeded. The desktop client only ever holds
   a licence key (an opaque string) and an entitlement blob (a
   signed view).
2. **Entitlement.** The local view of what the user is allowed to
   do. Verified against the server's signature, persisted locally,
   subject to offline grace.
3. **Feature gating.** The desktop client consults the local
   entitlement to decide whether a feature is enabled. If the
   entitlement does not permit the feature, the desktop client
   returns `licensing.feature_not_entitled` and the UI offers the
   upgrade path.

### Why the separation

- **The desktop client is compromised-trust.** A user with
  debugger access can patch the binary, modify the local DB, or
  swap the entitlement blob. The server's signature is the only
  strong guarantee; the desktop client only verifies it.
- **Server-side payment keeps secrets server-side.** No Razorpay
  keys in the desktop binary. No webhook secrets. No customer PII
  in the desktop DB.
- **Feature gating stays in the desktop.** The server does not
  know which file the user is compressing. The desktop client does
  not need to ask the server "is this allowed" per operation —
  it consults the cached, signed entitlement.

### What this means concretely

- **The desktop client never trusts itself for payment truth.**
  Even if `Entitlement.activated == true`, the desktop client
  knows this is a cached view that the server can revoke.
- **No production keys.** The repository contains no Razorpay
  keys, no signing keys, no licence keys. The CI secrets store
  will hold them at release time only.
- **No fake licences.** The foundation does not synthesise a
  Personal or Business entitlement for testing. Tests use the
  default (`Free`).
- **Future Razorpay lives server-side only.** When payment is
  implemented, the desktop client will redirect to a hosted
  checkout, receive a licence key on success, and submit the key
  to the entitlement server. The desktop client never sees a
  payment credential.

---

## What the foundation does

The foundation:

- Defines the `Edition` enum and the `Entitlement` struct.
- Exposes `current_entitlement()` returning the default (Free,
  not activated, no grace).
- The `read_app_info` command exposes the edition string
  (`"free"`) to the frontend via the `AppInfo` contract.
- The `licence_state` SQLite table exists in the schema for the
  future local entitlement view.

The foundation does **not**:

- Verify any licence key.
- Talk to any server.
- Persist any entitlement beyond the default.
- Gate any feature on edition (no paid features exist yet; all
  foundation features are Free).

---

## Error codes

The error catalogue (`packages/contracts/src/errors.ts` and the
Rust mirror) reserves four licensing codes:

- `licensing.missing` — no entitlement found for a paid feature.
- `licensing.expired` — the entitlement has expired and needs
  revalidation.
- `licensing.revoked` — the server has revoked the entitlement.
- `licensing.feature_not_entitled` — the current edition does not
  permit this feature.

These codes are reserved; they are not yet emitted by any code
path because no paid features exist yet.

---

## What's next

When the first paid engine lands:

1. Add the activation command (`activate_licence(key: String) ->
   Result<Entitlement>`). It posts to the entitlement server,
   receives a signed blob, verifies it, persists it, and returns
   the new `Entitlement`.
2. Add the entitlement-check primitive in each engine's pre-flight.
   If the entitlement does not permit the operation, return
   `licensing.feature_not_entitled`.
3. Add the offline-grace logic. The signed entitlement blob
   includes an expiry; the desktop client honours it until expiry,
   then disables paid features.
4. Add the UI: a "Buy Paperu" entry point that redirects to the
   hosted checkout, an activation dialog, an account/entitlement
   view.

All of this is future work. The foundation's job is to ensure the
boundary is clean so the future work does not leak payment
concerns into the desktop client.
