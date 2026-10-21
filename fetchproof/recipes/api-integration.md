---
name: api-integration
dimensions:
  - Endpoint surface and versioning | Which endpoints carry the facts, and what a version bump does to them
  - Pagination and result caps | What the API refuses to return in one call, and what that costs at volume
  - Error and retry semantics | Which failures are retryable, and what backoff the provider actually requires
  - SDK vs raw HTTP | Whether an official client exists, what it hides, and whether it is maintained
---

# Recipe: API integration

Adds the dimensions an integration lives or dies by, **on top of** the universal set.
Nothing here replaces access model, auth, rate limits, or legality - a recipe that
silently dropped legality would be worse than no recipe.
