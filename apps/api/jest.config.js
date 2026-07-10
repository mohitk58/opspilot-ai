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
};
