/** End-to-end tests: real NestJS app + real PostgreSQL (TEST database only). */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".e2e-spec.ts$",
  transform: { "^.+\\.(t|j)s$": "ts-jest" },
  testEnvironment: "node",
  setupFiles: ["<rootDir>/support/env.ts"],
  globalSetup: "<rootDir>/support/global-setup.ts",
  testTimeout: 30000,
};
