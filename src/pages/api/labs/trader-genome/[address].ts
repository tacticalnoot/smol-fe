import type { APIRoute } from 'astro';

const HORIZON_URL = 'https://horizon.stellar.org';
const EXPERT_URL = 'https://api.stellar.expert/explorer/public';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const CACHE_TTL = 10 * 60 * 1000; // 10 min

const cache = new Map<string, { data: unknown; expires: number }>();

function isValidGAddress(addr: string): boolean {
  if (!addr || addr.length !== 56 || addr[0] !== 'G') return false;
  return /^[A-Z2-7]{56}$/.test(addr);
}

async function fetchJSON(url: string, timeoutMs = 12000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function paginateHorizon(baseUrl: string, maxPages = 5): Promise<unknown[]> {
  const all: unknown[] = [];
  let url = baseUrl;
  for (let p = 0; p < maxPages; p++) {
    try {
      const data = fetchedAs<HorizonPage>(await fetchJSON(url));
      const records = data._embedded?.records ?? [];
      all.push(...records);
      const next = data._links?.next?.href;
      if (!next || records.length < 200) break;
      url = next;
    } catch {
      break;
    }
  }
  return all;
}

// Typed helpers to avoid excessive casting
interface HorizonPage { _embedded?: { records: unknown[] }; _links?: { next?: { href: string } } }
function fetchedAs<T>(v: unknown): T { return v as T }

function assetKey(type: string, code?: string, issuer?: string): string {
  return type === 'native' ? 'XLM' : `${code}:${issuer ?? ''}`;
}
function assetLabel(type: string, code?: string): string {
  return type === 'native' ? 'XLM' : (code ?? 'UNKNOWN');
}

// FIFO lot tracking
interface Lot { amount: number; priceXLM: number; ts: number }
type Inventory = Record<string, Lot[]>;

function addLot(inv: Inventory, asset: string, amount: number, priceXLM: number, ts: number) {
  if (amount <= 0) return;
  if (!inv[asset]) inv[asset] = [];
  inv[asset].push({ amount, priceXLM, ts });
}

function consumeLots(inv: Inventory, asset: string, amount: number, salePriceXLM: number): { pnl: number; known: boolean } {
  const lots = inv[asset] ?? [];
  let remaining = amount;
  let pnl = 0;
  let known = false;
  while (remaining > 1e-7 && lots.length > 0) {
    const lot = lots[0];
    const used = Math.min(lot.amount, remaining);
    pnl += (salePriceXLM - lot.priceXLM) * used;
    known = true;
    lot.amount -= used;
    remaining -= used;
    if (lot.amount <= 1e-7) lots.shift();
  }
  return { pnl, known };
}

export const GET: APIRoute = async ({ params }) => {
  const address = (params.address ?? '').trim();
  if (!isValidGAddress(address)) {
    return json({ error: 'Invalid Stellar G-address' }, 400);
  }

  const cached = cache.get(address);
  if (cached && cached.expires > Date.now()) {
    return json(cached.data, 200, { 'X-Cache': 'HIT' });
  }

  try {
    // Kick off parallel fetches
    const [
      accountRes,
      xlmUsdRes,
      expertRes,
      tradesRes,
      paymentsRes,
      opsRes,
    ] = await Promise.allSettled([
      fetchJSON(`${HORIZON_URL}/accounts/${address}`),
      fetchJSON(`${HORIZON_URL}/trade_aggregations?base_asset_type=native&counter_asset_code=USDC&counter_asset_issuer=${USDC_ISSUER}&resolution=3600000&limit=1&order=desc`, 8000),
      fetchJSON(`${EXPERT_URL}/directory/${address}`).catch(() => null),
      paginateHorizon(`${HORIZON_URL}/accounts/${address}/trades?limit=200&order=asc`, 5),
      paginateHorizon(`${HORIZON_URL}/accounts/${address}/payments?limit=200&order=asc`, 3),
      paginateHorizon(`${HORIZON_URL}/accounts/${address}/operations?limit=200&order=desc`, 2),
    ]);

    if (accountRes.status === 'rejected') {
      const msg = String(accountRes.reason);
      if (msg.includes('404')) return json({ error: 'Account not found on Stellar network' }, 404);
      throw accountRes.reason;
    }

    const account = fetchedAs<Record<string, unknown>>(accountRes.value);
    const xlmUsdData = xlmUsdRes.status === 'fulfilled' ? fetchedAs<Record<string, unknown>>(xlmUsdRes.value) : null;
    const expert = expertRes.status === 'fulfilled' ? fetchedAs<Record<string, unknown>>(expertRes.value) : null;
    const trades = tradesRes.status === 'fulfilled' ? fetchedAs<Record<string, unknown>[]>(tradesRes.value) : [];
    const payments = paymentsRes.status === 'fulfilled' ? fetchedAs<Record<string, unknown>[]>(paymentsRes.value) : [];
    const operations = opsRes.status === 'fulfilled' ? fetchedAs<Record<string, unknown>[]>(opsRes.value) : [];

    // XLM/USD price
    const xlmUsdRecs = fetchedAs<Record<string, unknown>[]>(fetchedAs<Record<string, unknown>>(fetchedAs<Record<string, unknown>>(xlmUsdData)?._embedded)?.records ?? []);
    const xlmUsdPrice: number | null = xlmUsdRecs?.[0]?.close ? parseFloat(String(xlmUsdRecs[0].close)) : null;

    // Account creation timestamp
    let accountCreatedAt: string | null = null;
    try {
      const firstOp = fetchedAs<HorizonPage>(await fetchJSON(`${HORIZON_URL}/accounts/${address}/operations?limit=1&order=asc`, 6000));
      accountCreatedAt = fetchedAs<Record<string, unknown>>(firstOp._embedded?.records?.[0])?.created_at as string ?? null;
    } catch { /* best effort */ }

    const walletAgeDays = accountCreatedAt
      ? Math.floor((Date.now() - new Date(accountCreatedAt).getTime()) / 86400000)
      : null;

    // Balances
    const rawBalances = fetchedAs<Record<string, unknown>[]>(account.balances as unknown[] ?? []);
    const xlmBalRec = rawBalances.find((b) => b.asset_type === 'native');
    const xlmAmount = xlmBalRec ? parseFloat(String(xlmBalRec.balance)) : 0;
    let portfolioValueXLM = xlmAmount;

    const balanceItems = rawBalances.map((b) => ({
      asset: b.asset_type === 'native' ? 'XLM' : `${b.asset_code}:${b.asset_issuer}`,
      code: b.asset_type === 'native' ? 'XLM' : String(b.asset_code ?? ''),
      issuer: b.asset_type === 'native' ? null : String(b.asset_issuer ?? ''),
      balance: parseFloat(String(b.balance)),
      xlmValue: b.asset_type === 'native' ? parseFloat(String(b.balance)) : null as number | null,
      usdValue: null as number | null,
      priced: b.asset_type === 'native',
    }));

    // Price non-XLM assets
    const priceMap: Record<string, number> = {};
    const toPriceItems = balanceItems.filter((b) => b.code !== 'XLM' && b.balance > 0).slice(0, 8);
    const priceResults = await Promise.allSettled(
      toPriceItems.map(async (b) => {
        const codeLenSuffix = b.code.length <= 4 ? '4' : '12';
        const url = `${HORIZON_URL}/trade_aggregations?base_asset_type=credit_alphanum${codeLenSuffix}&base_asset_code=${b.code}&base_asset_issuer=${b.issuer}&counter_asset_type=native&resolution=86400000&limit=1&order=desc`;
        const data = fetchedAs<Record<string, unknown>>(await fetchJSON(url, 5000));
        const recs = fetchedAs<Record<string, unknown>[]>(fetchedAs<Record<string, unknown>>(data._embedded)?.records ?? []);
        const p = recs?.[0]?.close ? parseFloat(String(recs[0].close)) : null;
        return p ? { key: b.asset, priceXLM: p, xlmVal: b.balance * p } : null;
      })
    );
    for (const r of priceResults) {
      if (r.status === 'fulfilled' && r.value) {
        priceMap[r.value.key] = r.value.priceXLM;
        portfolioValueXLM += r.value.xlmVal;
      }
    }
    for (const b of balanceItems) {
      if (b.code !== 'XLM' && priceMap[b.asset] != null) {
        b.xlmValue = b.balance * priceMap[b.asset];
        b.usdValue = xlmUsdPrice ? b.xlmValue * xlmUsdPrice : null;
        b.priced = true;
      }
    }
    if (xlmUsdPrice) {
      const xlmItem = balanceItems.find((b) => b.code === 'XLM');
      if (xlmItem) xlmItem.usdValue = xlmAmount * xlmUsdPrice;
    }

    // ---- TRADE ANALYSIS ----
    const inv: Inventory = {};
    const pairCounts: Record<string, number> = {};
    const tradesByHour = new Array(24).fill(0);
    const tradesByDay = new Array(7).fill(0);
    let totalNotionalXLM = 0;
    let xlmFromTrades = 0;
    let xlmToTrades = 0;
    let realizedPnlXLM = 0;
    let winCount = 0;
    let lossCount = 0;
    let totalSaleCount = 0;
    let biggestFillXLM = 0;
    const tradeSizes: number[] = [];
    const holdTimes: number[] = [];
    const assetAcquiredTs: Record<string, number[]> = {};
    let bestTrade: Record<string, unknown> | null = null;
    let worstTrade: Record<string, unknown> | null = null;
    let bestPnl = -Infinity;
    let worstPnl = Infinity;

    for (const trade of trades) {
      const ts = new Date(String(trade.ledger_close_time)).getTime();
      tradesByHour[new Date(ts).getUTCHours()]++;
      tradesByDay[new Date(ts).getUTCDay()]++;

      const isBase = trade.base_account === address;
      const baseAmt = parseFloat(String(trade.base_amount));
      const counterAmt = parseFloat(String(trade.counter_amount));
      const baseAss = assetKey(String(trade.base_asset_type), String(trade.base_asset_code ?? ''), String(trade.base_asset_issuer ?? ''));
      const counterAss = assetKey(String(trade.counter_asset_type), String(trade.counter_asset_code ?? ''), String(trade.counter_asset_issuer ?? ''));
      const baseLabel = assetLabel(String(trade.base_asset_type), String(trade.base_asset_code ?? ''));
      const counterLabel = assetLabel(String(trade.counter_asset_type), String(trade.counter_asset_code ?? ''));

      const pairKey = `${baseLabel}/${counterLabel}`;
      pairCounts[pairKey] = (pairCounts[pairKey] ?? 0) + 1;

      // Wallet flow: base_account sends base_asset, receives counter_asset
      const [soldAsset, soldAmt, boughtAsset, boughtAmt] = isBase
        ? [baseAss, baseAmt, counterAss, counterAmt]
        : [counterAss, counterAmt, baseAss, baseAmt];

      if (soldAsset === 'XLM') xlmToTrades += soldAmt;
      if (boughtAsset === 'XLM') xlmFromTrades += boughtAmt;

      let notXLM = 0;
      if (soldAsset === 'XLM') notXLM = soldAmt;
      else if (boughtAsset === 'XLM') notXLM = boughtAmt;
      else if (priceMap[soldAsset]) notXLM = soldAmt * priceMap[soldAsset];
      else if (priceMap[boughtAsset]) notXLM = boughtAmt * priceMap[boughtAsset];

      totalNotionalXLM += notXLM;
      if (notXLM > biggestFillXLM) biggestFillXLM = notXLM;
      tradeSizes.push(notXLM);

      // FIFO PnL for XLM-paired trades
      if (soldAsset === 'XLM' && boughtAsset !== 'XLM') {
        const pricePerUnit = soldAmt / boughtAmt;
        addLot(inv, boughtAsset, boughtAmt, pricePerUnit, ts);
        if (!assetAcquiredTs[boughtAsset]) assetAcquiredTs[boughtAsset] = [];
        assetAcquiredTs[boughtAsset].push(ts);
      } else if (boughtAsset === 'XLM' && soldAsset !== 'XLM') {
        const salePriceXLM = boughtAmt / soldAmt;
        const { pnl, known } = consumeLots(inv, soldAsset, soldAmt, salePriceXLM);
        if (known) {
          realizedPnlXLM += pnl;
          totalSaleCount++;
          if (pnl > 0) winCount++;
          else lossCount++;
          const tradeSummary = { pair: pairKey, pnlXLM: pnl, timestamp: trade.ledger_close_time, notionalXLM: notXLM };
          if (pnl > bestPnl) { bestPnl = pnl; bestTrade = tradeSummary; }
          if (pnl < worstPnl) { worstPnl = pnl; worstTrade = tradeSummary; }
          const ats = assetAcquiredTs[soldAsset];
          if (ats?.length) {
            const acquireTs = ats.shift()!;
            holdTimes.push((ts - acquireTs) / 3600000);
          }
        }
      }
    }

    const netXlmFromTrading = xlmFromTrades - xlmToTrades;
    const sortedSizes = [...tradeSizes].sort((a, b) => a - b);
    const avgTradeXLM = tradeSizes.length ? tradeSizes.reduce((a, b) => a + b, 0) / tradeSizes.length : 0;
    const medianTradeXLM = sortedSizes.length ? sortedSizes[Math.floor(sortedSizes.length / 2)] : 0;
    const avgHoldHours = holdTimes.length ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;
    const winRate = totalSaleCount > 0 ? winCount / totalSaleCount : 0;
    const uniquePairsCount = Object.keys(pairCounts).length;
    const favoritePairs = Object.entries(pairCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([pair, count]) => ({ pair, count }));

    // ---- PAYMENT ANALYSIS ----
    let paymentsIn = 0;
    let paymentsOut = 0;
    let xlmReceivedFromPayments = 0;
    let xlmSentFromPayments = 0;
    let largestInbound = 0;
    let largestOutbound = 0;
    const counterpartySet = new Set<string>();

    for (const p of payments) {
      const amt = parseFloat(String(p.amount ?? '0'));
      if (p.type === 'payment') {
        if (p.to === address) {
          paymentsIn++;
          if (p.asset_type === 'native') xlmReceivedFromPayments += amt;
          if (amt > largestInbound) largestInbound = amt;
          if (p.from) counterpartySet.add(String(p.from));
        } else if (p.from === address) {
          paymentsOut++;
          if (p.asset_type === 'native') xlmSentFromPayments += amt;
          if (amt > largestOutbound) largestOutbound = amt;
          if (p.to) counterpartySet.add(String(p.to));
        }
      } else if (p.type === 'create_account') {
        const startBal = parseFloat(String(p.starting_balance ?? '0'));
        if (p.account === address) {
          paymentsIn++;
          xlmReceivedFromPayments += startBal;
          if (p.funder) counterpartySet.add(String(p.funder));
        } else if (p.funder === address) {
          paymentsOut++;
          xlmSentFromPayments += startBal;
          if (p.account) counterpartySet.add(String(p.account));
        }
      }
    }
    const netTransferXLM = xlmReceivedFromPayments - xlmSentFromPayments;

    // ---- OPERATIONS ANALYSIS ----
    let pathPayments = 0;
    let offersCreated = 0;
    let lpDeposits = 0;
    let lpWithdrawals = 0;
    for (const op of operations) {
      switch (op.type) {
        case 'path_payment_strict_receive':
        case 'path_payment_strict_send':
          pathPayments++;
          break;
        case 'manage_buy_offer':
        case 'manage_sell_offer':
        case 'create_passive_sell_offer':
          offersCreated++;
          break;
        case 'liquidity_pool_deposit':
          lpDeposits++;
          break;
        case 'liquidity_pool_withdraw':
          lpWithdrawals++;
          break;
      }
    }
    const totalFeesXLM = (trades.length + operations.length) * 0.00001;

    // ---- SCORES ----
    let convictionScore = 50;
    if (avgHoldHours > 0) {
      if (avgHoldHours < 1) convictionScore = 8;
      else if (avgHoldHours < 6) convictionScore = 22;
      else if (avgHoldHours < 24) convictionScore = 38;
      else if (avgHoldHours < 168) convictionScore = 56;
      else if (avgHoldHours < 720) convictionScore = 75;
      else convictionScore = 92;
    }

    const timespan = walletAgeDays ?? 365;
    const tradesPerDay = timespan > 0 ? trades.length / timespan : 0;
    const degeneracyScore = Math.min(
      Math.round(
        Math.min(trades.length / 50, 10) * 0.4 * 10 +
        Math.min(uniquePairsCount / 10, 10) * 0.3 * 10 +
        Math.min(tradesPerDay * 10, 10) * 0.3 * 10
      ),
      100
    );

    const totalOps = trades.length + paymentsIn + paymentsOut + 1;
    const lpFarmerScore = Math.min(Math.round(((lpDeposits + lpWithdrawals) / totalOps) * 500 + lpDeposits * 3), 100);
    const pathWizardScore = Math.min(Math.round((pathPayments / Math.max(trades.length, 1)) * 200), 100);

    let whaleScore = 0;
    if (totalNotionalXLM > 0) {
      whaleScore = Math.min(Math.round(Math.log10(totalNotionalXLM) * 12), 100);
    }

    const deadAssets = balanceItems.filter((b) => !b.priced && b.code !== 'XLM' && b.balance > 0).length;
    const coffinScore = Math.min(Math.round((deadAssets / Math.max(balanceItems.length, 1)) * 100), 100);

    const diamondHandsScore = Math.min(Math.round(convictionScore * 0.7 + Math.min(totalSaleCount > 0 ? (winCount / totalSaleCount) * 50 : 25, 30)), 100);

    const auraScore = Math.min(Math.round(
      whaleScore * 0.25 +
      (realizedPnlXLM > 0 ? 30 : realizedPnlXLM < 0 ? 5 : 15) +
      convictionScore * 0.15 +
      (winRate > 0.55 ? 25 : winRate > 0.45 ? 15 : 5) +
      Math.min(trades.length * 0.3, 15)
    ), 100);

    // ---- ARCHETYPE ----
    const directoryTags: string[] = (expert as Record<string, unknown[]> | null)?.tags?.map((t) =>
      typeof t === 'object' && t !== null ? String((t as Record<string, unknown>).name ?? t) : String(t)
    ) ?? [];
    const warnings: string[] = [];
    if (directoryTags.includes('malicious')) warnings.push('FLAGGED AS MALICIOUS BY STELLAR EXPERT');
    if (directoryTags.includes('unsafe')) warnings.push('MARKED UNSAFE BY STELLAR EXPERT');
    if (directoryTags.includes('memo-required')) warnings.push('MEMO REQUIRED FOR DEPOSITS');

    let archetype: string;
    let archetypeEmoji: string;

    if (directoryTags.includes('exchange') || directoryTags.includes('anchor')) {
      archetype = 'Exchange Mule'; archetypeEmoji = '🏦';
    } else if (xlmAmount > 100000 && trades.length < 50) {
      archetype = 'Sleeping Whale'; archetypeEmoji = '🐋';
    } else if (lpFarmerScore > 55) {
      archetype = 'LP Farmer'; archetypeEmoji = '🌾';
    } else if (pathWizardScore > 55) {
      archetype = 'Path Wizard'; archetypeEmoji = '🧙';
    } else if (degeneracyScore > 70) {
      archetype = 'Market Goblin'; archetypeEmoji = '👺';
    } else if (convictionScore > 75 && avgHoldHours > 168) {
      archetype = 'Diamond Hand'; archetypeEmoji = '💎';
    } else if (coffinScore > 40) {
      archetype = 'Airdrop Scavenger'; archetypeEmoji = '🪂';
    } else if (trades.length > 200 && uniquePairsCount <= 3) {
      archetype = 'XLM Swing Trader'; archetypeEmoji = '📈';
    } else if (trades.length < 10 && xlmAmount < 100) {
      archetype = 'Crypto Tourist'; archetypeEmoji = '🗺️';
    } else if (realizedPnlXLM > 5000) {
      archetype = 'Alpha Hunter'; archetypeEmoji = '🎯';
    } else if (realizedPnlXLM < -5000) {
      archetype = 'Bag Carrier'; archetypeEmoji = '🎒';
    } else {
      archetype = 'Stellar Citizen'; archetypeEmoji = '⭐';
    }

    const traits: string[] = [];
    if (winRate > 0.6 && totalSaleCount > 5) traits.push('Profitable Trader');
    if (avgHoldHours > 720) traits.push('Long-Term Holder');
    else if (avgHoldHours > 168) traits.push('Patient Investor');
    if (avgHoldHours > 0 && avgHoldHours < 2) traits.push('Scalper Tendencies');
    if (uniquePairsCount > 10) traits.push('Pair Explorer');
    if (pathPayments > 10) traits.push('DEX Router');
    if (lpDeposits > 5) traits.push('Liquidity Provider');
    if (coffinScore > 30) traits.push('Bag Holder');
    if (trades.length > 500) traits.push('High Volume');
    if (realizedPnlXLM > 1000) traits.push('Profitable (in XLM)');
    if (realizedPnlXLM < -1000) traits.push('Battle Scarred');
    if (counterpartySet.size > 100) traits.push('Well Connected');
    if (paymentsIn > paymentsOut * 3) traits.push('Net Receiver');
    if (paymentsOut > paymentsIn * 3) traits.push('Net Sender');

    const pnlConfidence = totalSaleCount > 0 ? Math.round((winCount + lossCount) / totalSaleCount * 100) : 0;

    const profile = {
      address,
      fetchedAt: new Date().toISOString(),
      dataCompleteness: {
        totalTrades: trades.length,
        tradesCapped: trades.length >= 1000,
        paymentsCapped: payments.length >= 600,
        pnlConfidence,
        xlmUsdPrice,
      },
      identity: {
        createdAt: accountCreatedAt,
        walletAgeDays,
        homeDomain: account.home_domain ?? null,
        directoryTags,
        warnings,
        signerCount: (account.signers as unknown[] | undefined)?.length ?? 1,
        trustlineCount: rawBalances.filter((b) => b.asset_type !== 'native').length,
        subentryCount: account.subentry_count ?? 0,
      },
      balances: balanceItems
        .sort((a, b) => (b.xlmValue ?? 0) - (a.xlmValue ?? 0))
        .slice(0, 20),
      headline: {
        portfolioValueXLM: r2(portfolioValueXLM),
        portfolioValueUSD: xlmUsdPrice ? r2(portfolioValueXLM * xlmUsdPrice) : null,
        lifetimeValueTradedXLM: r2(totalNotionalXLM),
        totalTrades: trades.length,
        netXlmFlow: r2(netTransferXLM + netXlmFromTrading),
        netXlmFromTrading: r2(netXlmFromTrading),
        netXlmFromTransfers: r2(netTransferXLM),
        feesSpentXLM: r5(totalFeesXLM),
        estimatedRealizedPnlXLM: r2(realizedPnlXLM),
        pnlConfidence,
      },
      activity: {
        paymentsIn,
        paymentsOut,
        counterpartyCount: counterpartySet.size,
        offersCreated,
        pathPayments,
        lpDeposits,
        lpWithdrawals,
        largestInboundXLM: r2(largestInbound),
        largestOutboundXLM: r2(largestOutbound),
      },
      trading: {
        favoritePairs,
        uniquePairsCount,
        bestTrade,
        worstTrade,
        avgHoldHours: Math.round(avgHoldHours * 10) / 10,
        winRatePct: Math.round(winRate * 1000) / 10,
        avgTradeXLM: r2(avgTradeXLM),
        medianTradeXLM: r2(medianTradeXLM),
        biggestFillXLM: r2(biggestFillXLM),
        totalSaleCount,
        wins: winCount,
        losses: lossCount,
        tradesByHour,
        tradesByDay,
      },
      scores: {
        conviction: convictionScore,
        degeneracy: degeneracyScore,
        lpFarmer: lpFarmerScore,
        pathWizard: pathWizardScore,
        diamondHands: diamondHandsScore,
        whale: whaleScore,
        coffinPortfolio: coffinScore,
        aura: auraScore,
      },
      narrative: {
        archetype,
        archetypeEmoji,
        traits,
        summary: buildSummary({ address, walletAgeDays, trades, totalNotionalXLM, favoritePairs, realizedPnlXLM, totalSaleCount }),
      },
    };

    cache.set(address, { data: profile, expires: Date.now() + CACHE_TTL });

    return json(profile, 200, { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=600' });
  } catch (err) {
    console.error('[TraderGenome]', err);
    return json({ error: 'Failed to build trader profile', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function r2(n: number) { return Math.round(n * 100) / 100; }
function r5(n: number) { return Math.round(n * 100000) / 100000; }

function json(data: unknown, status: number, extra?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function buildSummary({ address, walletAgeDays, trades, totalNotionalXLM, favoritePairs, realizedPnlXLM, totalSaleCount }: {
  address: string; walletAgeDays: number | null; trades: unknown[]; totalNotionalXLM: number;
  favoritePairs: { pair: string; count: number }[]; realizedPnlXLM: number; totalSaleCount: number;
}): string {
  const parts: string[] = [];
  parts.push(`${address.slice(0, 4)}…${address.slice(-4)} has been active for ${walletAgeDays != null ? `${walletAgeDays} days` : 'an unknown period'}`);
  if (trades.length > 0) parts.push(`executed ${trades.length.toLocaleString()} trades`);
  if (totalNotionalXLM > 0) parts.push(`moved ${Math.round(totalNotionalXLM).toLocaleString()} XLM in total notional`);
  if (favoritePairs.length > 0) parts.push(`preferring the ${favoritePairs[0].pair} pair`);
  if (realizedPnlXLM !== 0 && totalSaleCount > 0) {
    const sign = realizedPnlXLM > 0 ? '+' : '';
    parts.push(`with estimated realized P&L of ${sign}${Math.round(realizedPnlXLM).toLocaleString()} XLM on tracked positions`);
  }
  return parts.join(', ') + '.';
}
