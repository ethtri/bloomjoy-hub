// Replace only the std server listener in tests. Production handlers and the
// real Supabase HTTP client remain unchanged and execute over loopback HTTP.
export const servers: Deno.HttpServer<Deno.NetAddr>[] = [];
export const serve = (handler: (request: Request) => Response | Promise<Response>) => {
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, handler);
  servers.push(server);
  return server.finished;
};
