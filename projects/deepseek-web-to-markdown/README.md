# DeepSeek Web to Markdown

A clean-room, local-first implementation of a web-to-Markdown workspace inspired by the publicly observable workflow of [DeepSeek 网页转 Markdown](https://deepseek2md.aichris.cc/). This repository contains its own source code and does not copy the original site's private implementation or assets. It is an independent project and is not affiliated with DeepSeek or WiseMindAI.

## Features

- Batch capture: paste one HTTP(S) URL per line, deduplicate input, run requests sequentially, and stop an active batch.
- DeepSeek Fetch API settings: configure the API key, endpoint, and request interval; optionally test the account balance endpoint.
- Local-first storage: articles are saved in browser IndexedDB and restored after refresh. The API key and settings are stored in browser `localStorage`.
- Markdown workspace: edit the title and source, preview changes immediately, and switch between split, edit-only, and preview-only layouts.
- Export: download the current `.md`, trigger one download per saved article, or package the library into a ZIP archive.
- Responsive UI: desktop split workspace and mobile-friendly layout.
- Sanitized preview: Markdown is rendered with `marked` and sanitized with DOMPurify before display.

## Requirements

- Node.js 20+ (Node.js 22 recommended)
- A DeepSeek API key with access to the Fetch endpoint

## Local development

```bash
npm install
npm run dev
```

Vite starts at `http://localhost:4173`.

## Build and preview

```bash
npm run typecheck
npm run build
npm run preview
```

The static site is generated in `dist/` and can be hosted by any static web server.

## API configuration

The default endpoint is:

```text
https://api.deepseek.com/v1/tools/fetch
```

The app sends a `POST` request with a JSON body such as `{ "url": "https://example.com/article" }` and an `Authorization: Bearer ...` header. The response parser accepts common `title` and Markdown/content fields and reports an error if no usable body is returned.

Some browsers or API environments may block direct browser requests because of CORS. In that case, use an API endpoint or local proxy you trust and control. The app does not ship with a hosted proxy or transmit your key to a project-owned server. If you configure a third-party proxy, that proxy will receive the request and should be treated as trusted infrastructure.

## Privacy and storage

- The API key and endpoint settings are saved in this browser's `localStorage`.
- Captured articles are stored in this browser's IndexedDB.
- Clearing the browser's site data removes these local settings and saved articles.
- Fetch API calls may incur usage charges. Review your account's current pricing and quota before processing large batches.
- Do not use this app to access pages or content you are not authorized to retrieve.

## Project structure

```text
src/
  App.tsx             Main workspace UI and interactions
  main.tsx            React entry point
  styles.css          Responsive UI styles
  lib/
    db.ts             IndexedDB persistence
    deepseek.ts       Fetch API and balance requests
    download.ts       Markdown and ZIP exports
```

## License

MIT. See [LICENSE](./LICENSE).
