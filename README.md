# Fetch Markdown

## Purpose
This script is designed to fetch the content of one or more URLs, with special handling for Reddit, and convert it into a clean Markdown format. It is useful for extracting content for LLM processing.

## Approach
The script uses **Playwright** to launch a headless Chromium browser instance, and opens the target URLs concurrently (controlled by `p-limit`).

It scrolls the page to trigger lazy-loaded content, and cleans the DOM, removing scripts, styles, ads, navigation bars, and other non-content elements before conversion. It uses `html-to-md` to convert the cleaned HTML body into Markdown.

If the URL is from Reddit, it performs specialized actions to expand "View more comments" buttons and nested replies to capture the full discussion.

## Dependency Installation
To run this script, you need to install the required Node.js dependencies:

```bash
npm install commander playwright clipboardy html-to-md p-limit
```

## General Usage

### CLI Arguments
You can pass one or more URLs directly as arguments:

```bash
./fetch_markdown.mjs https://example.com https://google.com
```

### Interactive Mode
If no URLs are provided, the script runs in interactive mode. You can enter URLs (one per line) and press `Ctrl+D` when finished:

```bash
./fetch_markdown.mjs
```

### Options
- `-o, --output <file>`: Specify output file (default: `~/Downloads/markdown_TIMESTAMP.md`)
- `-c, --clipboard`: Copy results to clipboard automatically
- `-p, --parallel <number>`: Max parallel pages (default: 5)

## Raycast Script Command Setup
You can run this script directly from [Raycast](https://raycast.com/) to quickly fetch markdown from URLs in your clipboard or by entering them manually.

### Instructions
1.  **Prerequisites**: Ensure you have Node.js installed.
2.  **Script Location**: Place `fetch_markdown.mjs` in your script commands directory.
3.  **Permissions**: Ensure the script is executable:
    ```bash
    chmod +x fetch_markdown.mjs
    ```
4.  **Raycast Configuration**:
    - The script includes Raycast metadata headers.
    - **Argument**: `URLs (space separated)` (Optional).
    - If no argument is provided, it will attempt to read URLs from your clipboard.
    - **Output**: The script is set to `@raycast.mode fullOutput`, so standard output will be displayed in a Raycast window.

### Usage in Raycast
- **From Clipboard**: Copy one or more URLs, open Raycast, and run "Fetch Markdown".
- **Manual Input**: Open Raycast, run "Fetch Markdown", and type the URLs separated by spaces.
