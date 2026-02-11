export async function accountExists(
  account: string,
  horizon: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`${horizon}/accounts/${account}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) {
      return { ok: false, reason: "Account not found on-ledger" };
    }
    if (!res.ok) {
      return { ok: false, reason: `Horizon error ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || "Horizon lookup failed" };
  }
}
