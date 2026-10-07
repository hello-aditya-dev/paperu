# ADR 0010: Commercial licensing boundary

- **Status:** Accepted
- **Date:** Foundation pass (pre-`0.1.0`)
- **Decision owner:** Integrator
- **Affected code:** `apps/desktop/src-tauri/src/licensing/**`,
  `apps/desktop/src-tauri/src/commands/**` (future activation
  command), `apps/desktop/src-tauri/migrations/0001_init.sql`
  (`licence_state` table),
  `packages/contracts/src/settings.ts` (`AppInfo.edition`),
  `docs/architecture/licensing.md`

## Context

Paperu will offer paid editions. The planned model is a one-time
lifetime licence:

- **Free** — the default edition. All foundation features are
  available under Free. Future paid engines (when they exist) will
  require `Personal` or `Business`.
- **Personal** — a future lifetime edition (planned price: INR 399).
- **Business** — a future lifetime edition (planned price: INR 799).

The threat this ADR defends against is the silent leakage of payment
concerns into the desktop client. Without a deliberate boundary,
three failure modes are guaranteed over time:

1. **The desktop client tries to verify payment.** It cannot. A
   user with debugger access can patch the binary, modify the local
   DB, or swap the entitlement blob. Any "verification" the desktop
   client performs is theatre.
2. **Payment credentials leak into the desktop binary.** Razorpay
   keys, webhook secrets, customer PII — all belong server-side. A
   desktop binary that contains them is a one-shot leak waiting to
   happen.
3. **The desktop client asks the server "is this allowed" per
   operation.** This couples every file operation to a network call,
   breaking the local-first invariant (ADR
   `0002-local-first-processing.md`) and leaking the user's
   activity to the server.

The boundary must keep three concerns separate:

- **Payment** — handled by a server (the future Razorpay
  integration lives server-side only).
- **Entitlement** — the local, signed view of what the user is
  allowed to do.
- **Feature gating** — the desktop client consulting the local
  entitlement to decide whether to run a feature.

## Decision

Paperu maintains a **clean separation of payment -> licence
entitlement -> local feature gating**. The desktop client never
trusts itself for payment verification.

### Editions

```rust
pub enum Edition {
    Free,
    Personal,
    Business,
}
```

- **Free** — the default. All foundation features are Free. Future
  paid engines (when they exist) will require `Personal` or
  `Business`.
- **Personal** — a future lifetime edition (planned price: INR
  399).
- **Business** — a future lifetime edition (planned price: INR
  799).

The planned prices are documented in `licensing/mod.rs` for
traceability but are **not enforced anywhere in the foundation**.
The desktop client never trusts itself for payment truth.

### Entitlement

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
- **Not the source of truth for payment.** The source of truth for
  payment is a server the desktop client does not control. The
  local entitlement is the desktop client's *cached* view of what
  the server says the user is allowed to do.
- **Subject to offline grace.** If the desktop client cannot reach
  the server to revalidate, it continues to honour the last known
  entitlement for a grace period (days, not hours). After the grace
  period, paid features are disabled until revalidation succeeds.

The `current_entitlement()` function in the foundation always
returns the default (`Edition::Free`, `activated: false`,
`offline_grace_days: None`). A future activation command will
replace this with a verified view.

### The boundary

1. **Payment.** Handled by a server. The future Razorpay
   integration lives server-side only. The desktop client never
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
  not need to ask the server "is this allowed" per operation — it
  consults the cached, signed entitlement.

### What this means concretely

- **The desktop client never trusts itself for payment truth.**
  Even if `Entitlement.activated == true`, the desktop client
  knows this is a cached view that the server can revoke.
- **No production keys.** The repository contains no Razorpay
  keys, no signing keys, no licence keys. The CI secrets store
  will hold them at release time only (see `docs/releases/workflow.md`
  and `.env.example`).
- **No fake licences.** The foundation does not synthesise a
  Personal or Business entitlement for testing. Tests use the
  default (`Free`).
- **Future Razorpay lives server-side only.** When payment is
  implemented, the desktop client will redirect to a hosted
  checkout, receive a licence key on success, and submit the key to
  the entitlement server. The desktop client never sees a payment
  credential.

### Future activation flow

When the first paid engine lands, the activation flow will:

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

### Offline grace

`Entitlement.offline_grace_days: Option<u32>` records how many
days the desktop client will continue to honour a paid entitlement
without revalidation. In the foundation this is `None` (no
activated entitlement, no grace).

When the activation flow lands:

- The signed entitlement blob includes an expiry timestamp.
- The desktop client continues to honour the entitlement until the
  expiry, even if it cannot reach the server.
- After the expiry, paid features are disabled (not removed —
  revalidation can re-enable them).
- The user is told their entitlement needs revalidation, not that
  they have lost their licence.

The grace window will be generous (days, not hours). The exact
value will be set when the activation flow is implemented.

### Error codes

The error catalogue (`packages/contracts/src/errors.ts` and the
Rust mirror) reserves four licensing codes:

- `licensing.missing` — no entitlement found for a paid feature.
- `licensing.expired` — the entitlement has expired and needs
  revalidation.
- `licensing.revoked` — the server has revoked the entitlement.
- `licensing.feature_not_entitled` — the current edition does not
  permit this feature.

These codes are reserved; they are not yet emitted by any code path
because no paid features exist yet.

## Consequences

### Positive

- **No payment credentials in the desktop binary.** Razorpay keys,
  webhook secrets, and customer PII stay server-side. The desktop
  binary is not a leak vector for payment infrastructure.
- **The desktop client cannot be tricked into granting entitlement
  by patching.** The signed entitlement blob is the strong
  guarantee; patching the binary to "skip the check" does not forge
  a signature.
- **The local-first invariant is preserved.** Feature gating
  consults the local cached entitlement; no per-operation network
  call.
- **Offline use is supported.** The grace window lets users
  continue working without a network connection.
- **The boundary is testable in isolation.** Each concern (payment,
  entitlement, gating) has a clear contract and can be tested
  independently. The foundation tests `current_entitlement()`
  returning the default.

### Negative

- **The desktop client must verify a signature.** Signature
  verification adds a small dependency (likely `ed25519-dalek` or
  similar, permissively licensed) and a small amount of code. The
  pinned public key must be embedded in the binary; rotating it
  requires a desktop release.
- **Server infrastructure is required for paid features.** The
  entitlement server is a separate project, not in this repository.
  Until it exists, paid features cannot ship.
- **Offline grace is a balance.** Too short, and users on flaky
  networks are constantly locked out of paid features. Too long,
  and a revoked entitlement stays valid for too long. The exact
  value will be tuned when the activation flow lands.
- **No production keys today.** The repository has no signing keys,
  no licence keys, no Razorpay keys. This is intentional — secrets
  are not committed (see `.env.example`).

## Non-goals

- **No subscription model.** The planned editions are lifetime
  licences. A subscription model is a separate decision and would
  require its own ADR.
- **No machine binding.** The foundation does not bind a licence to
  a specific machine ID. If machine binding is added later, it is
  a separate ADR.
- **No anti-piracy enforcement beyond signature verification.**
  The desktop client verifies the entitlement signature; it does
  not phone home to check, does not watermark outputs, does not
  refuse to run if it suspects tampering. A user who patches the
  binary to bypass gating can do so; we rely on the value of the
  paid product, not on technical enforcement.

## References

- `apps/desktop/src-tauri/src/licensing/mod.rs` — `Edition`,
  `Entitlement`, `current_entitlement()`, planned prices.
- `apps/desktop/src-tauri/migrations/0001_init.sql` — the
  `licence_state` table.
- `apps/desktop/src-tauri/src/commands/mod.rs::read_app_info` —
  exposes the edition string to the frontend.
- `packages/contracts/src/settings.ts` — `AppInfo.edition`.
- `packages/contracts/src/errors.ts` — reserved licensing error
  codes.
- `docs/architecture/licensing.md` — the full licensing
  architecture.
- `docs/decisions/0002-local-first-processing.md` — the
  local-first invariant the boundary preserves.
- `docs/releases/workflow.md` — release secrets (none committed
  today).
- `.env.example` — no secrets are committed.
