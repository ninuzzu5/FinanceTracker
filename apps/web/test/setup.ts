import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

beforeEach(() => {
  // No production environment file or real Auth/database requests in tests.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in frontend tests"); }));
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
