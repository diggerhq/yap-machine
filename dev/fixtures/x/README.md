# X API fixtures

Authored responses of `GET /2/tweets/search/recent`, in the shape the API
returns. Every handle, name and text is invented; no real post appears here.

- `page-1.json` a first page: a plain post, a reply (its parent in
  `includes.tweets`), a long post whose full text is in `note_tweet`, a post
  whose author is missing from `includes.users` (skipped), and a `next_token`.
- `page-2.json` the page that token returns, using the API's other spellings
  (`includes.posts`, `note_post`, `referenced_posts`), with a quote, and a
  further `next_token` the tool must not follow.
- `empty.json` no new posts: no `data`, `result_count` 0, no `newest_id`.
- `rejected.json` a 400 for a `since_id` outside the window.
