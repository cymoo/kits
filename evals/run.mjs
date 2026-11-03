#!/usr/bin/env node
// 评测脚本骨架：读 JSONL，按行解析，暂时只统计样本数。
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node evals/run.mjs <samples.jsonl>')
  process.exit(1)
}

const samples = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))

console.log(`loaded ${samples.length} samples from ${file}`)
console.log('TODO: run the agent and compare against expected outputs')
