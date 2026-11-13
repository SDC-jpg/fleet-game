/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Version number of a published build (GitHub's run number); unset when running locally. */
  readonly VITE_BUILD?: string;
  readonly VITE_TEST_KEYS?: string;
}
