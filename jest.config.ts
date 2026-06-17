import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // Custom resolver forces @langchain/* sub-paths to their CJS bundles via
  // each package's exports map. Handles both flat files and directory sub-paths.
  resolver: "<rootDir>/jest-langchain-resolver.cjs",
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  // Force CJS resolution for ESM-only packages
  moduleNameMapper: {
    // bson ships an ESM default entry that Jest (CJS) cannot parse; force the CJS bundle
    "^bson$": "<rootDir>/node_modules/bson/lib/bson.cjs",
    "^@/(.*)$": "<rootDir>/$1",
    "^@clerk/nextjs/server$": "<rootDir>/__mocks__/@clerk/nextjs/server.ts",
    "^@clerk/themes$": "<rootDir>/__mocks__/@clerk/themes.ts",
  },
  testMatch: ["**/__tests__/**/*.test.(ts|tsx)"],
};

export default config;
