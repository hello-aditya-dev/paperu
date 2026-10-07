/** Vitest setup — matchers and global test configuration. */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { __clearMocks } from "@/lib/ipc";

afterEach(() => {
  __clearMocks();
});
