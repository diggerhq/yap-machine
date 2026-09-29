// next_posts: the next batch of posts to judge, leased to this session.
import { defineTool } from "@opencomputer/agent";
import { appFailure, callApp } from "../connections/app";
import { EMPTY_INPUT } from "../contract";

export const nextPosts = defineTool({
  name: "next_posts",
  description:
    "Take the next batch of up to 25 unjudged posts, and the number still waiting. Judge every post in the batch with submit_judgments, then call again until no posts come back.",
  input: EMPTY_INPUT,
  async run({ sessionId }) {
    const answer = await callApp("POST", "/api/agent/queue/lease", { sessionId, limit: 25 });
    return answer.ok ? answer.data : appFailure(answer);
  },
});
