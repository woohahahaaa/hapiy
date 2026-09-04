# React + TypeScript + Vite + shadcn/ui

This is a template for a new Vite project with React, TypeScript, and shadcn/ui.

## Development Server

Always start the frontend with the project launcher:

```bash
./start.sh
```

It runs Vite on `0.0.0.0:18009`. Open `http://localhost:18009` locally, or use the machine's LAN address with port `18009` from another device.

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
