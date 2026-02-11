export async function isPreCutoff(
  account: string,
  cutoffIso: string,
  horizon: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(
      `${horizon}/accounts/${account}/effects?limit=1&order=asc`,
      { headers: { Accept: "application/json" } }
    );
    if (res.status === 404) {
      return { ok: false, reason: "Account not found on-ledger" };
    }
    if (!res.ok) {
      return { ok: false, reason: `Horizon error ${res.status}` };
    }
    const json = await res.json();
    const record = json?._embedded?.records?.[0];
    if (!record?.created_at) {
      return { ok: false, reason: "Could not determine creation time" };
    }
    const created = Date.parse(record.created_at);
    const cutoff = Date.parse(cutoffIso);
    if (Number.isNaN(created) || Number.isNaN(cutoff)) {
      return { ok: false, reason: "Invalid cutoff or created_at timestamp" };
    }
    if (created < cutoff) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `Account created at ${record.created_at} which is after cutoff ${cutoffIso}`,
    };
  } catch (err: any) {
    return { ok: false, reason: err?.message || "Cutoff check failed" };
  }
}
