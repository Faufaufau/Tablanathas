declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): (
    request: Request,
    env?: unknown,
    context?: unknown,
  ) => Promise<Response>;
}
