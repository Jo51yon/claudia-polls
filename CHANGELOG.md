# Changelog

Semantic versioning: MAJOR = a prop, exported type, or default behaviour changed in a way that
could break an existing consumer without any code change on their side. MINOR = additive only.
Consuming projects should pin to a tag (`#v1.0.0`), never `#main`.

## v1.0.0 — 2026-08-23

First release. `ClaudiaPollView` (voting) + `ClaudiaPollResults` (aggregate display) --
ported from SafeSpaces' real `polls`/`poll_questions`/`poll_options`/`poll_responses` tables
and its actual 453-line `PollView.tsx` (checked both before this). Four question types
(single choice, multiple choice, free text, 1-10 rating), time/status gating, required-field
validation, results-visibility gating (public/after_vote/after_close/admin_only).

`distribution_list_id`/`event_id`/`send_to_all` (real SafeSpaces targeting mechanisms) and
`result_image_url`/`result_article_id` (real result-announcement features) are NOT ported --
named plainly, not silently dropped.

This is the most thoroughly tested schema this session, matching its real complexity: the
genuinely tricky case is that `'after_vote'` results-visibility depends on whether THIS
specific user has responded, not just whether anyone has -- a plain RLS policy can't express
that, so a real, dedicated RPC (`claudia_poll_can_view_results`) does the check. Verified with
three separate real authenticated sessions before any UI was written: the same user before
voting (hidden), the same user after voting (visible), and a genuinely different, non-voting
user (still hidden, confirming the check is per-user, not per-poll). A real forge attempt on
responses -- a session claiming a different user's id -- is refused by RLS (the actual
policy-violation error). Results aggregation (`claudia_poll_results`) never exposes individual
respondent identity, only counts and averages, and returns nothing at all to a caller not yet
allowed to see it, confirmed as a separate real test rather than assumed from the visibility
check alone. Cascade deletion (poll → questions → options → responses) confirmed to leave no
orphaned rows.

**Known consumers at this tag:** none yet at release.
