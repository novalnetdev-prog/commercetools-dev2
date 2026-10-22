/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: "ts-jest",
  transform: {
    "^.+\\.[tj]s$": ["ts-jest", { tsconfig: { allowJs: true } }],
  },
  // light-my-request uses the ESM-only cookie package; transpile that package
  // for Jest's CommonJS runner, as well as our TypeScript integration tests.
  transformIgnorePatterns: ["node_modules/(?!cookie/)"],
  testEnvironment: "node",
  setupFiles: ["./test/jest.setup.ts"],
  roots: ["./test"],
};
