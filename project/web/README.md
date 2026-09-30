# React + TypeScript + Vite + shadcn/ui

This is a template for a new Vite project with React, TypeScript, and shadcn/ui.

## Development Server

Always start the frontend with the project launcher:

```bash
cd <repo-root>
./alive.sh dev
```

It starts Vite on `0.0.0.0:18009` and the Go backend (rebuilt from source) on `0.0.0.0:8080`. Open `http://localhost:18009` locally, or use the machine's LAN address with port `18009` from another device. To run Vite alone, use `project/web/scripts/dev.sh`.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `src/components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```
