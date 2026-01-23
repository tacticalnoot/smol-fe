# Testing Guide

## Unit / Regression Tests
The project uses `node --test` for lightweight unit and regression testing.

### Running Tests
```bash
pnpm test
```

## E2E Tests (Playwright)
We use Playwright for End-to-End testing of critical user flows ("Gold Paths").

### Prerequisites
1. Install Playwright browsers:
   ```bash
   pnpm exec playwright install
   ```
2. Start the dev server in a separate terminal:
   ```bash
   pnpm dev
   ```

### Running E2E Tests
```bash
pnpm exec playwright test
```

### Debugging
Run tests with UI mode to inspect failures:
```bash
pnpm exec playwright test --ui
```
