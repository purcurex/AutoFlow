module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: 'test/.*\.e2e-spec\.ts$',
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
}
