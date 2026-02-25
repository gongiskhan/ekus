# Web Search & Research

Research topics, find information, and compile results.

## Methods

### 1. WebFetch (for known URLs)
```bash
curl -s "https://example.com" | head -100
```

### 2. Browser Search (for research)
Use the browser skill to:
1. Navigate to Google/DuckDuckGo
2. Search for the query
3. Extract relevant results
4. Follow links for deeper research

### 3. API Search (if configured)
If Brave Search API key is in `.env`:
```bash
curl -s "https://api.search.brave.com/res/v1/web/search?q=query" \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_API_KEY"
```

## Research Pattern

For any research task:
1. **Define what you're looking for** — be specific
2. **Search broadly** — 2-3 different queries
3. **Verify across sources** — don't trust a single result
4. **Summarize findings** — bullet points, not essays
5. **Cite sources** — include URLs

## Best Practices

- Start broad, narrow down
- Cross-reference important facts
- Note when information might be outdated
- For Portuguese content, search in Portuguese
