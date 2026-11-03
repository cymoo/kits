import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'kernel',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
