/**
 * @paperu/test-fixtures — synthetic test fixtures.
 *
 * Provides:
 *   - Helpers to create synthetic test files on disk (no real user
 *     documents are ever used).
 *   - References to JSON contract fixtures under `contracts/` that
 *     both Rust and TypeScript tests validate against.
 *
 * Fixtures policy (see docs/architecture/testing.md):
 *   - Never commit private/personal documents.
 *   - Synthetic content only.
 *   - Document how future agents add regression fixtures.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Read a JSON contract fixture by name (without extension) and
 * parse it. Used by TypeScript contract tests.
 */
export async function readContractFixture<T = unknown>(
  name: string,
): Promise<T> {
  const raw = await readFile(join(here, "contracts", `${name}.json`), "utf8");
  return JSON.parse(raw) as T;
}

/**
 * Absolute path to the contracts directory (for Rust tests that
 * resolve fixtures via an env var or path computation).
 */
export const contractsDir = join(here, "contracts");

/** A small, deterministic byte payload for synthetic file fixtures. */
export const SYNTHETIC_PAYLOAD = Buffer.from(
  "Paperu synthetic test fixture. Not a real document.\n",
  "utf8",
);
