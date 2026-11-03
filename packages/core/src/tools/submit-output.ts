import { Validator } from '@cfworker/json-schema'

// 提交结构化结果：按 Agent 的 JSON Schema 校验，不合格把错误返回给模型让它改。

export type SubmitOutputResult = { ok: true; output: unknown } | { ok: false; errors: string[] }

export function validateOutput(
  schema: Record<string, unknown>,
  output: unknown,
): SubmitOutputResult {
  const validator = new Validator(schema as never, '2020-12', false)
  const result = validator.validate(output)
  if (result.valid) return { ok: true, output }
  return {
    ok: false,
    errors: result.errors.map((e) => `${e.instanceLocation}: ${e.error}`),
  }
}
