// X's official embed of one post, loaded when its card comes into view. The
// stored fallback shows until the embed renders, and stays when the embed
// fails: a deleted post, a protected account, or an authored seed post. The
// embed script comes from X once per page; the embed itself renders in X's
// own frame, so the page's CSP admits platform.twitter.com and nothing more.
import { type ReactNode, useEffect, useRef, useState } from "react";

interface Twttr {
  widgets: {
    createTweet(
      id: string,
      target: HTMLElement,
      options: Record<string, string | boolean>,
    ): Promise<HTMLElement | undefined>;
  };
}

let loading: Promise<Twttr | undefined> | undefined;

function loadWidgets(): Promise<Twttr | undefined> {
  loading ??= new Promise((resolve) => {
    const existing = (window as { twttr?: Twttr }).twttr;
    if (existing?.widgets) return resolve(existing);
    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.onload = () => resolve((window as { twttr?: Twttr }).twttr);
    script.onerror = () => resolve(undefined);
    document.head.appendChild(script);
  });
  return loading;
}

const EMBED_TIMEOUT_MS = 8000;

export function XEmbed({ postId, dark, fallback }: { postId: string; dark: boolean; fallback: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"waiting" | "loading" | "shown" | "failed">("waiting");

  useEffect(() => {
    const element = outer.current;
    if (!element || state !== "waiting") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setState("loading");
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [state]);

  useEffect(() => {
    if (state !== "loading") return;
    let live = true;
    const timer = setTimeout(() => live && setState("failed"), EMBED_TIMEOUT_MS);
    void loadWidgets().then(async (twttr) => {
      const into = target.current;
      if (!twttr || !into || !live) return live && setState("failed");
      const rendered = await twttr.widgets
        .createTweet(postId, into, { theme: dark ? "dark" : "light", dnt: true, conversation: "none", align: "left" })
        .catch(() => undefined);
      if (!live) return;
      clearTimeout(timer);
      setState(rendered ? "shown" : "failed");
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [state, postId, dark]);

  return (
    <div ref={outer} data-slot="x-embed" data-state={state} className="min-w-0">
      <div ref={target} className={state === "shown" ? "[&_.twitter-tweet]:my-0!" : "hidden"} />
      {state === "shown" ? null : fallback}
    </div>
  );
}
