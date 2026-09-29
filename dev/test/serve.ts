// Serves a request the way the framework would, for the route tests: match
// the path to a route file, run its request middleware, then its method
// handler. The route files are found by name, so a new one needs nothing here.
type AnyRoute = { options: { server?: { middleware?: readonly unknown[]; handlers?: Record<string, unknown> } } };
type Middleware = { options: { middleware?: readonly Middleware[]; server?: (opts: unknown) => unknown } };

/** Every route file under src/routes/api, as the framework maps its name to a path. */
export const ROUTES: readonly (readonly [RegExp, AnyRoute, readonly string[]])[] = Object.entries(
  import.meta.glob<{ Route: AnyRoute }>("../../src/routes/api/**/*.ts", { eager: true }),
)
  .map(([file, module]) => {
    const parts = file
      .replace(/^.*src\/routes\//, "")
      .replace(/\.ts$/, "")
      .replace(/\//g, ".")
      .split(".");
    const names: string[] = [];
    const segments = parts.map((part) => {
      if (part === "$") {
        names.push("_splat");
        return "(.*)";
      }
      if (part.startsWith("$")) {
        names.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    });
    return [new RegExp(`^/${segments.join("/")}$`), module.Route, names] as const;
  })
  // Literal paths before parameters, and catch-alls last, as the router does.
  .sort(([a], [b]) => {
    const splat = Number(a.source.includes("(.*)")) - Number(b.source.includes("(.*)"));
    return splat || b.source.split("/").length - a.source.split("/").length || a.source.localeCompare(b.source);
  });

export async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const found = ROUTES.map(([pattern, route, names]) => ({ match: pattern.exec(url.pathname), route, names })).find(
    (entry) => entry.match,
  );
  if (!found?.match) return Response.json({ error: { code: "not_found", message: "No such route." } }, { status: 404 });
  const params = Object.fromEntries(found.names.map((name, index) => [name, found.match?.[index + 1] ?? ""]));
  const server = found.route.options.server ?? {};
  const handler = server.handlers?.[request.method.toUpperCase()] as
    | ((ctx: { request: Request; params: Record<string, string>; context: unknown; pathname: string }) => unknown)
    | undefined;
  if (!handler)
    return Response.json({ error: { code: "method_not_allowed", message: "No such method." } }, { status: 405 });
  const chain = (server.middleware ?? []) as readonly Middleware[];
  let context: Record<string, unknown> = {};
  const run = async (index: number): Promise<Response> => {
    const middleware = chain[index];
    if (!middleware) {
      const result = await handler({ request, params, context, pathname: url.pathname });
      return result instanceof Response ? result : Response.json(result);
    }
    const fn = middleware.options.server;
    if (!fn) return run(index + 1);
    const result = (await fn({
      request,
      pathname: url.pathname,
      context,
      handlerType: "router",
      next: async (options?: { context?: Record<string, unknown> }) => {
        context = { ...context, ...(options?.context ?? {}) };
        return { request, pathname: url.pathname, context, response: await run(index + 1) };
      },
    })) as Response | { response: Response };
    return result instanceof Response ? result : result.response;
  };
  return run(0);
}
