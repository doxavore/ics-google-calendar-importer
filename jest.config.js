module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'ics-import.js',
    '!**/node_modules/**',
    '!**/test/**'
  ],
  verbose: true
};