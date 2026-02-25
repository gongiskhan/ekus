# Browser Automation

Control web browsers to navigate, click, fill forms, take screenshots, and extract data.

## Tool Priority

### 1. Claude for Chrome (preferred)
Use the Chrome extension MCP tools when available:
```
mcp__claude-in-chrome__navigate_to_url
mcp__claude-in-chrome__get_page_content
mcp__claude-in-chrome__click_element
mcp__claude-in-chrome__fill_input
mcp__claude-in-chrome__take_screenshot
mcp__claude-in-chrome__execute_javascript
```

### 2. agent-browser CLI (fallback)
When Chrome extension is unavailable:
```bash
agent-browser open <url>          # Navigate to URL
agent-browser snapshot -i         # Get interactive elements with refs
agent-browser click @e1           # Click element by ref
agent-browser fill @e2 "text"     # Fill input field
agent-browser screenshot          # Take screenshot
agent-browser close               # Close browser
```

Install: `npm install -g agent-browser`

## Best Practices

- **Always take screenshots** after important actions to verify state
- **Wait for page loads** — check for expected elements before proceeding
- **Handle cookie banners** — dismiss them before interacting with page content
- **Login flows** — fill credentials one field at a time, verify each step
- **Forms** — fill all required fields before submitting
- **Never store passwords in screenshots** — crop or redact sensitive info

## Common Patterns

### Login to a site
1. Navigate to login page
2. Dismiss cookie banner if present
3. Fill username/email field
4. Fill password field
5. Click submit/login button
6. Verify successful login (check for dashboard, user menu, etc.)

### Extract data from a page
1. Navigate to page
2. Get page content/snapshot
3. Parse relevant data
4. Save to file if needed

### Fill and submit a form
1. Navigate to form page
2. Get interactive elements
3. Fill each field in order
4. Review before submitting (screenshot)
5. Submit
6. Verify success
