import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library only registers its own cleanup when Vitest globals are on; they are off here.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
