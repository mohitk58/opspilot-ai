/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@opspilot/types$': '<rootDir>/../../../packages/types/src/index.ts',
  },
  collectCoverageFrom: ['**/*.service.ts'],
  coverageDirectory: '../coverage',
  // JUnit XML for CI's dorny/test-reporter step — per-test pass/fail as
  // GitHub Check annotations instead of buried in the raw Jest log.
  // jest-junit resolves outputDirectory against process.cwd() (apps/api,
  // where `npm test` runs), NOT Jest's rootDir like coverageDirectory above.
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'test-results', outputName: 'junit.xml' }],
  ],
};
