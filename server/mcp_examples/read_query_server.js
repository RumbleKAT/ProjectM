import { Server } from "@modelcontextprotocol/sdk/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock Database
 * 실제 환경에서는 Prisma나 다른 DB 클라이언트를 사용하여 조회합니다.
 */
const mock_products = [
  { id: "p1", name: "Mechanical Keyboard", price: 150, stock: 20, category: "Peripherals" },
  { id: "p2", name: "Gaming Mouse", price: 80, stock: 50, category: "Peripherals" },
  { id: "p3", name: "4K Monitor", price: 400, stock: 10, category: "Displays" },
  { id: "p4", name: "USB-C Hub", price: 50, stock: 100, category: "Accessories" },
];

/**
 * MCP 서버 인스턴스 생성
 */
const server = new Server(
  {
    name: "read-query-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * 도구 정의: get_product_info
 * 조회성 쿼리를 수행하는 도구입니다.
 */
server.tool(
  "get_product_info",
  "조회할 상품의 ID를 입력하면 해당 상품의 상세 정보를 반환합니다. (Read-only)",
  {
    product_id: "조회할 상품의 고유 ID (예: p1, p2, p3...)",
  },
  async ({ product_id }) {
    console.error(`[Server] Received request for product_id: ${product_id}`);
    
    // 실제 쿼리 로직이 들어갈 부분
    // 예: const product = await prisma.product.findUnique({ where: { id: product_id } });
    const product = mock_products.find((p) => p.id === product_id);

    if (!product) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Product with ID "${product_id}" not found.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            data: product,
            message: "Product retrieved successfully.",
          }, null, 2),
        },
      ],
    };
  }
);

/**
 * 서버 실행 (Stdio transport 사용)
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Read Query Server running on stdio");
}

main().catch(console.error);
