module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': 'babel-jest',
  },
  testMatch: ['**/__tests__/**/(*.)+(spec|test).[tj]s?(x)'],
  // The CLI imports a generated JSON file; tell Jest how to handle .json
  // (the default already does this, but be explicit).
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
