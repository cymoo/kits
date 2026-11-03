import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createKitsToolServer } from './server'

const schema = { type: 'object', required: ['n'], properties: { n: { type: 'number' } } }

async function connect(outputSchema?: Record<string, unknown>) {
  const outputs: unknown[] = []
  const server = createKitsToolServer({
    handlers: {
      askUser: async () => ({ answered: false }),
      onOutput: async (o) => {
        outputs.push(o)
      },
    },
    ...(outputSchema ? { outputSchema } : {}),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientTransport)
  return { client, outputs }
}

describe('createKitsToolServer', () => {
  it('only offers submit_output when the agent has an output schema', async () => {
    const without = await connect()
    expect((await without.client.listTools()).tools.map((t) => t.name)).toEqual(['ask_user'])
    const withSchema = await connect(schema)
    expect((await withSchema.client.listTools()).tools.map((t) => t.name)).toEqual([
      'ask_user',
      'submit_output',
    ])
  })

  it('shows the output schema to the model in the tool description', async () => {
    const { client } = await connect(schema)
    const tool = (await client.listTools()).tools.find((t) => t.name === 'submit_output')
    expect(tool?.description).toContain('"required"')
    expect(tool?.description).toContain('"n"')
  })

  it('rejects output that does not match the schema and keeps it out of onOutput', async () => {
    const { client, outputs } = await connect(schema)
    const bad = await client.callTool({ name: 'submit_output', arguments: { output: {} } })
    expect(bad.isError).toBe(true)
    const good = await client.callTool({ name: 'submit_output', arguments: { output: { n: 1 } } })
    expect(good.isError).toBeFalsy()
    expect(outputs).toEqual([{ n: 1 }])
  })
})
