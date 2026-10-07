# Paperu regression tracking

This file is the registry of regressions observed and fixed in
Paperu. A regression is a bug that was introduced (or reintroduced)
in a change to `main`, and the regression test that now guards
against it.

The current state of regressions is **empty** — the foundation
(`0.1.0`) has no known regressions.

---

## What goes here

A regression entry is added by the **Guardian** every time a bug fix
lands. The entry captures:

- The unique regression id.
- The bug it guards against (summary, severity from `BUGS.md`).
- The failing input or scenario that reproduces the bug on the
  unpatched code.
- The expected behaviour.
- The actual (buggy) behaviour.
- The test path (Rust `#[cfg(test)] mod tests` block or TypeScript
  `*.test.ts`/`*.test.tsx` file).
- The PR or commit that fixed the bug.
- The contract or fixture, if any, that was added or updated.

The Guardian is the owner of this file. Entries are appended only;
they are never deleted. If a regression test is removed (because the
code path was deleted), the entry is marked as `RETIRED` with a
reference to the change that retired it.

---

## Entry format

```
### REG-NNNN: <short title>

- Severity: P0 | P1 | P2 | P3
- Fixed in: PR #N / commit <sha>
- Test: <path/to/test>
- Fixture: <packages/test-fixtures/src/contracts/<name>.json> (if any)

Scenario:
  <what the user did>

Failing input:
  <the exact input that triggered the bug>

Expected:
  <what should have happened>

Actual (buggy):
  <what actually happened>

Root cause:
  <one-sentence summary>

Test asserts:
  <what the regression test checks>
```

`NNNN` is a zero-padded sequential number starting at `0001`.

---

## How the Guardian adds a regression entry

1. The Guardian receives a bug report (from a user, from the
   Builder, from CI).
2. The Guardian reproduces the bug on the unpatched code and confirms
   the severity per `BUGS.md`.
3. The Builder (or the Guardian, paired with the Builder) writes the
   fix on a `fix/*` branch.
4. The Guardian writes a regression test that **fails on the
   unpatched code** and **passes on the patched code**. The test
   lives next to the code it guards:
   - Rust: `#[cfg(test)] mod tests` inside the relevant module.
   - TypeScript: a `*.test.ts` / `*.test.tsx` file under the
     relevant feature's `__tests__/` directory.
5. If the regression involves a contract shape, the Guardian adds or
   updates a JSON fixture under
   `packages/test-fixtures/src/contracts/`. Both the Rust
   serialization test and the TypeScript parse test must accept it.
6. The Guardian appends an entry to this file with the format above.
7. The Integrator reviews and merges. The regression entry stays in
   this file permanently.

---

## Current regressions

None.

```
### (none)
```

---

## Retired regressions

None.

A regression is retired only when the code path it guards is removed.
The Guardian marks the entry as `RETIRED` with a reference to the
change that removed the path. The entry itself remains in this file
for traceability.

---

## Tips for the Guardian

- A regression test should be **specific**. It should fail for the
  exact bug, not for unrelated reasons. If the test is flaky, fix
  the test before merging.
- A regression test should be **deterministic**. Use synthetic
  fixtures from `@paperu/test-fixtures`. Never depend on a real
  user file or on the contributor's machine state.
- A regression test should be **fast**. The full `pnpm check` runs
  in CI on every push; a slow regression test slows everyone.
- A regression test should **document the bug**. The test name and
  body should make it obvious what would break without the test.
- When a contract shape changes, the regression fixtures must be
  updated **in the same PR**. A fixture that no longer matches the
  contract is itself a regression.
