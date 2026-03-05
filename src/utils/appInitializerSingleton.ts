import { validateEnvironmentOrThrow } from "./env-validation";
import { reportCriticalError } from "./monitoring";

let environmentValidated = false;
let unhandledRejectionListenerCount = 0;

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  console.error("[AppInit] Unhandled promise rejection:", event.reason);
  reportCriticalError({
    scope: "app-init.unhandledrejection",
    message: String((event.reason as Error)?.message ?? event.reason),
    metadata: {
      reasonType: typeof event.reason,
    },
    stack:
      typeof event.reason === "object" &&
      event.reason !== null &&
      "stack" in (event.reason as Record<string, unknown>)
        ? String((event.reason as Record<string, unknown>).stack ?? "")
        : undefined,
    timestamp: new Date().toISOString(),
  });
}

export function validateEnvironmentOnce() {
  if (environmentValidated) return;

  try {
    console.log("[AppInit] Validating environment configuration...");
    validateEnvironmentOrThrow();
    console.log("[AppInit] ✅ Environment validation passed");
    environmentValidated = true;
  } catch (error) {
    console.error("[AppInit] ❌ Environment validation failed:", error);
  }
}

export function attachUnhandledRejectionListener() {
  if (unhandledRejectionListenerCount === 0) {
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
  }
  unhandledRejectionListenerCount += 1;
}

export function detachUnhandledRejectionListener() {
  unhandledRejectionListenerCount = Math.max(
    0,
    unhandledRejectionListenerCount - 1,
  );

  if (unhandledRejectionListenerCount === 0) {
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  }
}
