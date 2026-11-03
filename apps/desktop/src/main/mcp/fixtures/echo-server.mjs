// 测试用的最小 MCP 服务（stdio）：两个工具，一个只读一个写入
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'echo', version: '0.0.1' })
server.registerTool('get_case', { description: '读一条用例' }, async () => ({
  content: [{ type: 'text', text: 'ok' }],
}))
server.registerTool('create_case', { description: '新建一条用例' }, async () => ({
  content: [{ type: 'text', text: 'ok' }],
}))
await server.connect(new StdioServerTransport())
