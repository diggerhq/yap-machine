// Serves a request the way the framework would, for the route tests: match
// the path to a route file, run its request middleware, then its method
// handler. Generated from the route files' names; a new route file needs a
// line here (the routes test checks every file is listed).

import { Route as r23 } from "../../src/routes/api/$";
import { Route as r22 } from "../../src/routes/api/agent/$";
import { Route as r11 } from "../../src/routes/api/agent/candidates";
import { Route as r12 } from "../../src/routes/api/agent/judgments";
import { Route as r13 } from "../../src/routes/api/agent/learning";
import { Route as r7 } from "../../src/routes/api/agent/learning.rescores";
import { Route as r2 } from "../../src/routes/api/agent/learning.rescores.lease";
import { Route as r8 } from "../../src/routes/api/agent/learning.rules";
import { Route as r9 } from "../../src/routes/api/agent/queue.lease";
import { Route as r14 } from "../../src/routes/api/agent/report";
import { Route as r0 } from "../../src/routes/api/agent/searches.$id.claim";
import { Route as r15 } from "../../src/routes/api/agent/work";
import { Route as r18 } from "../../src/routes/api/brief";
import { Route as r16 } from "../../src/routes/api/brief.owner";
import { Route as r3 } from "../../src/routes/api/brief.rules.$ruleId";
import { Route as r4 } from "../../src/routes/api/brief.versions.$id";
import { Route as r1 } from "../../src/routes/api/brief.versions.$id.restore";
import { Route as r19 } from "../../src/routes/api/feed";
import { Route as r17 } from "../../src/routes/api/feed.new-count";
import { Route as r5 } from "../../src/routes/api/posts.$id.feedback";
import { Route as r6 } from "../../src/routes/api/posts.$id.open";
import { Route as r20 } from "../../src/routes/api/searches";
import { Route as r10 } from "../../src/routes/api/searches.$id";
import { Route as r21 } from "../../src/routes/api/status";

type AnyRoute = { options: { server?: { middleware?: readonly unknown[]; handlers?: Record<string, unknown> } } };
type Middleware = { options: { middleware?: readonly Middleware[]; server?: (opts: unknown) => unknown } };

export const ROUTES: readonly [RegExp, AnyRoute, readonly string[]][] = [
  [/^\/api\/agent\/searches\/([^/]+)\/claim$/, r0 as AnyRoute, ["id"]],
  [/^\/api\/brief\/versions\/([^/]+)\/restore$/, r1 as AnyRoute, ["id"]],
  [/^\/api\/agent\/learning\/rescores\/lease$/, r2 as AnyRoute, []],
  [/^\/api\/brief\/rules\/([^/]+)$/, r3 as AnyRoute, ["ruleId"]],
  [/^\/api\/brief\/versions\/([^/]+)$/, r4 as AnyRoute, ["id"]],
  [/^\/api\/posts\/([^/]+)\/feedback$/, r5 as AnyRoute, ["id"]],
  [/^\/api\/posts\/([^/]+)\/open$/, r6 as AnyRoute, ["id"]],
  [/^\/api\/agent\/learning\/rescores$/, r7 as AnyRoute, []],
  [/^\/api\/agent\/learning\/rules$/, r8 as AnyRoute, []],
  [/^\/api\/agent\/queue\/lease$/, r9 as AnyRoute, []],
  [/^\/api\/searches\/([^/]+)$/, r10 as AnyRoute, ["id"]],
  [/^\/api\/agent\/candidates$/, r11 as AnyRoute, []],
  [/^\/api\/agent\/judgments$/, r12 as AnyRoute, []],
  [/^\/api\/agent\/learning$/, r13 as AnyRoute, []],
  [/^\/api\/agent\/report$/, r14 as AnyRoute, []],
  [/^\/api\/agent\/work$/, r15 as AnyRoute, []],
  [/^\/api\/brief\/owner$/, r16 as AnyRoute, []],
  [/^\/api\/feed\/new-count$/, r17 as AnyRoute, []],
  [/^\/api\/brief$/, r18 as AnyRoute, []],
  [/^\/api\/feed$/, r19 as AnyRoute, []],
  [/^\/api\/searches$/, r20 as AnyRoute, []],
  [/^\/api\/status$/, r21 as AnyRoute, []],
  [/^\/api\/agent\/(.*)$/, r22 as AnyRoute, ["_splat"]],
  [/^\/api\/(.*)$/, r23 as AnyRoute, ["_splat"]],
];

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
