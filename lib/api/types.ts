/**
 * Types for the public BulbaStore API (`/upstream/api/v1`).
 *
 * Shapes are transcribed from the upstream reference AND verified against live
 * responses — the live API returns several fields the docs omit (`stackAmount`,
 * `standalone`, `makerMid`, `fee` on fills, `borrowed` on balances, the bank
 * relations on fills). Where the two disagree, the live response wins.
 */

/** An enchant or effect that defines an item variant. */
export type NbtEntry = {
  type: "enchant" | "effect";
  name: string;
  level: number;
};

/**
 * The variant fields every item-bearing endpoint shares. `variantId` is the
 * only safe equality check — names are renamable.
 */
export type VariantFields = {
  variantId: number | null;
  itemName: string | null;
  variantName: string | null;
  listingName: string | null;
  /** Low-demand variant (odd enchant combos); hidden from default views. */
  niche: boolean;
  nbt: NbtEntry[];
  /** Units per Minecraft stack. Undocumented but always present. */
  stackAmount?: number;
  defaultAmount?: number;
  standalone?: boolean;
};

export type Listing = VariantFields & {
  id: number;
  isActive: boolean;
  lendingEnabled?: boolean;
  lendingMinValue?: number | null;
};

/** Row of `GET /orderbook` — one per active listing, in a single call. */
export type OrderbookSummary = VariantFields & {
  listingId: number;
  mid: number | null;
  /** Mid computed from maker orders only; null when no maker quotes rest. */
  makerMid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
};

export type BookOrder = {
  username: string;
  uuid: string;
  amount: number;
  createdAt: string;
  expiresAt: string | null;
};

export type BookLevel = {
  price: number;
  quantity: number;
  side: "bid" | "ask";
  tick?: number;
  /** Only present with `includePlayers=true`. */
  orders?: BookOrder[];
};

export type OrderBook = {
  /** Always computed from the full book, even when `depth` truncates levels. */
  mid: number | null;
  spread?: number | null;
  bids: BookLevel[];
  asks: BookLevel[];
};

export type OrderbookDetail = {
  listing: Listing;
  orderBook: OrderBook;
};

export type OrderbookView = OrderbookDetail & {
  trades: Fill[];
};

export type Candle = {
  /** ISO 8601 bucket start; candles are ascending by time. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
};

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type PriceQuote = {
  listingId: number;
  side: "buy" | "sell";
  requestedAmount: number;
  availableAmount: number;
  totalCost: number;
  avgPrice: number | null;
  fills: { price: number; amount: number }[];
  fullyFillable: boolean;
};

export type PlayerRef = {
  id: number;
  uuid: string;
  username: string;
};

export type TransactionType =
  | "physical_market_buy"
  | "physical_market_sell"
  | "storage_market_buy"
  | "storage_market_sell"
  | "storage_limit_buy"
  | "storage_limit_sell"
  | "deposit"
  | "withdraw"
  | "transfer"
  | "pay";

/** The six types `GET /transactions` returns by default — actual trades. */
export const TRADE_TYPES: TransactionType[] = [
  "physical_market_buy",
  "physical_market_sell",
  "storage_market_buy",
  "storage_market_sell",
  "storage_limit_buy",
  "storage_limit_sell",
];

/** Internal bank movements, hidden from `/transactions` unless requested. */
export const BANK_TYPES: TransactionType[] = [
  "deposit",
  "withdraw",
  "transfer",
  "pay",
];

export type OrderStatus =
  | "pending"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "expired";

export type ListingRef = {
  id: number;
  itemName: string | null;
  variantName: string | null;
  nbt: NbtEntry[];
};

export type BankRef = {
  id: number;
  name: string;
  isPersonal?: boolean;
  owner?: string;
};

/** A row of `GET /transactions?view=fills` — one per Transaction record. */
export type Fill = {
  id: number;
  type: TransactionType;
  /** Derived server-side from `type`. */
  kind: "trade" | "bank";
  venue: "physical" | "storage" | null;
  mechanism: "market" | "limit" | null;
  side: "buy" | "sell" | null;
  status: string;
  amount: number;
  pricePerUnit: number | null;
  totalPrice: number | null;
  limitPrice: number | null;
  createdAt: string;
  completedAt: string | null;
  /** Undocumented; 0 on maker fills, the taker fee on aggregate rows. */
  fee?: number;
  listing: ListingRef | null;
  item?: VariantFields | null;
  player: PlayerRef | null;
  /** Taker on maker fills; recipient on `pay`. */
  counterparty: PlayerRef | null;
  fromBankAccount?: BankRef | null;
  toBankAccount?: BankRef | null;
  playerBankAccount?: BankRef | null;
  limitOrderId?: number | null;
  /** Links a maker fill to the taker's aggregate transaction. */
  parentTransactionId?: number | null;
  isMaker: boolean | null;
};

export type TradeMaker = {
  orderId: number;
  fillAmount: number;
  price: number;
  playerId: number;
  username: string;
  uuid: string;
};

/** A row of `GET /transactions?view=trades` — one per taker action. */
export type Trade = {
  id: number;
  status: string;
  side: "buy" | "sell";
  venue: "physical" | "storage";
  mechanism: "market" | "limit";
  filledAmount: number;
  /** Base price, pre-fee. */
  avgPrice: number;
  /** Base total, pre-fee; the 4% taker fee is in `fee`. */
  total: number;
  fee: number;
  createdAt: string;
  completedAt: string | null;
  listing: ListingRef | null;
  taker: PlayerRef | null;
  makers: TradeMaker[];
};

export type LimitOrder = {
  id: number;
  side: "buy" | "sell";
  status: OrderStatus;
  limitPrice: number;
  originalAmount: number;
  filledAmount: number;
  remainingAmount: number;
  expiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
  listing: ListingRef | null;
  player: PlayerRef | null;
  bankAccount: BankRef | null;
};

export type Balance = VariantFields & {
  /** All units held, free or locked. */
  total: number;
  /** Locked in pending limit orders. */
  reserved: number;
  /** Pinned by an in-flight trade-window trade. */
  physicalHold?: number;
  borrowed?: number;
  /** `total - reserved - physicalHold`; what a new order can spend. */
  available: number;
};

export type BankAccount = {
  id: number;
  name: string;
  isPersonal: boolean;
  allowsExternalPayments?: boolean;
  isOwner?: boolean;
  owner?: { uuid: string; username: string } | null;
  members?: {
    uuid: string;
    username: string;
    isOwner: boolean;
    joinedAt: string;
  }[];
  bots?: unknown[];
  balances: Balance[];
};

export type Player = {
  id: number;
  uuid: string;
  username: string;
  coreLevel: number | null;
  lastSeenAt: string | null;
  createdAt: string;
  /** Bank `/usebank` points at; null means the personal bank. */
  selectedBankAccountId: number | null;
  bankAccounts: BankAccount[];
  pendingBankInvites?: unknown[];
};

export type TreasuryPool = {
  id: number;
  kind: "revenue" | "stock" | "reserve" | string;
  name: string;
  /** Share of each distribution, in basis points. */
  sharePctBps: number;
  maxBalance: number | null;
  isActive: boolean;
  sortOrder: number;
  bankAccountId: number;
  bankName: string;
  balance: number;
  fillPct: number | null;
};

export type Treasury = {
  pools: TreasuryPool[];
  schedule: {
    lastRunAt: string | null;
    intervalHours: number;
    nextRunAt: string | null;
  } | null;
  stock: {
    itemVariantId: number;
    listingId: number;
    name: string;
    sharesOutstanding: number;
    holdersCount: number;
    /** Shares the treasury itself holds; float = outstanding - treasury. */
    treasuryShares: number;
  } | null;
};

/** A day of fee revenue. Keys are absent, not zero, on days with no revenue. */
export type TreasuryRevenueDay = {
  day: string;
  physical_fees?: number;
  storage_fees?: number;
};

export type TreasuryDistribution = {
  id: number;
  totalAmount: number;
  stockAmount: number;
  otherAmount: number;
  reserveAmount: number;
  trigger: string;
  createdAt: string;
  entries: {
    poolId: number;
    poolName: string;
    poolKind: string;
    allocated: number;
    credited: number;
    overflow: number;
  }[];
};

export type CommandArg = {
  name: string;
  description: string;
  required: boolean;
  type: string;
  format?: string;
};

export type BotCommand = {
  name: string;
  description: string;
  aliases: string[];
  accessLevel: "info" | "manage" | string;
  usage: string;
  args: CommandArg[];
};

export type CommandsDoc = {
  botName: string;
  commands: BotCommand[];
};

export type ApiDoc = {
  slug: string;
  title: string;
  markdown: string;
  updatedAt: string;
};
