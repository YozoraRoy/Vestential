import Database from 'better-sqlite3'
import sql from 'mssql'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIGRATIONS } from './generated/migrations.js'
import { SEED_TRADES, SEED_GIFTS } from './seed-data.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const DB_PATH = process.env.DATABASE_PATH || join(DATA_DIR, 'stock.db')

// ─── Backend detection ───────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL || ''
const isAzureSql = DATABASE_URL.length > 0

// ─── SQLite (local) ──────────────────────────────────────────────
let _db: Database.Database | null = null
let _dbFailed = false

// ─── Azure SQL (cloud) ───────────────────────────────────────────
let _pool: sql.ConnectionPool | null = null
let _poolFailed = false

// ─── Shared state ────────────────────────────────────────────────
let _giftsSeeded = false
let _oddLotSeeded = false
const memoryStore: AnalysisRecord[] = []
let memoryIdCounter = 1
const portfolioMemoryStore: PortfolioRecord[] = []
let portfolioMemoryIdCounter = 1
// Issue #35：TWSE 除息快取記憶體兜底（SQLite/Azure 皆不可用時；僅程序生命週期內有效）。
const twseDividendMemoryStore: TwseDividendRow[] = []

// ─── SQLite connection ───────────────────────────────────────────
function getSqliteDb(): Database.Database | null {
  if (_db) return _db
  if (_dbFailed) return null

  try {
    const dbDir = dirname(DB_PATH)
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')

    _db.exec(`
      CREATE TABLE IF NOT EXISTS odd_lot_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        stock_id TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        price REAL,
        volume INTEGER,
        bid_price REAL,
        bid_volume INTEGER,
        ask_price REAL,
        ask_volume INTEGER,
        UNIQUE(date, stock_id)
      );
      CREATE TABLE IF NOT EXISTS shareholder_gifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        meeting_date TEXT,
        last_buy_date TEXT,
        gift_name TEXT,
        gift_status TEXT,
        claim_rule TEXT,
        claim_rule_source TEXT,
        mops_gift_text TEXT,
        mops_meeting_date TEXT,
        mops_source_url TEXT,
        mops_updated_at TEXT,
        distribution_method TEXT,
        distribution_location TEXT,
        source_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(stock_id, meeting_date)
      );
    `)

    let countRow: { cnt: number } | undefined
    try {
      countRow = _db.prepare("SELECT count(*) as cnt FROM odd_lot_trades").get() as { cnt: number }
    } catch (_) {}

    if (!countRow || countRow.cnt < 50) {
      console.log(`[SQLite] Auto populating ${SEED_TRADES.length} trades and ${SEED_GIFTS.length} gifts...`)

      const insertTrade = _db.prepare(`
        INSERT OR REPLACE INTO odd_lot_trades (date, stock_id, stock_name, price, volume, bid_price, bid_volume, ask_price, ask_volume)
        VALUES (@date, @stock_id, @stock_name, @price, @volume, @bid_price, @bid_volume, @ask_price, @ask_volume)
      `)
      const insertGift = _db.prepare(`
        INSERT OR REPLACE INTO shareholder_gifts (stock_id, stock_name, meeting_date, last_buy_date, gift_name, distribution_method, distribution_location, source_url)
        VALUES (@stock_id, @stock_name, @meeting_date, @last_buy_date, @gift_name, @distribution_method, @distribution_location, @source_url)
      `)

      const populateTx = _db.transaction(() => {
        for (const trade of SEED_TRADES) insertTrade.run(trade)
        for (const gift of SEED_GIFTS) insertGift.run(gift)
      })
      populateTx()

      const checkCount = _db.prepare("SELECT count(*) as cnt FROM odd_lot_trades").get() as { cnt: number }
      console.log(`[SQLite] Seeded! Total trades: ${checkCount?.cnt || 0}`)
    }

    _db.exec(`
      CREATE TABLE IF NOT EXISTS historical_shareholder_gifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id TEXT NOT NULL,
        stock_name TEXT,
        year INTEGER NOT NULL,
        gift_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(stock_id, year)
      );
      CREATE TABLE IF NOT EXISTS analysis_records (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker               TEXT    NOT NULL,
        recommendation       TEXT    NOT NULL,
        summary              TEXT,
        full_report_json     TEXT    NOT NULL,
        model_usage          TEXT,
        primary_models       TEXT,
        fallback_used        TEXT,
        fallback_count       INTEGER DEFAULT 0,
        created_at           TEXT    DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_ticker ON analysis_records(ticker);
      CREATE INDEX IF NOT EXISTS idx_analysis_created ON analysis_records(created_at);
      CREATE INDEX IF NOT EXISTS idx_historical_gifts_stock ON historical_shareholder_gifts(stock_id);
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        display_name TEXT,
        avatar_url TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS user_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        provider_email TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(provider, provider_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);
      CREATE TABLE IF NOT EXISTS api_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        usage_date TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        UNIQUE(user_id, usage_date)
      );
      CREATE INDEX IF NOT EXISTS idx_api_usage_user ON api_usage(user_id);
      CREATE TABLE IF NOT EXISTS recognition_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        usage_date TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        UNIQUE(user_id, usage_date)
      );
      CREATE INDEX IF NOT EXISTS idx_recognition_usage_user ON recognition_usage(user_id);
      CREATE TABLE IF NOT EXISTS placement_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        symbol TEXT,
        user_id INTEGER,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_placement_event ON placement_events(event, created_at);
      CREATE INDEX IF NOT EXISTS idx_placement_user ON placement_events(user_id);
      CREATE TABLE IF NOT EXISTS portfolio_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        guest_uid TEXT,
        market TEXT NOT NULL,
        symbol TEXT NOT NULL,
        symbol_name TEXT,
        shares REAL NOT NULL,
        cost REAL NOT NULL,
        current_price REAL NOT NULL,
        dividend REAL NOT NULL,
        cost_basis REAL NOT NULL,
        market_value REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        unrealized_pnl_pct REAL NOT NULL,
        total_return REAL NOT NULL,
        total_return_pct REAL NOT NULL,
        yield_on_cost REAL NOT NULL,
        strategy TEXT,
        recommendation TEXT,
        summary TEXT,
        report_json TEXT,
        price_synced_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio_records(user_id, id);
      CREATE TABLE IF NOT EXISTS claim_codes (
        code_hash TEXT PRIMARY KEY,
        guest_uid TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_claim_guest ON claim_codes(guest_uid);
      CREATE TABLE IF NOT EXISTS market_focus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT,
        published_at TEXT,
        reason TEXT,
        summary TEXT,
        content TEXT,
        source_url TEXT,
        impact_direction TEXT,
        scope TEXT,
        horizon TEXT,
        affected_sectors TEXT,
        action TEXT,
        related_symbols TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_market_focus_created ON market_focus(created_at);
      CREATE TABLE IF NOT EXISTS market_focus_meta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL,
        generated_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS market_focus_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        level TEXT NOT NULL,
        code TEXT,
        job_id TEXT,
        edition_key TEXT,
        message TEXT NOT NULL,
        detail TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_mf_logs_created ON market_focus_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_mf_logs_source ON market_focus_logs(source);
      CREATE TABLE IF NOT EXISTS arena_seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'registration',
        start_date TEXT,
        end_date TEXT,
        registration_start TEXT,
        registration_end TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_arena_season_status ON arena_seasons(status);
      CREATE TABLE IF NOT EXISTS arena_agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id INTEGER NOT NULL,
        owner_user_id INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        division TEXT NOT NULL DEFAULT 'season',
        strategy_id TEXT NOT NULL,
        tone TEXT NOT NULL DEFAULT 'neutral',
        initial_capital REAL NOT NULL DEFAULT 500000,
        cash REAL NOT NULL DEFAULT 500000,
        status TEXT NOT NULL DEFAULT 'active',
        is_system INTEGER NOT NULL DEFAULT 0,
        joined_at TEXT,
        adjust_count INTEGER NOT NULL DEFAULT 0,
        last_round_date TEXT,
        reset_note TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_arena_agent_owner ON arena_agents(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_arena_agent_season ON arena_agents(season_id, status);
      CREATE TABLE IF NOT EXISTS arena_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        symbol_name TEXT,
        shares REAL NOT NULL DEFAULT 0,
        avg_cost REAL NOT NULL DEFAULT 0,
        updated_round_date TEXT,
        UNIQUE(agent_id, symbol)
      );
      CREATE INDEX IF NOT EXISTS idx_arena_holding_agent ON arena_holdings(agent_id);
      CREATE TABLE IF NOT EXISTS arena_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL,
        round_date TEXT NOT NULL,
        action TEXT NOT NULL,
        symbol TEXT,
        symbol_name TEXT,
        shares REAL,
        price REAL,
        fee REAL,
        tax REAL,
        reason TEXT,
        model TEXT,
        fallback_used INTEGER DEFAULT 0,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_arena_trade_agent ON arena_trades(agent_id, round_date);
      CREATE TABLE IF NOT EXISTS arena_equity_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL,
        season_id INTEGER NOT NULL,
        round_date TEXT NOT NULL,
        cash REAL NOT NULL,
        equity REAL NOT NULL,
        return_pct REAL NOT NULL DEFAULT 0,
        UNIQUE(agent_id, round_date)
      );
      CREATE INDEX IF NOT EXISTS idx_arena_snapshot_agent ON arena_equity_snapshots(agent_id, round_date);

      UPDATE odd_lot_trades SET price = 34.15, volume = 19443, bid_price = 34.15, bid_volume = 8943, ask_price = 34.20, ask_volume = 6092 WHERE stock_id = '2887';
      UPDATE shareholder_gifts SET gift_name = '多用途矽膠隔熱餐墊(二入)', last_buy_date = '08/14' WHERE stock_id = '2887';
      UPDATE odd_lot_trades SET price = COALESCE(NULLIF(price, 0), bid_price, ask_price, 50.0) WHERE price IS NULL OR price <= 0;
      UPDATE odd_lot_trades SET price = bid_price WHERE price > 4000 AND stock_id NOT IN ('3008', '5274', '6669', '3661') AND bid_price > 0 AND bid_price < 2000;
    `)

    // 既有 portfolio_records 表補上 guest_uid（冪等；全新 DB 的 column 已存在時 ALTER 會拋錯，故獨立 try/catch）。
    try {
      _db.exec('ALTER TABLE portfolio_records ADD COLUMN guest_uid TEXT;')
    } catch {}
    // Issue #33：現價同步時間戳（冪等；migration 025 亦 covering，既有庫走任一條都可）。
    try {
      _db.exec('ALTER TABLE portfolio_records ADD COLUMN price_synced_at TEXT;')
    } catch {}
    try {
      _db.exec('CREATE INDEX IF NOT EXISTS idx_portfolio_guest ON portfolio_records(guest_uid, id)')
    } catch {}
    try {
      _db.exec('ALTER TABLE market_focus ADD COLUMN summary TEXT;')
    } catch {}
    // Issue #19 新聞影響結構化欄位（冪等；全新 DB 欄位已存在時 ALTER 會拋錯，故獨立 try/catch）。
    for (const col of [
      'impact_direction TEXT',
      'scope TEXT',
      'horizon TEXT',
      'affected_sectors TEXT',
      'action TEXT',
      'related_symbols TEXT',
    ]) {
      try {
        _db.exec(`ALTER TABLE market_focus ADD COLUMN ${col};`)
      } catch {}
    }

    // 既有 arena_agents 表補齊較晚期加入的欄位（冪等；全新 DB 欄位已存在時 ALTER 會拋錯，故獨立 try/catch）。
    try {
      _db.exec('ALTER TABLE arena_agents ADD COLUMN cash REAL NOT NULL DEFAULT 500000;')
    } catch {}
    try {
      _db.exec('ALTER TABLE arena_agents ADD COLUMN adjust_count INTEGER NOT NULL DEFAULT 0;')
    } catch {}
    try {
      _db.exec('ALTER TABLE arena_agents ADD COLUMN last_round_date TEXT;')
    } catch {}
    try {
      _db.exec('ALTER TABLE arena_agents ADD COLUMN reset_note TEXT;')
    } catch {}
    try {
      _db.exec('ALTER TABLE arena_agents ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;')
    } catch {}
    try {
      _db.exec('ALTER TABLE arena_agents ADD COLUMN personality TEXT;')
    } catch {}
    try {
      _db.exec('ALTER TABLE arena_agents ADD COLUMN strategy_params TEXT;')
    } catch {}
    try {
      _db.exec('ALTER TABLE arena_trades ADD COLUMN slot INTEGER;')
    } catch {}

    _db.exec(`
      CREATE TABLE IF NOT EXISTS arena_intraday_prices (
        round_date TEXT NOT NULL,
        symbol TEXT NOT NULL,
        slot INTEGER NOT NULL,
        time_label TEXT,
        price REAL NOT NULL,
        change_pct REAL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (round_date, symbol, slot)
      );
      CREATE INDEX IF NOT EXISTS idx_arena_intraday_date ON arena_intraday_prices(round_date);

      CREATE TABLE IF NOT EXISTS arena_market_briefings (
        round_date TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        model TEXT,
        fallback_used INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS arena_decision_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL,
        season_id INTEGER,
        round_date TEXT NOT NULL,
        phase TEXT NOT NULL,
        slot INTEGER,
        content TEXT NOT NULL,
        model TEXT,
        fallback_used INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_arena_decision_agent_date ON arena_decision_logs(agent_id, round_date);
      CREATE INDEX IF NOT EXISTS idx_arena_decision_round_date ON arena_decision_logs(round_date);

      CREATE TABLE IF NOT EXISTS arena_discussions (
        round_date TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        model TEXT,
        fallback_used INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS arena_round_progress (
        round_date TEXT NOT NULL,
        phase TEXT NOT NULL,
        note TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (round_date, phase)
      );

      CREATE TABLE IF NOT EXISTS arena_round_universe (
        round_date TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT,
        PRIMARY KEY (round_date, symbol)
      );

      CREATE TABLE IF NOT EXISTS arena_tick_jobs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        round_date TEXT    NOT NULL,
        phase      TEXT    NOT NULL,   -- premarket | slot | close
        slot       INTEGER,            -- phase=slot 時指定 slot index
        status     TEXT    NOT NULL DEFAULT 'running',  -- running | done | failed
        result     TEXT,               -- JSON：ArenaTickResult（done 時寫入）
        error      TEXT,               -- 失敗訊息（failed 時寫入）
        created_at TEXT    DEFAULT (datetime('now','localtime')),
        updated_at TEXT    DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_arena_tick_jobs_round_phase_slot ON arena_tick_jobs(round_date, phase, slot);
      CREATE INDEX IF NOT EXISTS idx_arena_tick_jobs_status ON arena_tick_jobs(status);

      CREATE TABLE IF NOT EXISTS social_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        edition_key TEXT NOT NULL,
        content TEXT NOT NULL,
        image_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        container_id TEXT,
        external_id TEXT,
        error TEXT,
        published_at TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE (platform, edition_key)
      );
      CREATE INDEX IF NOT EXISTS idx_social_posts_platform_created ON social_posts(platform, created_at);

      CREATE TABLE IF NOT EXISTS social_card_images (
        edition_key TEXT NOT NULL,
        style TEXT NOT NULL,
        image_data BLOB NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (edition_key, style)
      );

CREATE TABLE IF NOT EXISTS market_focus_subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        token TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        unsubscribed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_market_focus_subscribers_status ON market_focus_subscribers(status);

      CREATE TABLE IF NOT EXISTS cycle_entry_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        edition_date TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT,
        market_cap REAL,
        signal_rank INTEGER,
        price REAL,
        entry_price_hint REAL,
        score INTEGER NOT NULL DEFAULT 0,
        matched_rules TEXT NOT NULL DEFAULT '',
        cycle_stage TEXT,
        pct_off_52w_high REAL,
        pct_off_52w_low REAL,
        rsi REAL,
        ma20 REAL,
        ma60 REAL,
        macd_hist REAL,
        llm_note TEXT,
        bt_total_signals INTEGER DEFAULT 0,
        bt_wins INTEGER DEFAULT 0,
        bt_losses INTEGER DEFAULT 0,
        bt_neutral INTEGER DEFAULT 0,
        bt_win_rate REAL,
        bt_avg_days REAL,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_cycle_entry_signals_date ON cycle_entry_signals(edition_date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_entry_signals_unique ON cycle_entry_signals(edition_date, symbol);

      CREATE TABLE IF NOT EXISTS cycle_entry_meta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        edition_date TEXT NOT NULL UNIQUE,
        summary TEXT,
        signal_count INTEGER NOT NULL DEFAULT 0,
        generated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cycle_entry_meta_date ON cycle_entry_meta(edition_date);

      CREATE TABLE IF NOT EXISTS llm_usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        model TEXT NOT NULL,
        usedFallback INTEGER DEFAULT 0,
        promptTokens INTEGER DEFAULT 0,
        completionTokens INTEGER DEFAULT 0,
        totalTokens INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_agent ON llm_usage_logs(agent);

      CREATE TABLE IF NOT EXISTS analysis_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        enabled_agents TEXT NOT NULL DEFAULT '[]',
        agent_states TEXT NOT NULL DEFAULT '{}',
        state_snapshot TEXT NOT NULL DEFAULT '{}',
        failed_agent TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_jobs_user ON analysis_jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_analysis_jobs_ticker ON analysis_jobs(ticker);
      CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status);

      CREATE TABLE IF NOT EXISTS trade_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        trade_date TEXT NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        shares REAL NOT NULL,
        reason TEXT NOT NULL,
        stop_loss_obeyed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_trade_journal_user ON trade_journal(user_id, id);
      CREATE INDEX IF NOT EXISTS idx_trade_journal_date ON trade_journal(user_id, trade_date);

      -- Issue #35：TWSE 除息快取（TWT48U；UNIQUE 防重抓冪等）。
      CREATE TABLE IF NOT EXISTS twse_dividends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        ex_date TEXT NOT NULL,
        cash_dividend REAL NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE (symbol, ex_date)
      );
      CREATE INDEX IF NOT EXISTS idx_twse_dividends_ex_date ON twse_dividends(ex_date);
      CREATE INDEX IF NOT EXISTS idx_twse_dividends_symbol ON twse_dividends(symbol);

    `)

    return _db
  } catch (err) {
    console.error('[SQLite] Failed to initialize (falling back to memory):', err)
    _dbFailed = true
    return null
  }
}

// ─── Azure SQL connection pool ───────────────────────────────────
async function getAzurePool(): Promise<sql.ConnectionPool | null> {
  if (_pool) return _pool
  if (_poolFailed) return null

  try {
    _pool = await sql.connect(DATABASE_URL)
    console.log('[AzureSQL] Connected successfully')

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'odd_lot_trades')
      BEGIN
        CREATE TABLE odd_lot_trades (
          id         INT IDENTITY(1,1) PRIMARY KEY,
          date       NVARCHAR(20) NOT NULL,
          stock_id   NVARCHAR(20) NOT NULL,
          stock_name NVARCHAR(100) NOT NULL,
          price      FLOAT,
          volume     INT,
          bid_price  FLOAT,
          bid_volume INT,
          ask_price  FLOAT,
          ask_volume INT,
          created_at DATETIME DEFAULT GETDATE(),
          CONSTRAINT uq_odd_lot UNIQUE (date, stock_id)
        );
        CREATE INDEX idx_odd_lot_date ON odd_lot_trades(date);
        CREATE INDEX idx_odd_lot_stock ON odd_lot_trades(stock_id);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'shareholder_gifts')
      BEGIN
        CREATE TABLE shareholder_gifts (
          id                   INT IDENTITY(1,1) PRIMARY KEY,
          stock_id             NVARCHAR(20) NOT NULL,
          stock_name           NVARCHAR(100) NOT NULL,
          meeting_date         NVARCHAR(20),
          last_buy_date        NVARCHAR(20),
          gift_name            NVARCHAR(500),
          gift_status          NVARCHAR(50),
          claim_rule           NVARCHAR(50),
          claim_rule_source    NVARCHAR(50),
          mops_gift_text       NVARCHAR(MAX),
          mops_meeting_date    NVARCHAR(50),
          mops_source_url      NVARCHAR(1000),
          mops_updated_at      NVARCHAR(50),
          distribution_method  NVARCHAR(200),
          distribution_location NVARCHAR(500),
          source_url           NVARCHAR(1000),
          created_at           DATETIME DEFAULT GETDATE(),
          CONSTRAINT uq_gift UNIQUE (stock_id, meeting_date)
        );
        CREATE INDEX idx_gift_stock ON shareholder_gifts(stock_id);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'analysis_records')
      BEGIN
        CREATE TABLE analysis_records (
          id                   INT IDENTITY(1,1) PRIMARY KEY,
          ticker               NVARCHAR(20) NOT NULL,
          recommendation       NVARCHAR(50) NOT NULL,
          summary              NVARCHAR(MAX),
          full_report_json     NVARCHAR(MAX) NOT NULL,
          model_usage          NVARCHAR(4000),
          primary_models       NVARCHAR(500),
          fallback_used        NVARCHAR(10),
          fallback_count       INT DEFAULT 0,
          created_at           DATETIME DEFAULT GETDATE()
        );
        CREATE INDEX idx_analysis_ticker ON analysis_records(ticker);
        CREATE INDEX idx_analysis_created ON analysis_records(created_at);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'historical_shareholder_gifts')
      BEGIN
        CREATE TABLE historical_shareholder_gifts (
          id           INT IDENTITY(1,1) PRIMARY KEY,
          stock_id     NVARCHAR(20) NOT NULL,
          stock_name   NVARCHAR(100),
          year         INT NOT NULL,
          gift_name    NVARCHAR(500) NOT NULL,
          created_at   DATETIME DEFAULT GETDATE(),
          CONSTRAINT uq_hist_gift UNIQUE (stock_id, year)
        );
        CREATE INDEX idx_historical_gifts_stock ON historical_shareholder_gifts(stock_id);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'users')
      BEGIN
        CREATE TABLE users (
          id           INT IDENTITY(1,1) PRIMARY KEY,
          email        NVARCHAR(255),
          display_name NVARCHAR(100),
          avatar_url   NVARCHAR(500),
          created_at   DATETIME DEFAULT GETDATE()
        );
        CREATE TABLE user_identities (
          id               INT IDENTITY(1,1) PRIMARY KEY,
          user_id          INT NOT NULL,
          provider         NVARCHAR(20) NOT NULL,
          provider_user_id NVARCHAR(100) NOT NULL,
          provider_email   NVARCHAR(255),
          created_at       DATETIME DEFAULT GETDATE(),
          CONSTRAINT uq_identity UNIQUE (provider, provider_user_id)
        );
        CREATE INDEX idx_identities_user ON user_identities(user_id);
        CREATE TABLE api_usage (
          id         INT IDENTITY(1,1) PRIMARY KEY,
          user_id    INT NOT NULL,
          usage_date NVARCHAR(10) NOT NULL,
          count      INT DEFAULT 0,
          CONSTRAINT uq_api_usage UNIQUE (user_id, usage_date)
        );
        CREATE INDEX idx_api_usage_user ON api_usage(user_id);
      END
    `)

    // 即使 users 已存在，也要確保後續加入的表有建立：
    // 若是把這些 CREATE 包在「users 不存在才建」的守衛內，已上線的 DB 會永遠漏建，
    // 造成 consumeRecognitionQuota / 存持股永遠失敗。改用 per-table 獨立守衛。
    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'recognition_usage')
      BEGIN
        CREATE TABLE recognition_usage (
          id         INT IDENTITY(1,1) PRIMARY KEY,
          user_id    INT NOT NULL,
          usage_date NVARCHAR(10) NOT NULL,
          count      INT DEFAULT 0,
          CONSTRAINT uq_recognition_usage UNIQUE (user_id, usage_date)
        );
        CREATE INDEX idx_recognition_usage_user ON recognition_usage(user_id);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'agent_settings')
      BEGIN
        CREATE TABLE agent_settings (
          setting_key NVARCHAR(120) PRIMARY KEY,
          value       NVARCHAR(MAX),
          category    NVARCHAR(50),
          label       NVARCHAR(200),
          updated_at  DATETIME DEFAULT GETDATE()
        );
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'placement_events')
      BEGIN
        CREATE TABLE placement_events (
          id         INT IDENTITY(1,1) PRIMARY KEY,
          event      NVARCHAR(30) NOT NULL,
          symbol     NVARCHAR(20),
          user_id    INT,
          created_at DATETIME DEFAULT GETDATE()
        );
        CREATE INDEX idx_placement_event ON placement_events(event, created_at);
        CREATE INDEX idx_placement_user ON placement_events(user_id);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'portfolio_records')
      BEGIN
        CREATE TABLE portfolio_records (
          id                   INT IDENTITY(1,1) PRIMARY KEY,
          user_id              INT NOT NULL,
          guest_uid            NVARCHAR(64),
          market               NVARCHAR(10) NOT NULL,
          symbol               NVARCHAR(30) NOT NULL,
          symbol_name          NVARCHAR(255),
          shares               FLOAT NOT NULL,
          cost                 FLOAT NOT NULL,
          current_price        FLOAT NOT NULL,
          dividend             FLOAT NOT NULL,
          cost_basis           FLOAT NOT NULL,
          market_value         FLOAT NOT NULL,
          unrealized_pnl       FLOAT NOT NULL,
          unrealized_pnl_pct   FLOAT NOT NULL,
          total_return         FLOAT NOT NULL,
          total_return_pct     FLOAT NOT NULL,
          yield_on_cost        FLOAT NOT NULL,
          strategy             NVARCHAR(50),
          recommendation       NVARCHAR(20),
          summary              NVARCHAR(MAX),
          report_json          NVARCHAR(MAX),
          price_synced_at      DATETIME,
          created_at           DATETIME DEFAULT GETDATE()
        );
        CREATE INDEX idx_portfolio_user ON portfolio_records(user_id, id);
      END
    `)

    // 既有表補 guest_uid（冪等）+ guest 索引 + 認領碼表
    await _pool.request().query(`
      IF COL_LENGTH('portfolio_records', 'guest_uid') IS NULL
        ALTER TABLE portfolio_records ADD guest_uid NVARCHAR(64);
      IF COL_LENGTH('portfolio_records', 'price_synced_at') IS NULL
        ALTER TABLE portfolio_records ADD price_synced_at DATETIME;
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_portfolio_guest')
        CREATE INDEX idx_portfolio_guest ON portfolio_records(guest_uid, id);
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'claim_codes')
      BEGIN
        CREATE TABLE claim_codes (
          code_hash  NVARCHAR(64) PRIMARY KEY,
          guest_uid  NVARCHAR(64) NOT NULL,
          created_at DATETIME DEFAULT GETDATE()
        );
        CREATE INDEX idx_claim_guest ON claim_codes(guest_uid);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'market_focus')
      BEGIN
        CREATE TABLE market_focus (
          id           INT IDENTITY(1,1) PRIMARY KEY,
          title        NVARCHAR(500) NOT NULL,
          url          NVARCHAR(2000) NOT NULL,
          source       NVARCHAR(200),
          published_at NVARCHAR(100),
          reason       NVARCHAR(MAX),
          content      NVARCHAR(MAX),
          source_url   NVARCHAR(2000),
          impact_direction NVARCHAR(20),
          scope        NVARCHAR(200),
          horizon      NVARCHAR(200),
          affected_sectors NVARCHAR(500),
          action       NVARCHAR(500),
          related_symbols NVARCHAR(200),
          created_at   DATETIME DEFAULT GETDATE()
        );
        CREATE INDEX idx_market_focus_created ON market_focus(created_at);
        CREATE TABLE market_focus_meta (
          id           INT IDENTITY(1,1) PRIMARY KEY,
          summary      NVARCHAR(MAX) NOT NULL,
          generated_at NVARCHAR(100),
          created_at   DATETIME DEFAULT GETDATE()
        );
      END
    `)

    // 既有 market_focus 表補齊新欄位（冪等），並建立 market_focus_meta（若尚未存在）。
    await _pool.request().query(`
      IF COL_LENGTH('market_focus', 'content') IS NULL
        ALTER TABLE market_focus ADD content NVARCHAR(MAX);
      IF COL_LENGTH('market_focus', 'source_url') IS NULL
        ALTER TABLE market_focus ADD source_url NVARCHAR(2000);
      IF COL_LENGTH('market_focus', 'reason') IS NULL
        ALTER TABLE market_focus ADD reason NVARCHAR(MAX);
      IF COL_LENGTH('market_focus', 'summary') IS NULL
        ALTER TABLE market_focus ADD summary NVARCHAR(MAX);
      IF COL_LENGTH('market_focus', 'impact_direction') IS NULL
        ALTER TABLE market_focus ADD impact_direction NVARCHAR(20);
      IF COL_LENGTH('market_focus', 'scope') IS NULL
        ALTER TABLE market_focus ADD scope NVARCHAR(200);
      IF COL_LENGTH('market_focus', 'horizon') IS NULL
        ALTER TABLE market_focus ADD horizon NVARCHAR(200);
      IF COL_LENGTH('market_focus', 'affected_sectors') IS NULL
        ALTER TABLE market_focus ADD affected_sectors NVARCHAR(500);
      IF COL_LENGTH('market_focus', 'action') IS NULL
        ALTER TABLE market_focus ADD action NVARCHAR(500);
      IF COL_LENGTH('market_focus', 'related_symbols') IS NULL
        ALTER TABLE market_focus ADD related_symbols NVARCHAR(200);
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'market_focus_meta')
      BEGIN
        CREATE TABLE market_focus_meta (
          id           INT IDENTITY(1,1) PRIMARY KEY,
          summary      NVARCHAR(MAX) NOT NULL,
          generated_at NVARCHAR(100),
          created_at   DATETIME DEFAULT GETDATE()
        );
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'market_focus_logs')
      BEGIN
        CREATE TABLE market_focus_logs (
          id          INT IDENTITY(1,1) PRIMARY KEY,
          source      NVARCHAR(60) NOT NULL,
          level       NVARCHAR(10) NOT NULL,
          code        NVARCHAR(60),
          job_id      NVARCHAR(80),
          edition_key NVARCHAR(100),
          message     NVARCHAR(MAX) NOT NULL,
          detail      NVARCHAR(MAX),
          created_at  DATETIME DEFAULT GETDATE()
        );
        CREATE INDEX idx_mf_logs_created ON market_focus_logs(created_at);
        CREATE INDEX idx_mf_logs_source ON market_focus_logs(source);
      END
    `)

    // ── AI Agent 競技場 (arena_*)：沿用 per-table 獨立守衛，已上線 DB 也能補建 ──
    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_seasons')
      BEGIN
        CREATE TABLE arena_seasons (
          id INT IDENTITY(1,1) PRIMARY KEY,
          name NVARCHAR(100) NOT NULL UNIQUE,
          status NVARCHAR(20) NOT NULL DEFAULT 'registration',
          start_date NVARCHAR(20),
          end_date NVARCHAR(20),
          registration_start NVARCHAR(20),
          registration_end NVARCHAR(20),
          created_at DATETIME DEFAULT GETDATE()
        );
        CREATE INDEX idx_arena_season_status ON arena_seasons(status);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_agents')
      BEGIN
        CREATE TABLE arena_agents (
          id INT IDENTITY(1,1) PRIMARY KEY,
          season_id INT NOT NULL,
          owner_user_id INT NOT NULL DEFAULT 0,
          name NVARCHAR(80) NOT NULL,
          division NVARCHAR(10) NOT NULL DEFAULT 'season',
          strategy_id NVARCHAR(40) NOT NULL,
          tone NVARCHAR(20) NOT NULL DEFAULT 'neutral',
          initial_capital FLOAT NOT NULL DEFAULT 500000,
          cash FLOAT NOT NULL DEFAULT 500000,
          status NVARCHAR(10) NOT NULL DEFAULT 'active',
          is_system INT NOT NULL DEFAULT 0,
          joined_at NVARCHAR(20),
          adjust_count INT NOT NULL DEFAULT 0,
          last_round_date NVARCHAR(20),
          reset_note NVARCHAR(200),
          created_at DATETIME DEFAULT GETDATE()
        );
        CREATE INDEX idx_arena_agent_owner ON arena_agents(owner_user_id);
        CREATE INDEX idx_arena_agent_season ON arena_agents(season_id, status);
      END

      IF COL_LENGTH('arena_agents', 'cash') IS NULL
        ALTER TABLE arena_agents ADD cash FLOAT NOT NULL DEFAULT 500000;
      IF COL_LENGTH('arena_agents', 'adjust_count') IS NULL
        ALTER TABLE arena_agents ADD adjust_count INT NOT NULL DEFAULT 0;
      IF COL_LENGTH('arena_agents', 'last_round_date') IS NULL
        ALTER TABLE arena_agents ADD last_round_date NVARCHAR(20);
      IF COL_LENGTH('arena_agents', 'reset_note') IS NULL
        ALTER TABLE arena_agents ADD reset_note NVARCHAR(200);
      IF COL_LENGTH('arena_agents', 'is_system') IS NULL
        ALTER TABLE arena_agents ADD is_system INT NOT NULL DEFAULT 0;
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_holdings')
      BEGIN
        CREATE TABLE arena_holdings (
          id INT IDENTITY(1,1) PRIMARY KEY,
          agent_id INT NOT NULL,
          symbol NVARCHAR(20) NOT NULL,
          symbol_name NVARCHAR(100),
          shares FLOAT NOT NULL DEFAULT 0,
          avg_cost FLOAT NOT NULL DEFAULT 0,
          updated_round_date NVARCHAR(20),
          CONSTRAINT uq_arena_holding UNIQUE (agent_id, symbol)
        );
        CREATE INDEX idx_arena_holding_agent ON arena_holdings(agent_id);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_trades')
      BEGIN
        CREATE TABLE arena_trades (
          id INT IDENTITY(1,1) PRIMARY KEY,
          agent_id INT NOT NULL,
          round_date NVARCHAR(20) NOT NULL,
          action NVARCHAR(10) NOT NULL,
          symbol NVARCHAR(20),
          symbol_name NVARCHAR(100),
          shares FLOAT,
          price FLOAT,
          fee FLOAT,
          tax FLOAT,
          reason NVARCHAR(MAX),
          model NVARCHAR(100),
          fallback_used INT DEFAULT 0,
          error NVARCHAR(500),
          created_at DATETIME DEFAULT GETDATE()
        );
        CREATE INDEX idx_arena_trade_agent ON arena_trades(agent_id, round_date);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_equity_snapshots')
      BEGIN
        CREATE TABLE arena_equity_snapshots (
          id INT IDENTITY(1,1) PRIMARY KEY,
          agent_id INT NOT NULL,
          season_id INT NOT NULL,
          round_date NVARCHAR(20) NOT NULL,
          cash FLOAT NOT NULL,
          equity FLOAT NOT NULL,
          return_pct FLOAT NOT NULL DEFAULT 0,
          CONSTRAINT uq_arena_snapshot UNIQUE (agent_id, round_date)
        );
        CREATE INDEX idx_arena_snapshot_agent ON arena_equity_snapshots(agent_id, round_date);
      END

      IF COL_LENGTH('arena_agents', 'personality') IS NULL
        ALTER TABLE arena_agents ADD personality NVARCHAR(100);
      IF COL_LENGTH('arena_agents', 'strategy_params') IS NULL
        ALTER TABLE arena_agents ADD strategy_params NVARCHAR(MAX);
      IF COL_LENGTH('arena_trades', 'slot') IS NULL
        ALTER TABLE arena_trades ADD slot INT;

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_intraday_prices')
      BEGIN
        CREATE TABLE arena_intraday_prices (
          round_date NVARCHAR(20) NOT NULL,
          symbol NVARCHAR(20) NOT NULL,
          slot INT NOT NULL,
          time_label NVARCHAR(20),
          price FLOAT NOT NULL,
          change_pct FLOAT,
          created_at DATETIME2 DEFAULT GETDATE(),
          CONSTRAINT pk_arena_intraday PRIMARY KEY (round_date, symbol, slot)
        );
        CREATE INDEX idx_arena_intraday_date ON arena_intraday_prices(round_date);
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_market_briefings')
      BEGIN
        CREATE TABLE arena_market_briefings (
          round_date NVARCHAR(20) PRIMARY KEY,
          content NVARCHAR(MAX) NOT NULL,
          model NVARCHAR(100),
          fallback_used INT DEFAULT 0,
          created_at DATETIME2 DEFAULT GETDATE()
        );
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_decision_logs')
      BEGIN
        CREATE TABLE arena_decision_logs (
          id INT IDENTITY(1,1) PRIMARY KEY,
          agent_id INT NOT NULL,
          season_id INT,
          round_date NVARCHAR(20) NOT NULL,
          phase NVARCHAR(20) NOT NULL,
          slot INT,
          content NVARCHAR(MAX) NOT NULL,
          model NVARCHAR(100),
          fallback_used INT DEFAULT 0,
          created_at DATETIME2 DEFAULT GETDATE()
        );
        CREATE INDEX idx_arena_decision_agent_date ON arena_decision_logs(agent_id, round_date);
        CREATE INDEX idx_arena_decision_round_date ON arena_decision_logs(round_date);
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_discussions')
      BEGIN
        CREATE TABLE arena_discussions (
          round_date NVARCHAR(20) PRIMARY KEY,
          content NVARCHAR(MAX) NOT NULL,
          model NVARCHAR(100),
          fallback_used INT DEFAULT 0,
          created_at DATETIME2 DEFAULT GETDATE()
        );
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_round_progress')
      BEGIN
        CREATE TABLE arena_round_progress (
          round_date NVARCHAR(20) NOT NULL,
          phase NVARCHAR(40) NOT NULL,
          note NVARCHAR(500),
          created_at DATETIME2 DEFAULT GETDATE(),
          CONSTRAINT pk_arena_round_progress PRIMARY KEY (round_date, phase)
        );
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_round_universe')
      BEGIN
        CREATE TABLE arena_round_universe (
          round_date NVARCHAR(20) NOT NULL,
          symbol NVARCHAR(20) NOT NULL,
          name NVARCHAR(100),
          CONSTRAINT pk_arena_round_universe PRIMARY KEY (round_date, symbol)
        );
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'arena_tick_jobs')
      BEGIN
        CREATE TABLE arena_tick_jobs (
          id         INT IDENTITY(1,1) PRIMARY KEY,
          round_date NVARCHAR(20) NOT NULL,
          phase      NVARCHAR(40) NOT NULL,   -- premarket | slot | close
          slot       INT,
          status     NVARCHAR(20) NOT NULL DEFAULT 'running',  -- running | done | failed
          result     NVARCHAR(MAX),           -- JSON：ArenaTickResult（done 時寫入）
          error      NVARCHAR(MAX),           -- 失敗訊息（failed 時寫入）
          created_at DATETIME2 DEFAULT GETDATE(),
          updated_at DATETIME2 DEFAULT GETDATE()
        );
        CREATE INDEX idx_arena_tick_jobs_key ON arena_tick_jobs(round_date, phase, slot);
        CREATE INDEX idx_arena_tick_jobs_status ON arena_tick_jobs(status);
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'social_posts')
      BEGIN
        CREATE TABLE social_posts (
          id INT IDENTITY(1,1) PRIMARY KEY,
          platform NVARCHAR(20) NOT NULL,
          edition_key NVARCHAR(100) NOT NULL,
          content NVARCHAR(MAX) NOT NULL,
          image_url NVARCHAR(500),
          status NVARCHAR(30) NOT NULL DEFAULT 'pending',
          container_id NVARCHAR(100),
          external_id NVARCHAR(100),
          error NVARCHAR(MAX),
          published_at DATETIME2,
          created_at DATETIME2 DEFAULT GETDATE(),
          CONSTRAINT uq_social_post UNIQUE (platform, edition_key)
        );
        CREATE INDEX idx_social_posts_platform_created ON social_posts(platform, created_at);
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'social_card_images')
      BEGIN
        CREATE TABLE social_card_images (
          edition_key NVARCHAR(100) NOT NULL,
          style NVARCHAR(20) NOT NULL,
          image_data VARBINARY(MAX) NOT NULL,
          created_at DATETIME2 DEFAULT GETDATE(),
          CONSTRAINT pk_social_card_images PRIMARY KEY (edition_key, style)
        );
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'market_focus_subscribers')
      BEGIN
        CREATE TABLE market_focus_subscribers (
          id INT IDENTITY(1,1) PRIMARY KEY,
          email NVARCHAR(255) NOT NULL UNIQUE,
          status NVARCHAR(20) NOT NULL DEFAULT 'active',
          token NVARCHAR(100) NOT NULL,
          created_at DATETIME2 DEFAULT GETDATE(),
          updated_at DATETIME2 DEFAULT GETDATE(),
          unsubscribed_at DATETIME2
        );
        CREATE INDEX idx_market_focus_subscribers_status ON market_focus_subscribers(status);
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'cycle_entry_signals')
      BEGIN
        CREATE TABLE cycle_entry_signals (
          id INT IDENTITY(1,1) PRIMARY KEY,
          edition_date NVARCHAR(20) NOT NULL,
          symbol NVARCHAR(30) NOT NULL,
          name NVARCHAR(100),
          market_cap FLOAT,
          signal_rank INT,
          price FLOAT,
          entry_price_hint FLOAT,
          score INT NOT NULL DEFAULT 0,
          matched_rules NVARCHAR(50) NOT NULL DEFAULT '',
          cycle_stage NVARCHAR(30),
          pct_off_52w_high FLOAT,
          pct_off_52w_low FLOAT,
          rsi FLOAT,
          ma20 FLOAT,
          ma60 FLOAT,
          macd_hist FLOAT,
          llm_note NVARCHAR(2000),
          bt_total_signals INT DEFAULT 0,
          bt_wins INT DEFAULT 0,
          bt_losses INT DEFAULT 0,
          bt_neutral INT DEFAULT 0,
          bt_win_rate FLOAT,
          bt_avg_days FLOAT,
          created_at DATETIME2 DEFAULT GETDATE()
        );
        CREATE INDEX idx_cycle_entry_signals_date ON cycle_entry_signals(edition_date);
        CREATE UNIQUE INDEX idx_cycle_entry_signals_unique ON cycle_entry_signals(edition_date, symbol);
      END

      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'cycle_entry_meta')
      BEGIN
        CREATE TABLE cycle_entry_meta (
          id INT IDENTITY(1,1) PRIMARY KEY,
          edition_date NVARCHAR(20) NOT NULL UNIQUE,
          summary NVARCHAR(MAX),
          signal_count INT NOT NULL DEFAULT 0,
          generated_at DATETIME2 DEFAULT GETDATE()
        );
        CREATE INDEX idx_cycle_entry_meta_date ON cycle_entry_meta(edition_date);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'llm_usage_logs')
      BEGIN
        CREATE TABLE llm_usage_logs (
          id               INT IDENTITY(1,1) PRIMARY KEY,
          agent            NVARCHAR(80) NOT NULL,
          model            NVARCHAR(100) NOT NULL,
          usedFallback     INT DEFAULT 0,
          promptTokens     INT DEFAULT 0,
          completionTokens INT DEFAULT 0,
          totalTokens      INT DEFAULT 0,
          created_at       DATETIME2 DEFAULT GETDATE()
        );
        CREATE INDEX idx_llm_usage_created ON llm_usage_logs(created_at);
        CREATE INDEX idx_llm_usage_agent ON llm_usage_logs(agent);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'analysis_jobs')
      BEGIN
        CREATE TABLE analysis_jobs (
          id             INT IDENTITY(1,1) PRIMARY KEY,
          user_id        INT NOT NULL,
          ticker         NVARCHAR(40) NOT NULL,
          date           NVARCHAR(20) NOT NULL,
          status         NVARCHAR(20) NOT NULL DEFAULT 'running',
          enabled_agents NVARCHAR(MAX) NOT NULL DEFAULT '[]',
          agent_states   NVARCHAR(MAX) NOT NULL DEFAULT '{}',
          state_snapshot NVARCHAR(MAX) NOT NULL DEFAULT '{}',
          failed_agent   NVARCHAR(80),
          error          NVARCHAR(MAX),
          created_at     DATETIME2 DEFAULT GETDATE(),
          updated_at     DATETIME2 DEFAULT GETDATE()
        );
        CREATE INDEX idx_analysis_jobs_user ON analysis_jobs(user_id);
        CREATE INDEX idx_analysis_jobs_ticker ON analysis_jobs(ticker);
        CREATE INDEX idx_analysis_jobs_status ON analysis_jobs(status);
      END
    `)

    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'trade_journal')
      BEGIN
        CREATE TABLE trade_journal (
          id               INT IDENTITY(1,1) PRIMARY KEY,
          user_id          INT NOT NULL,
          trade_date       NVARCHAR(20) NOT NULL,
          symbol           NVARCHAR(30) NOT NULL,
          direction        NVARCHAR(10) NOT NULL,
          entry_price      FLOAT NOT NULL,
          exit_price       FLOAT NOT NULL,
          shares           FLOAT NOT NULL,
          reason           NVARCHAR(MAX) NOT NULL,
          stop_loss_obeyed INT NOT NULL DEFAULT 0,
          created_at       DATETIME2 DEFAULT GETDATE(),
          updated_at       DATETIME2 DEFAULT GETDATE()
        );
        CREATE INDEX idx_trade_journal_user ON trade_journal(user_id, id);
        CREATE INDEX idx_trade_journal_date ON trade_journal(user_id, trade_date);
      END
    `)

    // Issue #35：TWSE 除息快取（TWT48U；UNIQUE 防重抓冪等）。
    await _pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'twse_dividends')
      BEGIN
        CREATE TABLE twse_dividends (
          id            INT IDENTITY(1,1) PRIMARY KEY,
          symbol        NVARCHAR(30) NOT NULL,
          ex_date       NVARCHAR(20) NOT NULL,
          cash_dividend FLOAT NOT NULL,
          created_at    DATETIME2 DEFAULT GETDATE(),
          CONSTRAINT uq_twse_dividends UNIQUE (symbol, ex_date)
        );
        CREATE INDEX idx_twse_dividends_ex_date ON twse_dividends(ex_date);
        CREATE INDEX idx_twse_dividends_symbol ON twse_dividends(symbol);
      END
    `)

    return _pool
  } catch (err) {
    console.error('[AzureSQL] Failed to connect (falling back to memory):', err)
    _poolFailed = true
    return null
  }
}

// ─── Unified public API ──────────────────────────────────────────

/**
 * Returns the raw SQLite database handle (local only).
 * Returns null when using Azure SQL or on failure.
 */
export function getDb(): Database.Database | null {
  if (isAzureSql) return null
  return getSqliteDb()
}

/**
 * Check if we have a working database connection (either backend).
 */
export function getAzurePoolPublic(): Promise<sql.ConnectionPool | null> {
  return getAzurePool()
}

export function hasDb(): boolean {
  if (isAzureSql) return !_poolFailed
  return getSqliteDb() !== null
}

/**
 * Azure SQL (T-SQL) has no LIMIT clause — translate `... LIMIT n` to `SELECT TOP (n) ...`.
 * SQLite keeps native LIMIT. Only applies when a trailing LIMIT n is present.
 */
export function translateLimitForAzure(sqlStr: string): string {
  // SQLite → T-SQL: LIMIT n → TOP (n)
  const applyTop = (sql: string): string =>
    sql.replace(
      /^\s*SELECT\s+(.*)\s+LIMIT\s+(\d+|@\w+)\s*;?\s*$/is,
      (_all, rest, n) => `SELECT TOP (${n}) ${rest}`,
    )

  // `SELECT DISTINCT x ... ORDER BY ... LIMIT n` breaks in T-SQL
  // (ORDER BY items must appear in the select list when DISTINCT is used).
  // Fix by deduping inside a derived table and ordering outside of it.
  const distinctWithOrder = sqlStr.match(
    /^\s*SELECT\s+DISTINCT\s+([\s\S]+?)\s+FROM\s+([\s\S]*?)\s+ORDER\s+BY\s+([\s\S]+?)\s+LIMIT\s+(\d+|@\w+)\s*;?\s*$/is,
  )
  if (distinctWithOrder) {
    const [, cols, body, orderBy, n] = distinctWithOrder
    return `SELECT TOP (${n}) * FROM (SELECT DISTINCT ${cols.trim()} FROM ${body.trim()}) t ORDER BY ${orderBy.trim()}`
  }

  return applyTop(sqlStr)
}

/**
 * Query all rows. Works with both SQLite and Azure SQL.
 */
export async function dbQueryAll<T = any>(sqlStr: string, params?: Record<string, any>): Promise<T[]> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return []
    const req = pool.request()
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        req.input(k, v ?? null)
      }
    }
    const result = await req.query(translateLimitForAzure(sqlStr))
    return result.recordset
  }

  const db = getSqliteDb()
  if (!db) return []

  if (params) {
    return db.prepare(sqlStr).all(params) as any[]
  }
  return db.prepare(sqlStr).all() as any[]
}

/**
 * Query first row. Works with both SQLite and Azure SQL.
 */
export async function dbQueryFirst<T = any>(sqlStr: string, params?: Record<string, any>): Promise<T | undefined> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return undefined
    const req = pool.request()
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        req.input(k, v ?? null)
      }
    }
    const result = await req.query(translateLimitForAzure(sqlStr))
    return result.recordset[0] as T | undefined
  }

  const db = getSqliteDb()
  if (!db) return undefined

  if (params) {
    return db.prepare(sqlStr).get(params) as T | undefined
  }
  return db.prepare(sqlStr).get() as T | undefined
}

/**
 * Execute a statement (INSERT/UPDATE/DELETE). Works with both backends.
 */
export async function dbExecute(sqlStr: string, params?: Record<string, any>): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    const req = pool.request()
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        req.input(k, v ?? null)
      }
    }
    await req.query(sqlStr)
    return
  }

  const db = getSqliteDb()
  if (!db) return

  if (params) {
    db.prepare(sqlStr).run(params)
  } else {
    db.exec(sqlStr)
  }
}

/**
 * Run a raw SQL string (multi-statement). Azure SQL splits on GO; SQLite uses exec.
 */
export async function dbExecRaw(sqlStr: string): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    const batches = sqlStr.split(/\bGO\b/i).filter(b => b.trim())
    for (const batch of batches) {
      if (batch.trim()) {
        await pool.request().query(batch)
      }
    }
    return
  }

  const db = getSqliteDb()
  if (!db) return
  db.exec(sqlStr)
}

// ─── Placement Events (page_view / backtest_run 追蹤) ────────────

/**
 * 記錄一次功能使用事件（如頁面造訪、回測啟動），可帶對應 symbol 與登入 user_id。
 * DB 失敗一律靜默吞掉，絕不影響主功能。
 */
export async function logPlacementEvent(
  event: 'page_view' | 'backtest_run',
  opts?: { symbol?: string | null; userId?: number | null },
): Promise<void> {
  try {
    await dbExecute(
      'INSERT INTO placement_events (event, symbol, user_id) VALUES (@event, @symbol, @user_id)',
      {
        event,
        symbol: opts?.symbol ?? null,
        user_id: opts?.userId ?? null,
      },
    )
  } catch (e) {
    console.error(`[DB] logPlacementEvent failed (${event}):`, e)
  }
}

/** 回測頁使用統計，供簡易報表/監看。 */
export async function getPlacementEventStats(): Promise<{
  pageViews: number
  runCount: number
  runBySymbol: Array<{ symbol: string | null; count: number }>
  runByUser: Array<{ user_id: number | null; display_name: string | null; count: number }>
}> {
  const pageViews = (
    await dbQueryFirst<{ c: number }>("SELECT COUNT(*) AS c FROM placement_events WHERE event = 'page_view'")
  )?.c ?? 0
  const runCount = (
    await dbQueryFirst<{ c: number }>("SELECT COUNT(*) AS c FROM placement_events WHERE event = 'backtest_run'")
  )?.c ?? 0
  const runBySymbol = await dbQueryAll<{ symbol: string | null; count: number }>(
    `SELECT symbol, COUNT(*) AS count FROM placement_events
     WHERE event = 'backtest_run' GROUP BY symbol ORDER BY count DESC LIMIT 20`,
  )
  const runByUser = await dbQueryAll<{ user_id: number | null; display_name: string | null; count: number }>(
    `SELECT e.user_id, u.display_name, COUNT(*) AS count
     FROM placement_events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.event = 'backtest_run' GROUP BY e.user_id ORDER BY count DESC LIMIT 20`,
  )
  return { pageViews, runCount, runBySymbol, runByUser }
}

// ─── ensureSeedData (async version) ──────────────────────────────

export async function ensureSeedData(): Promise<number> {
  if (isAzureSql) {
    return ensureSeedDataAzure()
  }
  return ensureSeedDataSqlite()
}

async function ensureSeedDataAzure(): Promise<number> {
  const pool = await getAzurePool()
  if (!pool) return 0

  // 只在初次呼叫時確認資料筆數並（必要時）seed；之後以 per-process flag 略過，
  // 避免每頁/每次 API request 都對逐日累積的 odd_lot_trades 跑 COUNT(*)。
  let cnt = _oddLotSeeded ? -1 : 0
  if (!_oddLotSeeded) {
    const countResult = await pool.request().query('SELECT COUNT(*) as cnt FROM odd_lot_trades')
    cnt = countResult.recordset[0]?.cnt ?? 0
  }
  const batchSize = 200

  if (cnt < 50) {
    console.log(`[AzureSQL] Seeding ${SEED_TRADES.length} trades and ${SEED_GIFTS.length} gifts...`)

    try {
      for (let i = 0; i < SEED_TRADES.length; i += batchSize) {
        const batch = SEED_TRADES.slice(i, i + batchSize)
        const req = pool.request()
        const values: string[] = []
        batch.forEach((t, idx) => {
          const p = `t${idx}`
          values.push(`(@${p}_date, @${p}_sid, @${p}_sname, @${p}_price, @${p}_vol, @${p}_bp, @${p}_bv, @${p}_ap, @${p}_av)`)
          req.input(`${p}_date`, sql.NVarChar(20), t.date)
          req.input(`${p}_sid`, sql.NVarChar(20), t.stock_id)
          req.input(`${p}_sname`, sql.NVarChar(100), t.stock_name)
          req.input(`${p}_price`, sql.Float, t.price)
          req.input(`${p}_vol`, sql.Int, t.volume)
          req.input(`${p}_bp`, sql.Float, t.bid_price)
          req.input(`${p}_bv`, sql.Int, t.bid_volume)
          req.input(`${p}_ap`, sql.Float, t.ask_price)
          req.input(`${p}_av`, sql.Int, t.ask_volume)
        })
        await req.query(`
          INSERT INTO odd_lot_trades (date, stock_id, stock_name, price, volume, bid_price, bid_volume, ask_price, ask_volume)
          VALUES ${values.join(',')}
        `)
      }

      for (let i = 0; i < SEED_GIFTS.length; i += batchSize) {
        const batch = SEED_GIFTS.slice(i, i + batchSize)
        const req = pool.request()
        const values: string[] = []
        batch.forEach((g, idx) => {
          const p = `g${idx}`
          values.push(`(@${p}_sid, @${p}_sname, @${p}_md, @${p}_lbd, @${p}_gn, @${p}_dm, @${p}_dl, @${p}_su)`)
          req.input(`${p}_sid`, sql.NVarChar(20), g.stock_id)
          req.input(`${p}_sname`, sql.NVarChar(100), g.stock_name)
          req.input(`${p}_md`, sql.NVarChar(20), g.meeting_date)
          req.input(`${p}_lbd`, sql.NVarChar(20), g.last_buy_date)
          req.input(`${p}_gn`, sql.NVarChar(500), g.gift_name)
          req.input(`${p}_dm`, sql.NVarChar(200), g.distribution_method)
          req.input(`${p}_dl`, sql.NVarChar(500), g.distribution_location)
          req.input(`${p}_su`, sql.NVarChar(1000), g.source_url)
        })
        await req.query(`
          MERGE INTO shareholder_gifts AS target
          USING (VALUES ${values.join(',')}) AS source (stock_id, stock_name, meeting_date, last_buy_date, gift_name, distribution_method, distribution_location, source_url)
          ON target.stock_id = source.stock_id AND target.meeting_date = source.meeting_date
          WHEN MATCHED THEN
            UPDATE SET stock_name = source.stock_name, last_buy_date = source.last_buy_date,
                       gift_name = source.gift_name, distribution_method = source.distribution_method,
                       distribution_location = source.distribution_location, source_url = source.source_url
          WHEN NOT MATCHED THEN
            INSERT (stock_id, stock_name, meeting_date, last_buy_date, gift_name, distribution_method, distribution_location, source_url)
            VALUES (source.stock_id, source.stock_name, source.meeting_date, source.last_buy_date, source.gift_name, source.distribution_method, source.distribution_location, source.source_url);
        `)
      }
    } catch (e: any) {
      if (e.number === 2627) {
        console.log('[AzureSQL] Seed data already present (duplicate key), skipping')
      } else {
        throw e
      }
    }

    _giftsSeeded = true
    console.log('[AzureSQL] Seed data inserted')
  }

  // 無論資料是否已存在，確認過一次後就標記已做，後續呼叫略過 COUNT(*) 與 seed。
  _oddLotSeeded = true

  if (!_giftsSeeded) {
    console.log(`[AzureSQL] Ensuring ${SEED_GIFTS.length} seed gifts...`)
    try {
      for (let i = 0; i < SEED_GIFTS.length; i += batchSize) {
        const batch = SEED_GIFTS.slice(i, i + batchSize)
        const req = pool.request()
        const values: string[] = []
        batch.forEach((g, idx) => {
          const p = `g${idx}`
          values.push(`(@${p}_sid, @${p}_sname, @${p}_md, @${p}_lbd, @${p}_gn, @${p}_dm, @${p}_dl, @${p}_su)`)
          req.input(`${p}_sid`, sql.NVarChar(20), g.stock_id)
          req.input(`${p}_sname`, sql.NVarChar(100), g.stock_name)
          req.input(`${p}_md`, sql.NVarChar(20), g.meeting_date)
          req.input(`${p}_lbd`, sql.NVarChar(20), g.last_buy_date)
          req.input(`${p}_gn`, sql.NVarChar(500), g.gift_name)
          req.input(`${p}_dm`, sql.NVarChar(200), g.distribution_method)
          req.input(`${p}_dl`, sql.NVarChar(500), g.distribution_location)
          req.input(`${p}_su`, sql.NVarChar(1000), g.source_url)
        })
        await req.query(`
          MERGE INTO shareholder_gifts AS target
          USING (VALUES ${values.join(',')}) AS source (stock_id, stock_name, meeting_date, last_buy_date, gift_name, distribution_method, distribution_location, source_url)
          ON target.stock_id = source.stock_id AND target.meeting_date = source.meeting_date
          WHEN MATCHED THEN
            UPDATE SET stock_name = source.stock_name, last_buy_date = source.last_buy_date,
                       gift_name = source.gift_name, distribution_method = source.distribution_method,
                       distribution_location = source.distribution_location, source_url = source.source_url
          WHEN NOT MATCHED THEN
            INSERT (stock_id, stock_name, meeting_date, last_buy_date, gift_name, distribution_method, distribution_location, source_url)
            VALUES (source.stock_id, source.stock_name, source.meeting_date, source.last_buy_date, source.gift_name, source.distribution_method, source.distribution_location, source.source_url);
        `)
      }
      _giftsSeeded = true
    } catch (e: any) {
      if (e.number === 2627) {
        console.log('[AzureSQL] Gifts already seeded (duplicate key), skipping')
        _giftsSeeded = true
      } else {
        throw e
      }
    }
  }

  // 已確認過（cnt >= 0）就直接回傳已知筆數，避免再跑一次 COUNT(*)。
  return cnt >= 0 ? cnt : -1
}

function ensureSeedDataSqlite(): number {
  const db = getSqliteDb()
  if (!db) return 0

  const countRow = db.prepare("SELECT count(*) as cnt FROM odd_lot_trades").get() as { cnt: number }
  if (!countRow || countRow.cnt < 50) {
    console.log(`[SQLite] Force populating ${SEED_TRADES.length} trades and ${SEED_GIFTS.length} gifts...`)

    const insertTrade = db.prepare(`
      INSERT OR REPLACE INTO odd_lot_trades (date, stock_id, stock_name, price, volume, bid_price, bid_volume, ask_price, ask_volume)
      VALUES (@date, @stock_id, @stock_name, @price, @volume, @bid_price, @bid_volume, @ask_price, @ask_volume)
    `)
    const insertGift = db.prepare(`
      INSERT OR REPLACE INTO shareholder_gifts (stock_id, stock_name, meeting_date, last_buy_date, gift_name, distribution_method, distribution_location, source_url)
      VALUES (@stock_id, @stock_name, @meeting_date, @last_buy_date, @gift_name, @distribution_method, @distribution_location, @source_url)
    `)

    const populateTx = db.transaction(() => {
      for (const trade of SEED_TRADES) insertTrade.run(trade)
      for (const gift of SEED_GIFTS) insertGift.run(gift)
    })
    populateTx()

    const checkCount = db.prepare("SELECT count(*) as cnt FROM odd_lot_trades").get() as { cnt: number }
    return checkCount?.cnt || 0
  }

  if (!_giftsSeeded) {
    console.log(`[SQLite] Ensuring ${SEED_GIFTS.length} seed gifts...`)
    const insertGift = db.prepare(`
      INSERT OR REPLACE INTO shareholder_gifts (stock_id, stock_name, meeting_date, last_buy_date, gift_name, distribution_method, distribution_location, source_url)
      VALUES (@stock_id, @stock_name, @meeting_date, @last_buy_date, @gift_name, @distribution_method, @distribution_location, @source_url)
    `)
    const insertGiftsTx = db.transaction(() => {
      for (const gift of SEED_GIFTS) insertGift.run(gift)
    })
    insertGiftsTx()
    _giftsSeeded = true
  }

  return countRow.cnt
}

// ─── migrate (async) ─────────────────────────────────────────────
export async function migrate(): Promise<void> {
  if (isAzureSql) {
    return migrateAzure()
  }
  return migrateSqlite()
}

async function migrateAzure(): Promise<void> {
  const pool = await getAzurePool()
  if (!pool) return

  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'migrations')
      CREATE TABLE migrations (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        name       NVARCHAR(200) NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT GETDATE()
      )
    `)

    const applied = new Set(
      (await pool.request().query('SELECT name FROM migrations')).recordset.map((r: any) => r.name)
    )

    for (const { name: file, sql: raw } of MIGRATIONS) {
      if (applied.has(file)) continue
      const batches = raw.split(/\bGO\b/i).filter(b => b.trim())
      for (const batch of batches) {
        if (!batch.trim()) continue
        try {
          await pool.request().query(batch)
        } catch (e: any) {
          const msg = String(e?.message ?? e).toLowerCase()
          const isDup =
            e?.number === 2705 ||
            e?.number === 4928 ||
            (msg.includes('already exists') && msg.includes('column'))
          if (isDup) {
            console.log(`[AzureSQL] migration ${file}: column already exists, skipping statement`)
          } else {
            // 001/002 為 SQLite 語法（CREATE TABLE IF NOT EXISTS）在 T-SQL 不合法，
            // 但表格已由 getAzurePool 建立。記錄並跳過，避免中止整個 migrate。
            console.warn(`[AzureSQL] migration ${file}: statement failed, skipping (${msg.split('\n')[0]})`)
          }
        }
      }
      await pool.request()
        .input('name', sql.NVarChar(200), file)
        .query('INSERT INTO migrations (name) VALUES (@name)')
      console.log(`Applied migration: ${file}`)
    }
  } catch (e) {
    console.error('[AzureSQL] Migration failed:', e)
  }
}

function migrateSqlite(): void {
  const db = getSqliteDb()
  if (!db) return

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`)

    const applied = new Set(
      db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name)
    )

    const insert = db.prepare('INSERT INTO migrations (name) VALUES (?)')
    for (const { name: file, sql } of MIGRATIONS) {
      if (applied.has(file)) continue
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)
      for (const stmt of statements) {
        try {
          db.exec(stmt)
        } catch (e: any) {
          const msg = String(e?.message ?? e).toLowerCase()
          if (msg.includes('duplicate column name')) {
            console.log(`[SQLite] migration ${file}: column already exists, skipping statement`)
            continue
          }
          throw e
        }
      }
      insert.run(file)
      console.log(`Applied migration: ${file}`)
    }
  } catch (e) {
    console.error('[SQLite] Migration failed:', e)
  }
}

// ─── closeDb ─────────────────────────────────────────────────────
export function closeDb(): void {
  if (_db) {
    try { _db.close() } catch (_) {}
    _db = null
  }
  if (_pool) {
    try { _pool.close() } catch (_) {}
    _pool = null
  }
}

// ─── Analysis Records ────────────────────────────────────────────
export interface AnalysisRecord {
  id?: number
  ticker: string
  recommendation: string
  summary?: string
  full_report_json: string
  model_usage?: string
  primary_models?: string
  fallback_used?: string
  fallback_count?: number
  created_at?: string
}

export async function saveAnalysisRecord(record: {
  ticker: string
  recommendation: string
  summary?: string
  fullReport: any
  modelUsage?: string
  primaryModels?: string
  fallbackUsed?: boolean
  fallbackCount?: number
}): Promise<number> {
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const reportJson = typeof record.fullReport === 'string' ? record.fullReport : JSON.stringify(record.fullReport)
  const summaryStr = typeof record.summary === 'string' ? record.summary : JSON.stringify(record.summary || '')
  const modelUsageStr = record.modelUsage ?? null
  const primaryModelsStr = record.primaryModels ?? null
  const fallbackUsedStr = record.fallbackUsed ? '1' : '0'
  const fallbackCount = record.fallbackCount ?? 0
  let insertedId = -1

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('ticker', sql.NVarChar(20), record.ticker)
          .input('rec', sql.NVarChar(50), record.recommendation || 'Hold')
          .input('summary', sql.NVarChar(sql.MAX), summaryStr)
          .input('report', sql.NVarChar(sql.MAX), reportJson)
          .input('modelUsage', sql.NVarChar(4000), modelUsageStr)
          .input('primaryModels', sql.NVarChar(500), primaryModelsStr)
          .input('fallbackUsed', sql.NVarChar(10), fallbackUsedStr)
          .input('fallbackCount', sql.Int, fallbackCount)
          .query(`
            INSERT INTO analysis_records (ticker, recommendation, summary, full_report_json, model_usage, primary_models, fallback_used, fallback_count)
            VALUES (@ticker, @rec, @summary, @report, @modelUsage, @primaryModels, @fallbackUsed, @fallbackCount);
            SELECT SCOPE_IDENTITY() as id
          `)
        insertedId = Number(result.recordset[0]?.id ?? -1)
      } catch (e) {
        console.error('[AzureSQL] saveAnalysisRecord error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        const stmt = db.prepare(`
          INSERT INTO analysis_records (ticker, recommendation, summary, full_report_json, model_usage, primary_models, fallback_used, fallback_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const info = stmt.run(record.ticker, record.recommendation || 'Hold', summaryStr, reportJson, modelUsageStr, primaryModelsStr, fallbackUsedStr, fallbackCount)
        insertedId = Number(info.lastInsertRowid)
      } catch (e) {
        console.error('[SQLite] saveAnalysisRecord error:', e)
      }
    }
  }

  const id = insertedId > 0 ? insertedId : memoryIdCounter++
  memoryStore.unshift({
    id, ticker: record.ticker, recommendation: record.recommendation,
    summary: summaryStr, full_report_json: reportJson, created_at: nowStr,
    model_usage: modelUsageStr ?? undefined,
    primary_models: primaryModelsStr ?? undefined,
    fallback_used: fallbackUsedStr,
    fallback_count: fallbackCount,
  })
  return id
}

export async function getAnalysisRecords(limit: number = 20, symbol?: string): Promise<AnalysisRecord[]> {
  const cleanSymbol = symbol?.trim().toUpperCase()

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const req = pool.request()
        req.input('limit', sql.Int, limit)
        if (cleanSymbol) {
          req.input('pattern', sql.NVarChar(50), `%${cleanSymbol}%`)
          const result = await req.query(`
            SELECT TOP (@limit) id, ticker, recommendation, summary, full_report_json, model_usage, primary_models, fallback_used, fallback_count, created_at
            FROM analysis_records WHERE UPPER(ticker) LIKE @pattern ORDER BY id DESC
          `)
          return result.recordset as AnalysisRecord[]
        }
        const result = await req.query(`
          SELECT TOP (@limit) id, ticker, recommendation, summary, full_report_json, model_usage, primary_models, fallback_used, fallback_count, created_at
          FROM analysis_records ORDER BY id DESC
        `)
        return result.recordset as AnalysisRecord[]
      } catch (e) {
        console.error('[AzureSQL] getAnalysisRecords error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        if (cleanSymbol) {
          return db.prepare(`
            SELECT id, ticker, recommendation, summary, full_report_json, model_usage, primary_models, fallback_used, fallback_count, created_at
            FROM analysis_records WHERE UPPER(ticker) LIKE ? ORDER BY id DESC LIMIT ?
          `).all(`%${cleanSymbol}%`, limit) as AnalysisRecord[]
        }
        return db.prepare(`
          SELECT id, ticker, recommendation, summary, full_report_json, model_usage, primary_models, fallback_used, fallback_count, created_at
          FROM analysis_records ORDER BY id DESC LIMIT ?
        `).all(limit) as AnalysisRecord[]
      } catch (e) {
        console.error('[SQLite] getAnalysisRecords error:', e)
      }
    }
  }

  if (cleanSymbol) {
    return memoryStore.filter(r => r.ticker.toUpperCase().includes(cleanSymbol)).slice(0, limit)
  }
  return memoryStore.slice(0, limit)
}

// ─── Analysis Jobs（跑多少看多少＋斷點續跑）────────────────────────
export type AnalysisJobStatus = 'running' | 'partial' | 'completed' | 'failed'

/** 單一 agent 的執行狀態（存於 analysis_jobs.agent_states JSON） */
export interface AnalysisJobAgentState {
  state: 'completed' | 'failed' | 'pending'
  reportField?: string
  content?: string
  error?: string
}

export interface AnalysisJobRow {
  id: number
  user_id: number
  ticker: string
  date: string
  status: AnalysisJobStatus
  enabled_agents: string
  agent_states: string
  state_snapshot: string
  failed_agent?: string | null
  error?: string | null
  created_at?: string
  updated_at?: string
}

export interface AnalysisJobInput {
  userId: number
  ticker: string
  date: string
  enabledAgents: string[]
}

export interface AnalysisJobUpdate {
  status?: AnalysisJobStatus
  agentStates?: Record<string, AnalysisJobAgentState>
  stateSnapshot?: any
  failedAgent?: string
  error?: string
}

export async function saveAnalysisJob(job: AnalysisJobInput): Promise<number> {
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const enabledAgentsStr = JSON.stringify(job.enabledAgents ?? [])
  let insertedId = -1

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('userId', sql.Int, job.userId)
          .input('ticker', sql.NVarChar(40), job.ticker)
          .input('date', sql.NVarChar(20), job.date)
          .input('enabledAgents', sql.NVarChar(sql.MAX), enabledAgentsStr)
          .query(`
            INSERT INTO analysis_jobs (user_id, ticker, date, status, enabled_agents, agent_states, state_snapshot, created_at, updated_at)
            VALUES (@userId, @ticker, @date, 'running', @enabledAgents, '{}', '{}', GETDATE(), GETDATE());
            SELECT SCOPE_IDENTITY() as id
          `)
        insertedId = Number(result.recordset[0]?.id ?? -1)
      } catch (e) {
        console.error('[AzureSQL] saveAnalysisJob error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        const stmt = db.prepare(`
          INSERT INTO analysis_jobs (user_id, ticker, date, status, enabled_agents, agent_states, state_snapshot, created_at, updated_at)
          VALUES (?, ?, ?, 'running', ?, '{}', '{}', ?, ?)
        `)
        const info = stmt.run(job.userId, job.ticker, job.date, enabledAgentsStr, nowStr, nowStr)
        insertedId = Number(info.lastInsertRowid)
      } catch (e) {
        console.error('[SQLite] saveAnalysisJob error:', e)
      }
    }
  }

  return insertedId > 0 ? insertedId : -1
}

export async function updateAnalysisJob(jobId: number, patch: AnalysisJobUpdate): Promise<boolean> {
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const cls: string[] = []
  const params: any[] = []

  if (patch.status !== undefined) {
    cls.push('status = ?')
    params.push(patch.status)
  }
  if (patch.agentStates !== undefined) {
    cls.push('agent_states = ?')
    params.push(JSON.stringify(patch.agentStates))
  }
  if (patch.stateSnapshot !== undefined) {
    cls.push('state_snapshot = ?')
    params.push(JSON.stringify(patch.stateSnapshot))
  }
  if (patch.failedAgent !== undefined) {
    cls.push('failed_agent = ?')
    params.push(patch.failedAgent)
  }
  if (patch.error !== undefined) {
    cls.push('error = ?')
    params.push(patch.error)
  }

  if (cls.length === 0) return true
  cls.push('updated_at = ?')
  params.push(nowStr)
  params.push(jobId)

  const setClause = cls.join(', ')

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return false
    try {
      const req = pool.request()
      const azureClauses: string[] = []
      if (patch.status !== undefined) { req.input('status', sql.NVarChar(20), patch.status); azureClauses.push('status = @status') }
      if (patch.agentStates !== undefined) { req.input('agentStates', sql.NVarChar(sql.MAX), JSON.stringify(patch.agentStates)); azureClauses.push('agent_states = @agentStates') }
      if (patch.stateSnapshot !== undefined) { req.input('stateSnapshot', sql.NVarChar(sql.MAX), JSON.stringify(patch.stateSnapshot)); azureClauses.push('state_snapshot = @stateSnapshot') }
      if (patch.failedAgent !== undefined) { req.input('failedAgent', sql.NVarChar(80), patch.failedAgent); azureClauses.push('failed_agent = @failedAgent') }
      if (patch.error !== undefined) { req.input('error', sql.NVarChar(sql.MAX), patch.error); azureClauses.push('error = @error') }
      azureClauses.push('updated_at = @updatedAt')
      req.input('updatedAt', sql.DateTime2, new Date())
      req.input('jobId', sql.Int, jobId)
      await req.query(`
        UPDATE analysis_jobs SET ${azureClauses.join(', ')} WHERE id = @jobId
      `)
      return true
    } catch (e) {
      console.error('[AzureSQL] updateAnalysisJob error:', e)
      return false
    }
  }

  const db = getSqliteDb()
  if (!db) return false
  try {
    db.prepare(`UPDATE analysis_jobs SET ${setClause} WHERE id = ?`).run(...params)
    return true
  } catch (e) {
    console.error('[SQLite] updateAnalysisJob error:', e)
    return false
  }
}

export async function getAnalysisJobById(jobId: number): Promise<AnalysisJobRow | null> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('jobId', sql.Int, jobId)
          .query(`
            SELECT id, user_id, ticker, date, status, enabled_agents, agent_states, state_snapshot, failed_agent, error, created_at, updated_at
            FROM analysis_jobs WHERE id = @jobId
          `)
        const row = result.recordset[0]
        if (row) return row as AnalysisJobRow
      } catch (e) {
        console.error('[AzureSQL] getAnalysisJobById error:', e)
      }
    }
    return null
  }

  const db = getSqliteDb()
  if (!db) return null
  try {
    const row = db.prepare(`
      SELECT id, user_id, ticker, date, status, enabled_agents, agent_states, state_snapshot, failed_agent, error, created_at, updated_at
      FROM analysis_jobs WHERE id = ?
    `).get(jobId) as AnalysisJobRow | undefined
    return row ?? null
  } catch (e) {
    console.error('[SQLite] getAnalysisJobById error:', e)
    return null
  }
}

// ─── Arena tick jobs（非同步分段 tick）─────────────────────────────

export interface ArenaTickJobRow {
  id: number
  round_date: string
  phase: string          // premarket | slot | close
  slot: number | null
  status: 'running' | 'done' | 'failed'
  result: string | null  // JSON：ArenaTickResult（done 時寫入）
  error: string | null   // 失敗訊息（failed 時寫入）
  created_at?: string
  updated_at?: string
}

export interface ArenaTickJobInput {
  roundDate: string
  phase: string
  slot?: number | null
}

export async function saveArenaTickJob(job: ArenaTickJobInput): Promise<number> {
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19)
  let insertedId = -1

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('roundDate', sql.NVarChar(20), job.roundDate)
          .input('phase', sql.NVarChar(40), job.phase)
          .input('slot', sql.Int, job.slot ?? null)
          .query(`
            INSERT INTO arena_tick_jobs (round_date, phase, slot, status, created_at, updated_at)
            OUTPUT INSERTED.id
            VALUES (@roundDate, @phase, @slot, 'running', GETDATE(), GETDATE())
          `)
        insertedId = Number(result.recordset[0]?.id ?? -1)
      } catch (e) {
        console.error('[AzureSQL] saveArenaTickJob error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        const stmt = db.prepare(`
          INSERT INTO arena_tick_jobs (round_date, phase, slot, status, created_at, updated_at)
          VALUES (?, ?, ?, 'running', ?, ?)
        `)
        const info = stmt.run(job.roundDate, job.phase, job.slot ?? null, nowStr, nowStr)
        insertedId = Number(info.lastInsertRowid)
      } catch (e) {
        console.error('[SQLite] saveArenaTickJob error:', e)
      }
    }
  }

  return insertedId > 0 ? insertedId : -1
}

export interface ArenaTickJobUpdate {
  status?: 'running' | 'done' | 'failed'
  result?: string
  error?: string
}

export async function updateArenaTickJob(jobId: number, patch: ArenaTickJobUpdate): Promise<boolean> {
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const sets: string[] = []
  const params: any[] = []

  if (patch.status !== undefined) {
    sets.push('status = ?')
    params.push(patch.status)
  }
  if (patch.result !== undefined) {
    sets.push('result = ?')
    params.push(patch.result)
  }
  if (patch.error !== undefined) {
    sets.push('error = ?')
    params.push(patch.error)
  }
  if (sets.length === 0) return true
  sets.push('updated_at = ?')
  params.push(nowStr, jobId)

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return false
    try {
      const req = pool.request()
      const azureSets: string[] = []
      if (patch.status !== undefined) {
        req.input('status', sql.NVarChar(20), patch.status)
        azureSets.push('status = @status')
      }
      if (patch.result !== undefined) {
        req.input('result', sql.NVarChar(sql.MAX), patch.result)
        azureSets.push('result = @result')
      }
      if (patch.error !== undefined) {
        req.input('error', sql.NVarChar(sql.MAX), patch.error)
        azureSets.push('error = @error')
      }
      azureSets.push('updated_at = @updatedAt')
      req.input('updatedAt', sql.DateTime2, new Date())
      req.input('jobId', sql.Int, jobId)
      await req.query(`UPDATE arena_tick_jobs SET ${azureSets.join(', ')} WHERE id = @jobId`)
      return true
    } catch (e) {
      console.error('[AzureSQL] updateArenaTickJob error:', e)
      return false
    }
  }

  const db = getSqliteDb()
  if (!db) return false
  try {
    db.prepare(`UPDATE arena_tick_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return true
  } catch (e) {
    console.error('[SQLite] updateArenaTickJob error:', e)
    return false
  }
}

export async function getArenaTickJobById(jobId: number): Promise<ArenaTickJobRow | null> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('jobId', sql.Int, jobId)
          .query(`
            SELECT id, round_date, phase, slot, status, result, error, created_at, updated_at
            FROM arena_tick_jobs WHERE id = @jobId
          `)
        const row = result.recordset[0]
        if (row) return row as unknown as ArenaTickJobRow
      } catch (e) {
        console.error('[AzureSQL] getArenaTickJobById error:', e)
      }
    }
    return null
  }

  const db = getSqliteDb()
  if (!db) return null
  try {
    const row = db.prepare(`
      SELECT id, round_date, phase, slot, status, result, error, created_at, updated_at
      FROM arena_tick_jobs WHERE id = ?
    `).get(jobId) as ArenaTickJobRow | undefined
    return row ?? null
  } catch (e) {
    console.error('[SQLite] getArenaTickJobById error:', e)
    return null
  }
}

/**
 * 去重查詢：同 (round_date, phase, slot) 是否存在仍 running 的 job。
 * startArenaTickJob 依此避免同一分段被重疊執行（M3）。
 */
export async function findRunningArenaTickJob(
  roundDate: string,
  phase: string,
  slot: number | null = null,
): Promise<ArenaTickJobRow | null> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const req = pool.request()
          .input('roundDate', sql.NVarChar(20), roundDate)
          .input('phase', sql.NVarChar(40), phase)
        const slotClause = slot !== null ? 'AND slot = @slot' : 'AND slot IS NULL'
        if (slot !== null) req.input('slot', sql.Int, slot)
        const result = await req.query(`
            SELECT TOP (1) id, round_date, phase, slot, status, result, error, created_at, updated_at
            FROM arena_tick_jobs
            WHERE round_date = @roundDate AND phase = @phase ${slotClause} AND status = 'running'
            ORDER BY id DESC
          `)
        const row = result.recordset[0]
        if (row) return row as unknown as ArenaTickJobRow
      } catch (e) {
        console.error('[AzureSQL] findRunningArenaTickJob error:', e)
      }
    }
    return null
  }

  const db = getSqliteDb()
  if (!db) return null
  try {
    const slotClause = slot !== null ? 'AND slot = ?' : 'AND slot IS NULL'
    const row = db.prepare(`
      SELECT id, round_date, phase, slot, status, result, error, created_at, updated_at
      FROM arena_tick_jobs
      WHERE round_date = ? AND phase = ? ${slotClause} AND status = 'running'
      ORDER BY id DESC LIMIT 1
    `).get(...[roundDate, phase, ...(slot !== null ? [slot] : [])]) as ArenaTickJobRow | undefined
    return row ?? null
  } catch (e) {
    console.error('[SQLite] findRunningArenaTickJob error:', e)
    return null
  }
}

/** 清理超過 retentionDays（預設 7）天前已結束（done/failed）的 tick job，回傳刪除筆數。 */
export async function cleanupArenaTickJobs(retentionDays = 7): Promise<number> {
  try {
    const n = Math.max(1, Math.floor(retentionDays))
    let deleted = 0
    if (isAzureSql) {
      const pool = await getAzurePool()
      if (!pool) return 0
      const r = await pool
        .request()
        .input('days', sql.Int, n)
        .query(`
          DELETE FROM arena_tick_jobs
          WHERE status IN ('done', 'failed')
            AND updated_at < DATEADD(day, -@days, GETDATE());
          SELECT @@ROWCOUNT AS n
        `)
      deleted = r.recordset?.[0]?.n ?? 0
    } else {
      const db = getSqliteDb()
      if (!db) return 0
      const r = db
        .prepare(
          `DELETE FROM arena_tick_jobs
           WHERE status IN ('done', 'failed')
             AND updated_at < datetime('now','localtime','-${n} days')`,
        )
        .run()
      deleted = r.changes
    }
    return deleted
  } catch (e) {
    console.error('[DB] cleanupArenaTickJobs failed:', e)
    return 0
  }
}

export async function listAnalysisJobsByUser(userId: number, limit: number = 20): Promise<AnalysisJobRow[]> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('userId', sql.Int, userId)
          .input('limit', sql.Int, limit)
          .query(`
            SELECT TOP (@limit) id, user_id, ticker, date, status, enabled_agents, agent_states, state_snapshot, failed_agent, error, created_at, updated_at
            FROM analysis_jobs WHERE user_id = @userId ORDER BY id DESC
          `)
        return (result.recordset ?? []) as AnalysisJobRow[]
      } catch (e) {
        console.error('[AzureSQL] listAnalysisJobsByUser error:', e)
      }
    }
    return []
  }

  const db = getSqliteDb()
  if (!db) return []
  try {
    return db.prepare(`
      SELECT id, user_id, ticker, date, status, enabled_agents, agent_states, state_snapshot, failed_agent, error, created_at, updated_at
      FROM analysis_jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?
    `).all(userId, limit) as AnalysisJobRow[]
  } catch (e) {
    console.error('[SQLite] listAnalysisJobsByUser error:', e)
    return []
  }
}

// ─── Portfolio Records ───────────────────────────────────────────
export interface PortfolioRecord {
  id?: number
  user_id: number
  guest_uid?: string | null
  market: 'tw' | 'us'
  symbol: string
  symbol_name?: string | null
  shares: number
  cost: number
  current_price: number
  dividend: number
  cost_basis: number
  market_value: number
  unrealized_pnl: number
  unrealized_pnl_pct: number
  total_return: number
  total_return_pct: number
  yield_on_cost: number
  strategy?: string | null
  recommendation?: string | null
  summary?: string | null
  report_json?: string | null
  price_synced_at?: string | null
  created_at?: string
}

export interface PortfolioRecordInput {
  user_id: number
  guestUid?: string | null
  market: 'tw' | 'us'
  symbol: string
  symbolName?: string | null
  shares: number
  cost: number
  currentPrice: number
  dividend: number
  costBasis: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  totalReturn: number
  totalReturnPct: number
  yieldOnCost: number
  strategy?: string | null
  recommendation?: string | null
  summary?: string | null
  reportJson?: string | null
}

const PORTFOLIO_COLUMNS =
  'id, user_id, guest_uid, market, symbol, symbol_name, shares, cost, current_price, dividend, cost_basis, market_value, ' +
  'unrealized_pnl, unrealized_pnl_pct, total_return, total_return_pct, yield_on_cost, strategy, recommendation, summary, report_json, price_synced_at, created_at'

export async function savePortfolioRecord(record: PortfolioRecordInput): Promise<number> {
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const reportStr = record.reportJson ?? null
  const summaryStr = record.summary ?? null
  const strategyStr = record.strategy ?? null
  const recommendationStr = record.recommendation ?? null
  const symbolName = record.symbolName ?? null
  let insertedId = -1

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('userId', sql.Int, record.user_id)
          .input('guestUid', sql.NVarChar(64), record.guestUid ?? null)
          .input('market', sql.NVarChar(10), record.market)
          .input('symbol', sql.NVarChar(30), record.symbol)
          .input('symbolName', sql.NVarChar(255), symbolName)
          .input('shares', sql.Float, record.shares)
          .input('cost', sql.Float, record.cost)
          .input('currentPrice', sql.Float, record.currentPrice)
          .input('dividend', sql.Float, record.dividend)
          .input('costBasis', sql.Float, record.costBasis)
          .input('marketValue', sql.Float, record.marketValue)
          .input('pnl', sql.Float, record.unrealizedPnl)
          .input('pnlPct', sql.Float, record.unrealizedPnlPct)
          .input('totalReturn', sql.Float, record.totalReturn)
          .input('totalReturnPct', sql.Float, record.totalReturnPct)
          .input('yieldOnCost', sql.Float, record.yieldOnCost)
          .input('strategy', sql.NVarChar(50), strategyStr)
          .input('recommendation', sql.NVarChar(20), recommendationStr)
          .input('summary', sql.NVarChar(sql.MAX), summaryStr)
          .input('report', sql.NVarChar(sql.MAX), reportStr)
          .query(`
            INSERT INTO portfolio_records (
              user_id, guest_uid, market, symbol, symbol_name, shares, cost, current_price, dividend, cost_basis, market_value,
              unrealized_pnl, unrealized_pnl_pct, total_return, total_return_pct, yield_on_cost, strategy, recommendation, summary, report_json
            ) VALUES (
              @userId, @guestUid, @market, @symbol, @symbolName, @shares, @cost, @currentPrice, @dividend, @costBasis, @marketValue,
              @pnl, @pnlPct, @totalReturn, @totalReturnPct, @yieldOnCost, @strategy, @recommendation, @summary, @report
            );
            SELECT SCOPE_IDENTITY() AS id
          `)
        insertedId = Number(result.recordset?.[0]?.id ?? -1)
      } catch (e) {
        console.error('[AzureSQL] savePortfolioRecord error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        const info = db.prepare(`
          INSERT INTO portfolio_records (
            user_id, guest_uid, market, symbol, symbol_name, shares, cost, current_price, dividend, cost_basis, market_value,
            unrealized_pnl, unrealized_pnl_pct, total_return, total_return_pct, yield_on_cost, strategy, recommendation, summary, report_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.user_id, record.guestUid ?? null, record.market, record.symbol, symbolName, record.shares, record.cost,
          record.currentPrice, record.dividend, record.costBasis, record.marketValue, record.unrealizedPnl,
          record.unrealizedPnlPct, record.totalReturn, record.totalReturnPct, record.yieldOnCost, strategyStr,
          recommendationStr, summaryStr, reportStr,
        )
        insertedId = Number(info.lastInsertRowid)
      } catch (e) {
        console.error('[SQLite] savePortfolioRecord error:', e)
      }
    }
  }

  const id = insertedId > 0 ? insertedId : portfolioMemoryIdCounter++
  const row: PortfolioRecord = {
    id,
    user_id: record.user_id,
    guest_uid: record.guestUid ?? null,
    market: record.market,
    symbol: record.symbol,
    symbol_name: symbolName,
    shares: record.shares,
    cost: record.cost,
    current_price: record.currentPrice,
    dividend: record.dividend,
    cost_basis: record.costBasis,
    market_value: record.marketValue,
    unrealized_pnl: record.unrealizedPnl,
    unrealized_pnl_pct: record.unrealizedPnlPct,
    total_return: record.totalReturn,
    total_return_pct: record.totalReturnPct,
    yield_on_cost: record.yieldOnCost,
    strategy: strategyStr,
    recommendation: recommendationStr,
    summary: summaryStr,
    report_json: reportStr,
    price_synced_at: null,
    created_at: nowStr,
  }
  portfolioMemoryStore.unshift(row)
  return id
}

/** 查訪客（匿名）損益紀錄：依 guest_uid 過濾，與登入使用者資料完全隔離。 */
export async function getPortfolioRecordsByGuest(guestUid: string, limit: number = 20): Promise<PortfolioRecord[]> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('guestUid', sql.NVarChar(64), guestUid)
          .input('limit', sql.Int, limit)
          .query(`
            SELECT TOP (@limit) ${PORTFOLIO_COLUMNS}
            FROM portfolio_records WHERE guest_uid = @guestUid ORDER BY id DESC
          `)
        return result.recordset as PortfolioRecord[]
      } catch (e) {
        console.error('[AzureSQL] getPortfolioRecordsByGuest error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        return db.prepare(`
          SELECT ${PORTFOLIO_COLUMNS}
          FROM portfolio_records WHERE guest_uid = ? ORDER BY id DESC LIMIT ?
        `).all(guestUid, limit) as PortfolioRecord[]
      } catch (e) {
        console.error('[SQLite] getPortfolioRecordsByGuest error:', e)
      }
    }
  }

  return portfolioMemoryStore.filter(r => r.guest_uid === guestUid).slice(0, limit)
}

// ─── Claim Codes（訪客認領碼）────────────────────────────────────
const claimMemoryStore = new Map<string, string>()

/** 存入認領碼（只存 hash，不存明文）。 */
export async function saveClaimCode(guestUid: string, codeHash: string): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        await pool.request()
          .input('codeHash', sql.NVarChar(64), codeHash)
          .input('guestUid', sql.NVarChar(64), guestUid)
          .query('INSERT INTO claim_codes (code_hash, guest_uid) VALUES (@codeHash, @guestUid)')
        return
      } catch (e) {
        console.error('[AzureSQL] saveClaimCode error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        db.prepare('INSERT INTO claim_codes (code_hash, guest_uid) VALUES (?, ?)').run(codeHash, guestUid)
        return
      } catch (e) {
        console.error('[SQLite] saveClaimCode error:', e)
      }
    }
  }
  claimMemoryStore.set(codeHash, guestUid)
}

/** 依認領碼 hash 找回對應的 guest_uid（無則 null）。 */
export async function findGuestByClaimCode(codeHash: string): Promise<string | null> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('codeHash', sql.NVarChar(64), codeHash)
          .query('SELECT TOP (1) guest_uid FROM claim_codes WHERE code_hash = @codeHash')
        return result.recordset?.[0]?.guest_uid ?? null
      } catch (e) {
        console.error('[AzureSQL] findGuestByClaimCode error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        const row = db.prepare('SELECT guest_uid FROM claim_codes WHERE code_hash = ?').get(codeHash)
        return (row as { guest_uid?: string } | undefined)?.guest_uid ?? null
      } catch (e) {
        console.error('[SQLite] findGuestByClaimCode error:', e)
      }
    }
  }
  return claimMemoryStore.get(codeHash) ?? null
}

/** 兌換認領碼時，把本機（fromGid）既有的訪客紀錄改掛到認領的 workspace（toGid）。 */
export async function reassignGuestRecords(fromGid: string, toGid: string): Promise<void> {
  if (fromGid === toGid) return
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        await pool.request()
          .input('fromGid', sql.NVarChar(64), fromGid)
          .input('toGid', sql.NVarChar(64), toGid)
          .query('UPDATE portfolio_records SET guest_uid = @toGid WHERE guest_uid = @fromGid AND user_id = 0')
        return
      } catch (e) {
        console.error('[AzureSQL] reassignGuestRecords error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        db.prepare('UPDATE portfolio_records SET guest_uid = ? WHERE guest_uid = ? AND user_id = 0').run(toGid, fromGid)
        return
      } catch (e) {
        console.error('[SQLite] reassignGuestRecords error:', e)
      }
    }
  }
  for (const row of portfolioMemoryStore) {
    if (row.guest_uid === fromGid && row.user_id === 0) row.guest_uid = toGid
  }
}

export async function getPortfolioRecords(userId: number, limit: number = 20): Promise<PortfolioRecord[]> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('userId', sql.Int, userId)
          .input('limit', sql.Int, limit)
          .query(`
            SELECT TOP (@limit) ${PORTFOLIO_COLUMNS}
            FROM portfolio_records WHERE user_id = @userId ORDER BY id DESC
          `)
        return result.recordset as PortfolioRecord[]
      } catch (e) {
        console.error('[AzureSQL] getPortfolioRecords error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        return db.prepare(`
          SELECT ${PORTFOLIO_COLUMNS}
          FROM portfolio_records WHERE user_id = ? ORDER BY id DESC LIMIT ?
        `).all(userId, limit) as PortfolioRecord[]
      } catch (e) {
        console.error('[SQLite] getPortfolioRecords error:', e)
      }
    }
  }
  return portfolioMemoryStore.filter(r => r.user_id === userId).slice(0, limit)
}

/**
 * 刪除一筆持股紀錄（限本人，Issue #25）。
 * 沿用 deleteTradeJournalEntry 模式：WHERE 同時限定 id ＋ user_id，
 * 他人 id 刪不到（回 false → API 層回 404，避免洩漏存在性）。
 */
export async function deletePortfolioRecord(id: number, userId: number): Promise<boolean> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('id', sql.Int, id)
          .input('userId', sql.Int, userId)
          .query('DELETE FROM portfolio_records WHERE id = @id AND user_id = @userId')
        return (result.rowsAffected[0] ?? 0) > 0
      } catch (e) {
        console.error('[AzureSQL] deletePortfolioRecord error:', e)
        return false
      }
    }
    return false
  }
  const db = getSqliteDb()
  if (db) {
    try {
      const info = db.prepare('DELETE FROM portfolio_records WHERE id = ? AND user_id = ?').run(id, userId)
      if (info.changes > 0) return true
    } catch (e) {
      console.error('[SQLite] deletePortfolioRecord error:', e)
      return false
    }
  }
  const idx = portfolioMemoryStore.findIndex(r => r.id === id && r.user_id === userId)
  if (idx >= 0) {
    portfolioMemoryStore.splice(idx, 1)
    return true
  }
  return false
}

export interface PortfolioRecordUpdate {
  market: 'tw' | 'us'
  symbol: string
  symbolName?: string | null
  shares: number
  cost: number
  currentPrice: number
  dividend: number
  costBasis: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  totalReturn: number
  totalReturnPct: number
  yieldOnCost: number
  strategy?: string | null
}

/**
 * 更新一筆持股紀錄（限本人，Issue #26）。
 * 沿用 updateTradeJournalEntry／deletePortfolioRecord 模式：WHERE 同時限定 id ＋ user_id，
 * 他人 id 更新不到（回 false → API 層回 404，避免洩漏存在性）。
 */
export async function updatePortfolioRecord(
  id: number,
  userId: number,
  patch: PortfolioRecordUpdate,
): Promise<boolean> {
  const symbolName = patch.symbolName ?? null
  const strategyStr = patch.strategy ?? null
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return false
    try {
      const result = await pool.request()
        .input('id', sql.Int, id)
        .input('userId', sql.Int, userId)
        .input('market', sql.NVarChar(10), patch.market)
        .input('symbol', sql.NVarChar(30), patch.symbol)
        .input('symbolName', sql.NVarChar(255), symbolName)
        .input('shares', sql.Float, patch.shares)
        .input('cost', sql.Float, patch.cost)
        .input('currentPrice', sql.Float, patch.currentPrice)
        .input('dividend', sql.Float, patch.dividend)
        .input('costBasis', sql.Float, patch.costBasis)
        .input('marketValue', sql.Float, patch.marketValue)
        .input('pnl', sql.Float, patch.unrealizedPnl)
        .input('pnlPct', sql.Float, patch.unrealizedPnlPct)
        .input('totalReturn', sql.Float, patch.totalReturn)
        .input('totalReturnPct', sql.Float, patch.totalReturnPct)
        .input('yieldOnCost', sql.Float, patch.yieldOnCost)
        .input('strategy', sql.NVarChar(50), strategyStr)
        .query(`
          UPDATE portfolio_records SET
            market = @market, symbol = @symbol, symbol_name = @symbolName,
            shares = @shares, cost = @cost, current_price = @currentPrice, dividend = @dividend,
            cost_basis = @costBasis, market_value = @marketValue,
            unrealized_pnl = @pnl, unrealized_pnl_pct = @pnlPct,
            total_return = @totalReturn, total_return_pct = @totalReturnPct,
            yield_on_cost = @yieldOnCost, strategy = @strategy
          WHERE id = @id AND user_id = @userId
        `)
      return (result.rowsAffected[0] ?? 0) > 0
    } catch (e) {
      console.error('[AzureSQL] updatePortfolioRecord error:', e)
      return false
    }
  }
  const db = getSqliteDb()
  if (db) {
    try {
      const info = db.prepare(`
        UPDATE portfolio_records SET
          market = ?, symbol = ?, symbol_name = ?,
          shares = ?, cost = ?, current_price = ?, dividend = ?,
          cost_basis = ?, market_value = ?,
          unrealized_pnl = ?, unrealized_pnl_pct = ?,
          total_return = ?, total_return_pct = ?,
          yield_on_cost = ?, strategy = ?
        WHERE id = ? AND user_id = ?
      `).run(
        patch.market, patch.symbol, symbolName,
        patch.shares, patch.cost, patch.currentPrice, patch.dividend,
        patch.costBasis, patch.marketValue,
        patch.unrealizedPnl, patch.unrealizedPnlPct,
        patch.totalReturn, patch.totalReturnPct,
        patch.yieldOnCost, strategyStr,
        id, userId,
      )
      if (info.changes > 0) return true
    } catch (e) {
      console.error('[SQLite] updatePortfolioRecord error:', e)
      return false
    }
  }
  const row = portfolioMemoryStore.find(r => r.id === id && r.user_id === userId)
  if (!row) return false
  row.market = patch.market
  row.symbol = patch.symbol
  row.symbol_name = symbolName
  row.shares = patch.shares
  row.cost = patch.cost
  row.current_price = patch.currentPrice
  row.dividend = patch.dividend
  row.cost_basis = patch.costBasis
  row.market_value = patch.marketValue
  row.unrealized_pnl = patch.unrealizedPnl
  row.unrealized_pnl_pct = patch.unrealizedPnlPct
  row.total_return = patch.totalReturn
  row.total_return_pct = patch.totalReturnPct
  row.yield_on_cost = patch.yieldOnCost
  row.strategy = strategyStr
  return true
}

// ─── Portfolio 現價同步（Issue #33）───────────────────────────────────
// 只更新現價＋衍生欄位＋price_synced_at；dividend（使用者手填股息）絕不異動。

export interface PortfolioSyncedPricePatch {
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  totalReturn: number
  totalReturnPct: number
  /** 'YYYY-MM-DD HH:mm:ss'；呼叫端（sync route）統一產生，排程重跑冪等＝最後一次寫入為準。 */
  syncedAt: string
}

/**
 * 以現價覆寫一筆持倉（server-trusted：呼叫端已把 id 限定在持有人範圍內，故此處不做 owner 檢查）。
 * dividend／cost_basis／yield_on_cost 不碰。
 */
export async function updatePortfolioSyncedPrice(
  id: number,
  patch: PortfolioSyncedPricePatch,
): Promise<boolean> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return false
    try {
      const result = await pool.request()
        .input('id', sql.Int, id)
        .input('currentPrice', sql.Float, patch.currentPrice)
        .input('marketValue', sql.Float, patch.marketValue)
        .input('pnl', sql.Float, patch.unrealizedPnl)
        .input('pnlPct', sql.Float, patch.unrealizedPnlPct)
        .input('totalReturn', sql.Float, patch.totalReturn)
        .input('totalReturnPct', sql.Float, patch.totalReturnPct)
        .input('syncedAt', sql.NVarChar(19), patch.syncedAt)
        .query(`
          UPDATE portfolio_records SET
            current_price = @currentPrice, market_value = @marketValue,
            unrealized_pnl = @pnl, unrealized_pnl_pct = @pnlPct,
            total_return = @totalReturn, total_return_pct = @totalReturnPct,
            price_synced_at = @syncedAt
          WHERE id = @id
        `)
      return (result.rowsAffected[0] ?? 0) > 0
    } catch (e) {
      console.error('[AzureSQL] updatePortfolioSyncedPrice error:', e)
      return false
    }
  }
  const db = getSqliteDb()
  if (db) {
    try {
      const info = db.prepare(`
        UPDATE portfolio_records SET
          current_price = ?, market_value = ?,
          unrealized_pnl = ?, unrealized_pnl_pct = ?,
          total_return = ?, total_return_pct = ?,
          price_synced_at = ?
        WHERE id = ?
      `).run(
        patch.currentPrice, patch.marketValue,
        patch.unrealizedPnl, patch.unrealizedPnlPct,
        patch.totalReturn, patch.totalReturnPct,
        patch.syncedAt,
        id,
      )
      if (info.changes > 0) return true
    } catch (e) {
      console.error('[SQLite] updatePortfolioSyncedPrice error:', e)
      return false
    }
  }
  const row = portfolioMemoryStore.find(r => r.id === id)
  if (!row) return false
  row.current_price = patch.currentPrice
  row.market_value = patch.marketValue
  row.unrealized_pnl = patch.unrealizedPnl
  row.unrealized_pnl_pct = patch.unrealizedPnlPct
  row.total_return = patch.totalReturn
  row.total_return_pct = patch.totalReturnPct
  row.price_synced_at = patch.syncedAt
  return true
}

export interface PortfolioSyncTarget {
  id: number
  user_id: number
  guest_uid?: string | null
  market: 'tw' | 'us'
  symbol: string
  shares: number
  cost: number
  dividend: number
}

/** 排程全掃用：id 升冪分頁（limit／offset），呼叫端以 MAX_SYNC_RECORDS_PER_RUN 封頂。 */
export async function listPortfolioRecordsForSync(limit: number = 200, offset: number = 0): Promise<PortfolioSyncTarget[]> {
  const cols = 'id, user_id, guest_uid, market, symbol, shares, cost, dividend'
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('limit', sql.Int, limit)
          .input('offset', sql.Int, offset)
          .query(`
            SELECT ${cols} FROM portfolio_records
            ORDER BY id ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
          `)
        return result.recordset as PortfolioSyncTarget[]
      } catch (e) {
        console.error('[AzureSQL] listPortfolioRecordsForSync error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        return db.prepare(`
          SELECT ${cols} FROM portfolio_records ORDER BY id ASC LIMIT ? OFFSET ?
        `).all(limit, offset) as PortfolioSyncTarget[]
      } catch (e) {
        console.error('[SQLite] listPortfolioRecordsForSync error:', e)
      }
    }
  }
  return portfolioMemoryStore.slice(offset, offset + limit).map(r => ({
    id: r.id!, user_id: r.user_id, guest_uid: r.guest_uid, market: r.market,
    symbol: r.symbol, shares: r.shares, cost: r.cost, dividend: r.dividend,
  }))
}

// ─── TWSE 除息快取（Issue #35，TWT48U）─────────────────────────────
export interface TwseDividendRow {
  id?: number
  symbol: string
  /** 除息日 'YYYY-MM-DD'（即 TWT48U date 參數所指日期，YTD 以此歸屬年份）。 */
  ex_date: string
  /** 每股現金股利（元）。 */
  cash_dividend: number
  created_at?: string
}

export interface TwseDividendInput {
  symbol: string
  ex_date: string
  cash_dividend: number
}

const TWSE_DIVIDEND_COLUMNS = 'id, symbol, ex_date, cash_dividend, created_at'

function normalizeTwseDividendInput(r: TwseDividendInput): TwseDividendInput | null {
  const symbol = (r.symbol ?? '').trim().toUpperCase()
  const exDate = (r.ex_date ?? '').trim()
  const cash = Number(r.cash_dividend)
  if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(exDate)) return null
  if (!Number.isFinite(cash) || cash < 0) return null
  return { symbol, ex_date: exDate, cash_dividend: cash }
}

/**
 * 寫入除息快取（UNIQUE(symbol, ex_date) 冪等：重抓直接覆寫，不產生重複列）。
 * 回傳實際寫入筆數（非法列直接略過，不 throw、不擋主流程）。
 */
export async function upsertTwseDividends(rows: TwseDividendInput[]): Promise<number> {
  const clean = rows.map(normalizeTwseDividendInput).filter((r): r is TwseDividendInput => r != null)
  if (clean.length === 0) return 0
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      let written = 0
      for (const r of clean) {
        try {
          await pool.request()
            .input('symbol', sql.NVarChar(30), r.symbol)
            .input('exDate', sql.NVarChar(20), r.ex_date)
            .input('cash', sql.Float, r.cash_dividend)
            .query(`
              IF EXISTS (SELECT 1 FROM twse_dividends WHERE symbol = @symbol AND ex_date = @exDate)
                UPDATE twse_dividends SET cash_dividend = @cash WHERE symbol = @symbol AND ex_date = @exDate
              ELSE
                INSERT INTO twse_dividends (symbol, ex_date, cash_dividend) VALUES (@symbol, @exDate, @cash)
            `)
          written++
        } catch (e) {
          console.error('[AzureSQL] upsertTwseDividends error:', e)
        }
      }
      return written
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        const stmt = db.prepare(`
          INSERT INTO twse_dividends (symbol, ex_date, cash_dividend)
          VALUES (?, ?, ?)
          ON CONFLICT(symbol, ex_date) DO UPDATE SET cash_dividend = excluded.cash_dividend
        `)
        const tx = db.transaction((list: TwseDividendInput[]) => {
          for (const r of list) stmt.run(r.symbol, r.ex_date, r.cash_dividend)
        })
        tx(clean)
        return clean.length
      } catch (e) {
        console.error('[SQLite] upsertTwseDividends error:', e)
        return 0
      }
    }
  }
  // 記憶體兜底（同鍵覆寫）。
  for (const r of clean) {
    const idx = twseDividendMemoryStore.findIndex(m => m.symbol === r.symbol && m.ex_date === r.ex_date)
    if (idx >= 0) twseDividendMemoryStore[idx] = { ...twseDividendMemoryStore[idx], cash_dividend: r.cash_dividend }
    else twseDividendMemoryStore.push({ id: twseDividendMemoryStore.length + 1, ...r })
  }
  return clean.length
}

/** 取某年全部除息快取（ex_date LIKE 'YYYY-%'），供 YTD 估算。 */
export async function getTwseDividendsByYear(year: string): Promise<TwseDividendRow[]> {
  if (!/^\d{4}$/.test(year)) return []
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('prefix', sql.NVarChar(8), `${year}-%`)
          .query(`SELECT ${TWSE_DIVIDEND_COLUMNS} FROM twse_dividends WHERE ex_date LIKE @prefix ORDER BY ex_date ASC`)
        return result.recordset as TwseDividendRow[]
      } catch (e) {
        console.error('[AzureSQL] getTwseDividendsByYear error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        return db.prepare(
          `SELECT ${TWSE_DIVIDEND_COLUMNS} FROM twse_dividends WHERE ex_date LIKE ? ORDER BY ex_date ASC`,
        ).all(`${year}-%`) as TwseDividendRow[]
      } catch (e) {
        console.error('[SQLite] getTwseDividendsByYear error:', e)
      }
    }
  }
  return twseDividendMemoryStore
    .filter(m => m.ex_date.startsWith(`${year}-`))
    .sort((a, b) => (a.ex_date < b.ex_date ? -1 : 1))
}

/** 某除息日是否已有快取（排程／同步鈕「缺檔才抓」的判斷依據）。 */
export async function hasTwseDividendsForDate(exDate: string): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exDate)) return false
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('exDate', sql.NVarChar(20), exDate)
          .query('SELECT COUNT(*) AS cnt FROM twse_dividends WHERE ex_date = @exDate')
        return Number(result.recordset?.[0]?.cnt ?? 0) > 0
      } catch (e) {
        console.error('[AzureSQL] hasTwseDividendsForDate error:', e)
        return false
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        const row = db.prepare('SELECT COUNT(*) AS cnt FROM twse_dividends WHERE ex_date = ?').get(exDate) as { cnt: number }
        return Number(row?.cnt ?? 0) > 0
      } catch (e) {
        console.error('[SQLite] hasTwseDividendsForDate error:', e)
        return false
      }
    }
  }
  return twseDividendMemoryStore.some(m => m.ex_date === exDate)
}

// ─── Trade Journal（交易日誌，Issue #21）───────────────────────────
export type TradeJournalDirection = 'long' | 'short'

export interface TradeJournalEntry {
  id?: number
  user_id: number
  trade_date: string
  symbol: string
  direction: TradeJournalDirection
  entry_price: number
  exit_price: number
  shares: number
  reason: string
  stop_loss_obeyed: number
  created_at?: string
  updated_at?: string
}

export interface TradeJournalInput {
  userId: number
  tradeDate: string
  symbol: string
  direction: TradeJournalDirection
  entryPrice: number
  exitPrice: number
  shares: number
  reason: string
  stopLossObeyed: boolean
}

const TRADE_JOURNAL_COLUMNS =
  'id, user_id, trade_date, symbol, direction, entry_price, exit_price, shares, reason, stop_loss_obeyed, created_at, updated_at'

export async function saveTradeJournalEntry(input: TradeJournalInput): Promise<number> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('userId', sql.Int, input.userId)
          .input('tradeDate', sql.NVarChar(20), input.tradeDate)
          .input('symbol', sql.NVarChar(30), input.symbol)
          .input('direction', sql.NVarChar(10), input.direction)
          .input('entryPrice', sql.Float, input.entryPrice)
          .input('exitPrice', sql.Float, input.exitPrice)
          .input('shares', sql.Float, input.shares)
          .input('reason', sql.NVarChar(sql.MAX), input.reason)
          .input('stopLossObeyed', sql.Int, input.stopLossObeyed ? 1 : 0)
          .query(`
            INSERT INTO trade_journal (user_id, trade_date, symbol, direction, entry_price, exit_price, shares, reason, stop_loss_obeyed)
            VALUES (@userId, @tradeDate, @symbol, @direction, @entryPrice, @exitPrice, @shares, @reason, @stopLossObeyed);
            SELECT SCOPE_IDENTITY() AS id
          `)
        return Number(result.recordset?.[0]?.id ?? -1)
      } catch (e) {
        console.error('[AzureSQL] saveTradeJournalEntry error:', e)
      }
    }
    return -1
  }
  const db = getSqliteDb()
  if (!db) return -1
  try {
    const info = db.prepare(`
      INSERT INTO trade_journal (user_id, trade_date, symbol, direction, entry_price, exit_price, shares, reason, stop_loss_obeyed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.userId, input.tradeDate, input.symbol, input.direction,
      input.entryPrice, input.exitPrice, input.shares, input.reason,
      input.stopLossObeyed ? 1 : 0,
    )
    return Number(info.lastInsertRowid)
  } catch (e) {
    console.error('[SQLite] saveTradeJournalEntry error:', e)
    return -1
  }
}

export async function listTradeJournalEntries(
  userId: number,
  opts?: { limit?: number; month?: string },
): Promise<TradeJournalEntry[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500)
  const month = opts?.month?.trim()
  const monthCond = month && /^\d{4}-\d{2}$/.test(month) ? 'AND trade_date LIKE @prefix' : ''
  const params: Record<string, any> = { userId, limit }
  if (monthCond) params.prefix = `${month}%`

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const req = pool.request()
          .input('userId', sql.Int, userId)
          .input('limit', sql.Int, limit)
        if (monthCond) req.input('prefix', sql.NVarChar(10), `${month}%`)
        const result = await req.query(`
          SELECT TOP (@limit) ${TRADE_JOURNAL_COLUMNS}
          FROM trade_journal WHERE user_id = @userId ${monthCond.replaceAll('@prefix', '@prefix')}
          ORDER BY trade_date DESC, id DESC
        `)
        return result.recordset as TradeJournalEntry[]
      } catch (e) {
        console.error('[AzureSQL] listTradeJournalEntries error:', e)
      }
    }
    return []
  }
  const db = getSqliteDb()
  if (!db) return []
  try {
    const sqliteCond = monthCond ? 'AND trade_date LIKE @prefix' : ''
    return db.prepare(`
      SELECT ${TRADE_JOURNAL_COLUMNS}
      FROM trade_journal WHERE user_id = @userId ${sqliteCond}
      ORDER BY trade_date DESC, id DESC LIMIT @limit
    `).all(params) as TradeJournalEntry[]
  } catch (e) {
    console.error('[SQLite] listTradeJournalEntries error:', e)
    return []
  }
}

/** 依 id 取單筆（含 user_id 歸屬檢查；非本人回 null）。 */
export async function getTradeJournalEntryById(id: number, userId: number): Promise<TradeJournalEntry | null> {
  const row = await dbQueryFirst<TradeJournalEntry>(
    `SELECT ${TRADE_JOURNAL_COLUMNS} FROM trade_journal WHERE id = @id AND user_id = @userId LIMIT 1`,
    { id, userId },
  )
  return row ?? null
}

export interface TradeJournalUpdate {
  tradeDate?: string
  symbol?: string
  direction?: TradeJournalDirection
  entryPrice?: number
  exitPrice?: number
  shares?: number
  reason?: string
  stopLossObeyed?: boolean
}

export async function updateTradeJournalEntry(
  id: number,
  userId: number,
  patch: TradeJournalUpdate,
): Promise<boolean> {
  const sets: string[] = []
  const params: Record<string, any> = { id, userId }
  if (patch.tradeDate !== undefined) { sets.push('trade_date = @tradeDate'); params.tradeDate = patch.tradeDate }
  if (patch.symbol !== undefined) { sets.push('symbol = @symbol'); params.symbol = patch.symbol }
  if (patch.direction !== undefined) { sets.push('direction = @direction'); params.direction = patch.direction }
  if (patch.entryPrice !== undefined) { sets.push('entry_price = @entryPrice'); params.entryPrice = patch.entryPrice }
  if (patch.exitPrice !== undefined) { sets.push('exit_price = @exitPrice'); params.exitPrice = patch.exitPrice }
  if (patch.shares !== undefined) { sets.push('shares = @shares'); params.shares = patch.shares }
  if (patch.reason !== undefined) { sets.push('reason = @reason'); params.reason = patch.reason }
  if (patch.stopLossObeyed !== undefined) { sets.push('stop_loss_obeyed = @stopLossObeyed'); params.stopLossObeyed = patch.stopLossObeyed ? 1 : 0 }
  if (sets.length === 0) return true

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return false
    try {
      const req = pool.request().input('id', sql.Int, id).input('userId', sql.Int, userId)
      const azureSets: string[] = []
      if (patch.tradeDate !== undefined) { req.input('tradeDate', sql.NVarChar(20), patch.tradeDate); azureSets.push('trade_date = @tradeDate') }
      if (patch.symbol !== undefined) { req.input('symbol', sql.NVarChar(30), patch.symbol); azureSets.push('symbol = @symbol') }
      if (patch.direction !== undefined) { req.input('direction', sql.NVarChar(10), patch.direction); azureSets.push('direction = @direction') }
      if (patch.entryPrice !== undefined) { req.input('entryPrice', sql.Float, patch.entryPrice); azureSets.push('entry_price = @entryPrice') }
      if (patch.exitPrice !== undefined) { req.input('exitPrice', sql.Float, patch.exitPrice); azureSets.push('exit_price = @exitPrice') }
      if (patch.shares !== undefined) { req.input('shares', sql.Float, patch.shares); azureSets.push('shares = @shares') }
      if (patch.reason !== undefined) { req.input('reason', sql.NVarChar(sql.MAX), patch.reason); azureSets.push('reason = @reason') }
      if (patch.stopLossObeyed !== undefined) { req.input('stopLossObeyed', sql.Int, patch.stopLossObeyed ? 1 : 0); azureSets.push('stop_loss_obeyed = @stopLossObeyed') }
      const result = await req.query(`
        UPDATE trade_journal SET ${azureSets.join(', ')}, updated_at = GETDATE()
        WHERE id = @id AND user_id = @userId
      `)
      return (result.rowsAffected[0] ?? 0) > 0
    } catch (e) {
      console.error('[AzureSQL] updateTradeJournalEntry error:', e)
      return false
    }
  }

  const db = getSqliteDb()
  if (!db) return false
  try {
    const positional = sets.map(s => s.replace(/@\w+/g, '?')).join(', ')
    const values = sets.map(s => {
      const key = s.match(/@(\w+)/)?.[1] ?? ''
      return params[key]
    })
    const info = db.prepare(`
      UPDATE trade_journal SET ${positional}, updated_at = datetime('now','localtime')
      WHERE id = ? AND user_id = ?
    `).run(...values, id, userId)
    return info.changes > 0
  } catch (e) {
    console.error('[SQLite] updateTradeJournalEntry error:', e)
    return false
  }
}

export async function deleteTradeJournalEntry(id: number, userId: number): Promise<boolean> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return false
    try {
      const result = await pool.request()
        .input('id', sql.Int, id)
        .input('userId', sql.Int, userId)
        .query('DELETE FROM trade_journal WHERE id = @id AND user_id = @userId')
      return (result.rowsAffected[0] ?? 0) > 0
    } catch (e) {
      console.error('[AzureSQL] deleteTradeJournalEntry error:', e)
      return false
    }
  }
  const db = getSqliteDb()
  if (!db) return false
  try {
    const info = db.prepare('DELETE FROM trade_journal WHERE id = ? AND user_id = ?').run(id, userId)
    return info.changes > 0
  } catch (e) {
    console.error('[SQLite] deleteTradeJournalEntry error:', e)
    return false
  }
}

export async function getAnalysisRecordById(id: number): Promise<AnalysisRecord | undefined> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('id', sql.Int, id)
          .query(`SELECT id, ticker, recommendation, summary, full_report_json, model_usage, primary_models, fallback_used, fallback_count, created_at FROM analysis_records WHERE id = @id`)
        return result.recordset[0] as AnalysisRecord | undefined
      } catch (e) {
        console.error('[AzureSQL] getAnalysisRecordById error:', e)
      }
    }
  } else {
    const db = getSqliteDb()
    if (db) {
      try {
        return db.prepare(`
          SELECT id, ticker, recommendation, summary, full_report_json, model_usage, primary_models, fallback_used, fallback_count, created_at
          FROM analysis_records WHERE id = ?
        `).get(id) as AnalysisRecord | undefined
      } catch (e) {
        console.error('[SQLite] getAnalysisRecordById error:', e)
      }
    }
  }

  return memoryStore.find(r => r.id === id)
}

export async function deleteAnalysisRecord(id: number): Promise<boolean> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('id', sql.Int, id)
          .query('DELETE FROM analysis_records WHERE id = @id')
        return result.rowsAffected[0] > 0
      } catch (e) {
        console.error('[AzureSQL] deleteAnalysisRecord error:', e)
        return false
      }
    }
    return false
  }

  const db = getSqliteDb()
  if (db) {
    try {
      const info = db.prepare('DELETE FROM analysis_records WHERE id = ?').run(id)
      return info.changes > 0
    } catch (e) {
      console.error('[SQLite] deleteAnalysisRecord error:', e)
      return false
    }
  }

  const idx = memoryStore.findIndex(r => r.id === id)
  if (idx >= 0) {
    memoryStore.splice(idx, 1)
    return true
  }
  return false
}

// ─── Historical Gifts ────────────────────────────────────────────
export interface HistoricalGift {
  id?: number
  stock_id: string
  stock_name?: string
  year: number
  gift_name: string
}

export async function getHistoricalGifts(stockId: string): Promise<HistoricalGift[]> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('stock_id', sql.NVarChar(20), stockId)
          .query(`
            SELECT id, stock_id, stock_name, year, gift_name
            FROM historical_shareholder_gifts WHERE stock_id = @stock_id ORDER BY year DESC
          `)
        return result.recordset as HistoricalGift[]
      } catch (e) {
        console.error('[AzureSQL] getHistoricalGifts error:', e)
      }
    }
    return []
  }

  const db = getSqliteDb()
  if (db) {
    try {
      return db.prepare(`
        SELECT id, stock_id, stock_name, year, gift_name
        FROM historical_shareholder_gifts WHERE stock_id = ? ORDER BY year DESC
      `).all(stockId) as HistoricalGift[]
    } catch (e) {
      console.error('[SQLite] getHistoricalGifts error:', e)
    }
  }
  return []
}

// ─── Market Focus (首頁 AI 篩選新聞) ─────────────────────────────
export interface MarketFocusItem {
  id?: number
  title: string
  url: string
  source: string | null
  published_at: string | null
  reason: string | null
  /** AI 依據全文提煉的說人話重點摘要（約 100~180 字）。 */
  summary?: string | null
  /** 抓取到的文章全文摘錄（節錄前 4000 字，僅短存最新一輪）。 */
  content?: string | null
  /** 解析後的原始新聞來源 URL（優先 Google 轉址後的網址）。 */
  source_url?: string | null
  /** Issue #19 新聞影響結構化：對台股的影響方向（positive 偏多／negative 偏空／neutral 中性）。 */
  impact_direction?: 'positive' | 'negative' | 'neutral' | string | null
  /** 影響範圍（如：大盤／半導體族群／個股）。 */
  scope?: string | null
  /** 影響時程（如：短線數日／中期數季）。 */
  horizon?: string | null
  /** 受影響族群／產業（逗號分隔）。 */
  affected_sectors?: string | null
  /** 投資人可採取的關注行動（非投資建議）。 */
  action?: string | null
  /** 文中提及的台股代號（逗號分隔，如 2330,2317），供新聞卡連回回測。 */
  related_symbols?: string | null
  created_at?: string
}

export interface MarketFocusMeta {
  id?: number
  summary: string | null
  generated_at: string | null
}

/** 儲存市場焦點新聞：保留歷史資料不刪除，依 url 進行去重與更新。 */
export async function saveMarketFocus(items: MarketFocusItem[]): Promise<void> {
  for (const it of items) {
    if (!it.title || !it.url) continue
    const existing = await dbQueryFirst<{ id: number }>('SELECT id FROM market_focus WHERE url = @url', { url: it.url })
    if (existing?.id) {
      await dbExecute(
        'UPDATE market_focus SET title = @title, source = @source, published_at = @published_at, reason = @reason, summary = @summary, content = @content, source_url = @source_url, impact_direction = @impact_direction, scope = @scope, horizon = @horizon, affected_sectors = @affected_sectors, action = @action, related_symbols = @related_symbols WHERE id = @id',
        {
          id: existing.id,
          title: it.title.slice(0, 500),
          source: it.source ? it.source.slice(0, 200) : null,
          published_at: it.published_at ? it.published_at.slice(0, 100) : null,
          reason: it.reason ?? null,
          summary: it.summary ?? null,
          content: it.content ?? null,
          source_url: it.source_url ? it.source_url.slice(0, 2000) : null,
          impact_direction: it.impact_direction ? String(it.impact_direction).slice(0, 20) : null,
          scope: it.scope ? it.scope.slice(0, 200) : null,
          horizon: it.horizon ? it.horizon.slice(0, 200) : null,
          affected_sectors: it.affected_sectors ? it.affected_sectors.slice(0, 500) : null,
          action: it.action ? it.action.slice(0, 500) : null,
          related_symbols: it.related_symbols ? it.related_symbols.slice(0, 200) : null,
        },
      )
    } else {
      await dbExecute(
        'INSERT INTO market_focus (title, url, source, published_at, reason, summary, content, source_url, impact_direction, scope, horizon, affected_sectors, action, related_symbols) VALUES (@title, @url, @source, @published_at, @reason, @summary, @content, @source_url, @impact_direction, @scope, @horizon, @affected_sectors, @action, @related_symbols)',
        {
          title: it.title.slice(0, 500),
          url: it.url.slice(0, 2000),
          source: it.source ? it.source.slice(0, 200) : null,
          published_at: it.published_at ? it.published_at.slice(0, 100) : null,
          reason: it.reason ?? null,
          summary: it.summary ?? null,
          content: it.content ?? null,
          source_url: it.source_url ? it.source_url.slice(0, 2000) : null,
          impact_direction: it.impact_direction ? String(it.impact_direction).slice(0, 20) : null,
          scope: it.scope ? it.scope.slice(0, 200) : null,
          horizon: it.horizon ? it.horizon.slice(0, 200) : null,
          affected_sectors: it.affected_sectors ? it.affected_sectors.slice(0, 500) : null,
          action: it.action ? it.action.slice(0, 500) : null,
          related_symbols: it.related_symbols ? it.related_symbols.slice(0, 200) : null,
        },
      )
    }
  }
}

/** 讀取市場焦點新聞：預設過濾近 days 天（預設 2 天），若遇假期新聞較少則 fallback 回傳最新資料避免開天窗。 */
export async function getMarketFocus(limit: number = 6, days: number = 2): Promise<MarketFocusItem[]> {
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const recent = await dbQueryAll<MarketFocusItem>(
    `SELECT id, title, url, source, published_at, reason, summary, content, source_url, impact_direction, scope, horizon, affected_sectors, action, related_symbols FROM market_focus WHERE published_at >= @sinceDate ORDER BY published_at DESC, id DESC LIMIT ${limit}`,
    { sinceDate },
  )
  if (recent.length > 0) {
    return recent
  }
  // 遇週末或長假時若無 2 天內新聞，回傳最新資料以維持介面體驗
  return dbQueryAll<MarketFocusItem>(
    `SELECT id, title, url, source, published_at, reason, summary, content, source_url, impact_direction, scope, horizon, affected_sectors, action, related_symbols FROM market_focus ORDER BY published_at DESC, id DESC LIMIT ${limit}`,
  )
}

/** 覆寫當日市場焦點 AI 總覽（僅保留最新一輪，維持單一列）。 */
export async function saveMarketFocusMeta(meta: { summary: string; generatedAt: string }): Promise<void> {
  await dbExecute('DELETE FROM market_focus_meta')
  await dbExecute(
    'INSERT INTO market_focus_meta (summary, generated_at) VALUES (@summary, @generated_at)',
    { summary: meta.summary.slice(0, 20000), generated_at: meta.generatedAt.slice(0, 100) },
  )
}

/** 讀取最新市場焦點 AI 總覽。 */
export async function getMarketFocusMeta(): Promise<MarketFocusMeta | null> {
  const rows = await dbQueryAll<MarketFocusMeta>(
    'SELECT id, summary, generated_at FROM market_focus_meta ORDER BY id DESC LIMIT 1',
  )
  return rows[0] ?? null
}

// ─── Market Focus 管線事件日誌（market_focus_logs）────────────────
// 結構化記錄市場焦點管線的 LLM 失敗／兜底／回填等事件，供後續查詢診斷。
// 與 Azure 容器 log 互補：Log Analytics / log stream 只有原始 stdout，實例回收即流失；
// DB 層既可跨實例存活，也可直接餵進告警信與後台查詢。

export interface MarketFocusLogRow {
  id: number
  source: string
  level: 'info' | 'warn' | 'error'
  code: string | null
  job_id: string | null
  edition_key: string | null
  message: string
  detail: string | null
  created_at: string | null
}

export interface MarketFocusLogInput {
  source: string
  level: 'info' | 'warn' | 'error'
  code?: string | null
  jobId?: string | null
  editionKey?: string | null
  message: string
  detail?: Record<string, unknown> | string | null
}

/** 記錄一筆市場焦點管線日誌。DB 失敗一律靜默吞掉，絕不影響主流程。 */
export async function logMarketFocusEvent(input: MarketFocusLogInput): Promise<void> {
  try {
    const detail =
      input.detail == null
        ? null
        : typeof input.detail === 'string'
          ? input.detail
          : JSON.stringify(input.detail)
    await dbExecute(
      `INSERT INTO market_focus_logs (source, level, code, job_id, edition_key, message, detail)
       VALUES (@source, @level, @code, @job_id, @edition_key, @message, @detail)`,
      {
        source: input.source,
        level: input.level,
        code: input.code ?? null,
        job_id: input.jobId ?? null,
        edition_key: input.editionKey ?? null,
        message: input.message,
        detail,
      },
    )
  } catch (e) {
    console.error(`[DB] logMarketFocusEvent failed (${input.source}/${input.level}):`, e)
  }
}

/** 取出某來源最近一筆日誌（同來源依時間新到舊）。 */
export async function getLatestMarketFocusLog(source: string, level?: 'info' | 'warn' | 'error'): Promise<MarketFocusLogRow | null> {
  const cond = level ? 'source = @source AND level = @level' : 'source = @source'
  const rows = await dbQueryAll<MarketFocusLogRow>(
    `SELECT id, source, level, code, job_id, edition_key, message, detail, created_at
     FROM market_focus_logs WHERE ${cond} ORDER BY id DESC LIMIT 1`,
    level ? { source, level } : { source },
  )
  return rows[0] ?? null
}

/** 列出最近 N 筆市場焦點管線日誌（新到舊），供後台／健康檢查查詢。 */
export async function listMarketFocusLogs(limit = 50, opts?: { level?: 'info' | 'warn' | 'error'; source?: string }): Promise<MarketFocusLogRow[]> {
  const conds: string[] = []
  const params: Record<string, any> = {}
  if (opts?.level) {
    conds.push('level = @level')
    params.level = opts.level
  }
  if (opts?.source) {
    conds.push('source = @source')
    params.source = opts.source
  }
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : ''
  return dbQueryAll<MarketFocusLogRow>(
    `SELECT id, source, level, code, job_id, edition_key, message, detail, created_at
     FROM market_focus_logs${where} ORDER BY id DESC LIMIT ${Math.max(1, Math.min(limit, 500))}`,
    params,
  )
}

/** 清理超過 retentionDays（預設 7）天前的日誌，回傳刪除筆數。保留最新 retentionDays 天。 */
export async function cleanupMarketFocusLogs(retentionDays = 7): Promise<number> {
  try {
    const n = Math.max(1, Math.floor(retentionDays))
    let deleted = 0
    if (isAzureSql) {
      const pool = await getAzurePool()
      if (!pool) return 0
      const r = await pool
        .request()
        .input('days', sql.Int, n)
        .query('DELETE FROM market_focus_logs WHERE created_at < DATEADD(day, @days, GETDATE()); SELECT @@ROWCOUNT AS n')
      deleted = r.recordset?.[0]?.n ?? 0
    } else {
      const db = getSqliteDb()
      if (!db) return 0
      const r = db.prepare(`DELETE FROM market_focus_logs WHERE created_at < datetime('now','localtime','-${n} days')`).run()
      deleted = r.changes
    }
    return deleted
  } catch (e) {
    console.error('[DB] cleanupMarketFocusLogs failed:', e)
    return 0
  }
}

/** 清理社交圖卡快照：只保留最近 keepEditions（預設 30）個 edition，其餘（每版最多 3 張 BLOB）刪除。回傳刪除筆數。 */
export async function cleanupSocialCardImages(keepEditions = 30): Promise<number> {
  try {
    const n = Math.max(1, Math.floor(keepEditions))
    let deleted = 0
    if (isAzureSql) {
      const pool = await getAzurePool()
      if (!pool) return 0
      const r = await pool
        .request()
        .input('keep', sql.Int, n)
        .query(
          `DELETE FROM social_card_images
           WHERE edition_key NOT IN (
             SELECT TOP (@keep) edition_key FROM (
               SELECT DISTINCT edition_key FROM social_card_images
             ) t ORDER BY edition_key DESC
           );
           SELECT @@ROWCOUNT AS n`,
        )
      deleted = r.recordset?.[0]?.n ?? 0
    } else {
      const db = getSqliteDb()
      if (!db) return 0
      const r = db
        .prepare(
          `DELETE FROM social_card_images
           WHERE edition_key NOT IN (
             SELECT edition_key FROM (
               SELECT DISTINCT edition_key FROM social_card_images ORDER BY edition_key DESC LIMIT @keep
             )
           )`,
        )
        .run({ keep: n })
      deleted = r.changes
    }
    return deleted
  } catch (e) {
    console.error('[DB] cleanupSocialCardImages failed:', e)
    return 0
  }
}

// ─── Cycle Entry (週期進場模型預估) ───────────────────────────────
export interface CycleEntrySignalRow {
  id?: number
  editionDate: string
  symbol: string
  name: string | null
  marketCap: number | null
  signalRank: number | null
  price: number | null
  entryPriceHint: number | null
  score: number
  matchedRules: string
  cycleStage: string | null
  pctOff52wHigh: number | null
  pctOff52wLow: number | null
  rsi: number | null
  ma20: number | null
  ma60: number | null
  macdHist: number | null
  llmNote: string | null
  btTotalSignals: number | null
  btWins: number | null
  btLosses: number | null
  btNeutral: number | null
  btWinRate: number | null
  btAvgDays: number | null
  createdAt?: string
}

export interface CycleEntryMetaRow {
  id?: number
  editionDate: string
  summary: string | null
  signalCount: number
  generatedAt: string | null
}

/** 置換指定版次的週期進場訊號清單（先清除同版次既有資料再寫入）。 */
export async function saveCycleEntrySignals(
  editionDate: string,
  items: Omit<CycleEntrySignalRow, 'editionDate'>[],
): Promise<void> {
  await dbExecute('DELETE FROM cycle_entry_signals WHERE edition_date = @editionDate', { editionDate })
  for (const it of items) {
    await dbExecute(
      `INSERT INTO cycle_entry_signals (
        edition_date, symbol, name, market_cap, signal_rank, price, entry_price_hint,
        score, matched_rules, cycle_stage, pct_off_52w_high, pct_off_52w_low,
        rsi, ma20, ma60, macd_hist, llm_note,
        bt_total_signals, bt_wins, bt_losses, bt_neutral, bt_win_rate, bt_avg_days
      ) VALUES (
        @editionDate, @symbol, @name, @marketCap, @signalRank, @price, @entryPriceHint,
        @score, @matchedRules, @cycleStage, @pctOff52wHigh, @pctOff52wLow,
        @rsi, @ma20, @ma60, @macdHist, @llmNote,
        @btTotalSignals, @btWins, @btLosses, @btNeutral, @btWinRate, @btAvgDays
      )`,
      {
        editionDate,
        symbol: it.symbol.slice(0, 30),
        name: it.name ? it.name.slice(0, 100) : null,
        marketCap: it.marketCap,
        signalRank: it.signalRank,
        price: it.price,
        entryPriceHint: it.entryPriceHint,
        score: it.score,
        matchedRules: it.matchedRules.slice(0, 50),
        cycleStage: it.cycleStage ? it.cycleStage.slice(0, 30) : null,
        pctOff52wHigh: it.pctOff52wHigh,
        pctOff52wLow: it.pctOff52wLow,
        rsi: it.rsi,
        ma20: it.ma20,
        ma60: it.ma60,
        macdHist: it.macdHist,
        llmNote: it.llmNote ? it.llmNote.slice(0, 2000) : null,
        btTotalSignals: it.btTotalSignals ?? 0,
        btWins: it.btWins ?? 0,
        btLosses: it.btLosses ?? 0,
        btNeutral: it.btNeutral ?? 0,
        btWinRate: it.btWinRate,
        btAvgDays: it.btAvgDays,
      },
    )
  }
}

/** 讀取指定版次的週期進場訊號（依 signal_rank 排序）。 */
export async function getCycleEntrySignalsByEdition(
  editionDate: string,
): Promise<CycleEntrySignalRow[]> {
  return dbQueryAll<CycleEntrySignalRow>(
    `SELECT id, edition_date AS editionDate, symbol, name, market_cap AS marketCap,
            signal_rank AS signalRank, price, entry_price_hint AS entryPriceHint,
            score, matched_rules AS matchedRules, cycle_stage AS cycleStage,
            pct_off_52w_high AS pctOff52wHigh, pct_off_52w_low AS pctOff52wLow,
            rsi, ma20, ma60, macd_hist AS macdHist, llm_note AS llmNote,
            bt_total_signals AS btTotalSignals, bt_wins AS btWins, bt_losses AS btLosses,
            bt_neutral AS btNeutral, bt_win_rate AS btWinRate, bt_avg_days AS btAvgDays,
            created_at AS createdAt
     FROM cycle_entry_signals WHERE edition_date = @editionDate
     ORDER BY signal_rank ASC`,
    { editionDate },
  )
}

/** 覆寫指定版次的週期進場 meta（單列/版次，upsert）。 */
export async function saveCycleEntryMeta(meta: {
  editionDate: string
  summary: string | null
  signalCount: number
  generatedAt: string
}): Promise<void> {
  await dbExecute('DELETE FROM cycle_entry_meta WHERE edition_date = @editionDate', {
    editionDate: meta.editionDate,
  })
  await dbExecute(
    'INSERT INTO cycle_entry_meta (edition_date, summary, signal_count, generated_at) VALUES (@editionDate, @summary, @signalCount, @generatedAt)',
    {
      editionDate: meta.editionDate,
      summary: meta.summary ? meta.summary.slice(0, 20000) : null,
      signalCount: meta.signalCount,
      generatedAt: meta.generatedAt.slice(0, 100),
    },
  )
}

/** 讀取最新版次的 meta（供首頁/公開 API/健康檢查）。 */
export async function getLatestCycleEntryMeta(): Promise<CycleEntryMetaRow | null> {
  const rows = await dbQueryAll<CycleEntryMetaRow>(
    `SELECT id, edition_date AS editionDate, summary, signal_count AS signalCount, generated_at AS generatedAt
     FROM cycle_entry_meta ORDER BY edition_date DESC LIMIT 1`,
  )
  return rows[0] ?? null
}

/** 讀取指定版次的 meta。 */
export async function getCycleEntryMetaByEdition(editionDate: string): Promise<CycleEntryMetaRow | null> {
  const rows = await dbQueryAll<CycleEntryMetaRow>(
    `SELECT id, edition_date AS editionDate, summary, signal_count AS signalCount, generated_at AS generatedAt
     FROM cycle_entry_meta WHERE edition_date = @editionDate LIMIT 1`,
    { editionDate },
  )
  return rows[0] ?? null
}

/** 列出歷史版次（後台瀏覽用）。 */
export async function listCycleEntryEditions(limit = 20): Promise<
  { editionDate: string; count: number; generatedAt: string | null }[]
> {
  return dbQueryAll(
    `SELECT edition_date AS editionDate, COUNT(*) AS count,
            MAX(created_at) AS generatedAt
     FROM cycle_entry_signals
     GROUP BY edition_date
     ORDER BY edition_date DESC
     LIMIT @limit`,
    { limit: Number(limit) || 20 },
  )
}

/** 統計全部訊號筆數（健康檢查用）。 */
export async function countCycleEntrySignals(): Promise<number> {
  const row = await dbQueryFirst<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM cycle_entry_signals')
  return row?.cnt ?? 0
}

// ─── Users / Auth / Quota ────────────────────────────────────────
export type AuthProvider = 'google' | 'line'

export interface UserRow {
  id: number
  email: string | null
  display_name: string | null
  avatar_url: string | null
  created_at?: string
}

export interface IdentityInput {
  provider: AuthProvider
  providerUserId: string
  email?: string | null
  displayName?: string | null
  avatarUrl?: string | null
  /** 是否以 email 綁定到既有使用者。預設 true（Google 等維持原行為）；LINE 設 false 以保持既有 Email 使用者登入方式不變。 */
  mergeByEmail?: boolean
}

export interface QuotaResult {
  allowed: boolean
  used: number
  remaining: number
  max: number
}

  const USER_COLUMNS = 'id, email, display_name, avatar_url, created_at'
  const USER_COLUMNS_ALIASED = 'u.id, u.email, u.display_name, u.avatar_url, u.created_at'

export async function getUserById(userId: number): Promise<UserRow | null> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return null
    try {
      const result = await pool.request()
        .input('id', sql.Int, userId)
        .query(`SELECT ${USER_COLUMNS} FROM users WHERE id = @id`)
      return (result.recordset[0] as UserRow) ?? null
    } catch (e) {
      console.error('[AzureSQL] getUserById error:', e)
      return null
    }
  }

  const db = getSqliteDb()
  if (!db) return null
  try {
    return (db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(userId) as UserRow) ?? null
  } catch (e) {
    console.error('[SQLite] getUserById error:', e)
    return null
  }
}

export interface UserIdentityRow {
  provider: string
  provider_user_id: string
  provider_email: string | null
}

export async function getUserIdentities(userId: number): Promise<UserIdentityRow[]> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('id', sql.Int, userId)
          .query('SELECT provider, provider_user_id, provider_email FROM user_identities WHERE user_id = @id')
        return result.recordset as UserIdentityRow[]
      } catch (e) {
        console.error('[AzureSQL] getUserIdentities error:', e)
      }
    }
    return []
  }

  const db = getSqliteDb()
  if (db) {
    try {
      return db.prepare('SELECT provider, provider_user_id, provider_email FROM user_identities WHERE user_id = ?').all(userId) as UserIdentityRow[]
    } catch (e) {
      console.error('[SQLite] getUserIdentities error:', e)
    }
  }
  return []
}

export async function findOrCreateUser(input: IdentityInput): Promise<UserRow | null> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return null
    try {
      const ident = await pool.request()
        .input('p', sql.NVarChar(20), input.provider)
        .input('pid', sql.NVarChar(100), input.providerUserId)
        .query(`
          SELECT ${USER_COLUMNS_ALIASED}
          FROM users u JOIN user_identities i ON i.user_id = u.id
          WHERE i.provider = @p AND i.provider_user_id = @pid
        `)
      if (ident.recordset[0]) {
        await pool.request()
          .input('id', sql.Int, ident.recordset[0].id)
          .input('name', sql.NVarChar(100), input.displayName ?? null)
          .input('avatar', sql.NVarChar(500), input.avatarUrl ?? null)
          .input('email', sql.NVarChar(255), input.email ?? null)
          .query(`UPDATE users SET display_name = COALESCE(@name, display_name), avatar_url = COALESCE(@avatar, avatar_url), email = COALESCE(@email, email) WHERE id = @id`)
        return ident.recordset[0] as UserRow
      }

      let userId: number
      if (input.email && input.mergeByEmail !== false) {
        const byEmail = await pool.request()
          .input('email', sql.NVarChar(255), input.email)
          .query('SELECT id FROM users WHERE email = @email')
        if (byEmail.recordset[0]) {
          userId = byEmail.recordset[0].id
        } else {
          const ins = await pool.request()
            .input('email', sql.NVarChar(255), input.email)
            .input('name', sql.NVarChar(100), input.displayName ?? null)
            .input('avatar', sql.NVarChar(500), input.avatarUrl ?? null)
            .query(`INSERT INTO users (email, display_name, avatar_url) VALUES (@email, @name, @avatar); SELECT SCOPE_IDENTITY() AS id`)
          userId = Number(ins.recordset[0]?.id ?? -1)
        }
      } else {
        const ins = await pool.request()
          .input('email', sql.NVarChar(255), input.email ?? null)
          .input('name', sql.NVarChar(100), input.displayName ?? null)
          .input('avatar', sql.NVarChar(500), input.avatarUrl ?? null)
          .query(`INSERT INTO users (email, display_name, avatar_url) VALUES (@email, @name, @avatar); SELECT SCOPE_IDENTITY() AS id`)
        userId = Number(ins.recordset[0]?.id ?? -1)
      }

      if (userId > 0) {
        await pool.request()
          .input('uid', sql.Int, userId)
          .input('p', sql.NVarChar(20), input.provider)
          .input('pid', sql.NVarChar(100), input.providerUserId)
          .input('pe', sql.NVarChar(255), input.email ?? null)
          .query(`INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email) VALUES (@uid, @p, @pid, @pe)`)
        const u = await pool.request().input('id', sql.Int, userId).query(`SELECT ${USER_COLUMNS} FROM users WHERE id = @id`)
        return (u.recordset[0] as UserRow) ?? null
      }
      return null
    } catch (e) {
      console.error('[AzureSQL] findOrCreateUser error:', e)
      return null
    }
  }

  const db = getSqliteDb()
  if (!db) return null
  try {
    const existing = db.prepare(`
      SELECT ${USER_COLUMNS_ALIASED}
      FROM users u JOIN user_identities i ON i.user_id = u.id
      WHERE i.provider = ? AND i.provider_user_id = ?
    `).get(input.provider, input.providerUserId) as UserRow | undefined

    if (existing) {
      db.prepare(
        `UPDATE users SET display_name = COALESCE(?, display_name), avatar_url = COALESCE(?, avatar_url), email = COALESCE(?, email) WHERE id = ?`,
      ).run(input.displayName ?? null, input.avatarUrl ?? null, input.email ?? null, existing.id)
      return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(existing.id) as UserRow
    }

    let userId: number
    if (input.email && input.mergeByEmail !== false) {
      const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email) as { id: number } | undefined
      if (byEmail) {
        userId = byEmail.id
      } else {
        userId = Number(db.prepare('INSERT INTO users (email, display_name, avatar_url) VALUES (?, ?, ?)').run(input.email, input.displayName ?? null, input.avatarUrl ?? null).lastInsertRowid)
      }
    } else {
      userId = Number(db.prepare('INSERT INTO users (email, display_name, avatar_url) VALUES (?, ?, ?)').run(input.email ?? null, input.displayName ?? null, input.avatarUrl ?? null).lastInsertRowid)
    }

    if (userId > 0) {
      db.prepare('INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email) VALUES (?, ?, ?, ?)').run(userId, input.provider, input.providerUserId, input.email ?? null)
      return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(userId) as UserRow
    }
    return null
  } catch (e) {
    console.error('[SQLite] findOrCreateUser error:', e)
    return null
  }
}

export async function getUsageCount(userId: number, date: string): Promise<number> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return 0
    try {
      const result = await pool.request()
        .input('uid', sql.Int, userId)
        .input('d', sql.NVarChar(10), date)
        .query('SELECT count FROM api_usage WHERE user_id = @uid AND usage_date = @d')
      return Number(result.recordset[0]?.count ?? 0)
    } catch (e) {
      console.error('[AzureSQL] getUsageCount error:', e)
      return 0
    }
  }

  const db = getSqliteDb()
  if (!db) return 0
  try {
    const row = db.prepare('SELECT count FROM api_usage WHERE user_id = ? AND usage_date = ?').get(userId, date) as { count: number } | undefined
    return Number(row?.count ?? 0)
  } catch (e) {
    console.error('[SQLite] getUsageCount error:', e)
    return 0
  }
}

/**
 * Atomically consume one AI-analysis quota for the given user/date.
 * If the user has reached `max` usages, the call fails (allowed=false).
 */
export async function consumeAnalysisQuota(userId: number, date: string, max: number): Promise<QuotaResult> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return { allowed: false, used: 0, remaining: 0, max }
    try {
      await pool.request()
        .input('uid', sql.Int, userId)
        .input('d', sql.NVarChar(10), date)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM api_usage WHERE user_id = @uid AND usage_date = @d)
          BEGIN
            INSERT INTO api_usage (user_id, usage_date, count) VALUES (@uid, @d, 0)
          END
        `)
      const res = await pool.request()
        .input('uid', sql.Int, userId)
        .input('d', sql.NVarChar(10), date)
        .input('max', sql.Int, max)
        .query('UPDATE api_usage SET count = count + 1 WHERE user_id = @uid AND usage_date = @d AND count < @max')
      const allowed = (res.rowsAffected[0] ?? 0) > 0
      const used = await getUsageCount(userId, date)
      return { allowed, used, remaining: Math.max(0, max - used), max }
    } catch (e) {
      console.error('[AzureSQL] consumeAnalysisQuota error:', e)
      return { allowed: false, used: 0, remaining: 0, max }
    }
  }

  const db = getSqliteDb()
  if (!db) return { allowed: false, used: 0, remaining: 0, max }
  try {
    db.prepare('INSERT OR IGNORE INTO api_usage (user_id, usage_date, count) VALUES (?, ?, 0)').run(userId, date)
    const res = db.prepare('UPDATE api_usage SET count = count + 1 WHERE user_id = ? AND usage_date = ? AND count < ?').run(userId, date, max)
    const allowed = res.changes > 0
    const used = await getUsageCount(userId, date)
    return { allowed, used, remaining: Math.max(0, max - used), max }
  } catch (e) {
    console.error('[SQLite] consumeAnalysisQuota error:', e)
    return { allowed: false, used: 0, remaining: 0, max }
  }
}

export async function getRecognitionUsage(userId: number, date: string): Promise<number> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return 0
    try {
      const result = await pool.request()
        .input('uid', sql.Int, userId)
        .input('d', sql.NVarChar(10), date)
        .query('SELECT count FROM recognition_usage WHERE user_id = @uid AND usage_date = @d')
      return Number(result.recordset[0]?.count ?? 0)
    } catch (e) {
      console.error('[AzureSQL] getRecognitionUsage error:', e)
      return 0
    }
  }

  const db = getSqliteDb()
  if (!db) return 0
  try {
    const row = db.prepare('SELECT count FROM recognition_usage WHERE user_id = ? AND usage_date = ?').get(userId, date) as { count: number } | undefined
    return Number(row?.count ?? 0)
  } catch (e) {
    console.error('[SQLite] getRecognitionUsage error:', e)
    return 0
  }
}

/**
 * 辨識失敗或結果為空（技術性失敗，非使用者責任）時補回一單位額度，
 * 避免測試/OCR 不佳把每日額度燒光。
 */
export async function refundRecognitionQuota(userId: number, date: string): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      await pool.request()
        .input('uid', sql.Int, userId)
        .input('d', sql.NVarChar(10), date)
        .query('UPDATE recognition_usage SET count = count - 1 WHERE user_id = @uid AND usage_date = @d AND count > 0')
    } catch (e) {
      console.error('[AzureSQL] refundRecognitionQuota error:', e)
    }
    return
  }

  const db = getSqliteDb()
  if (!db) return
  try {
    db.prepare('UPDATE recognition_usage SET count = count - 1 WHERE user_id = ? AND usage_date = ? AND count > 0').run(userId, date)
  } catch (e) {
    console.error('[SQLite] refundRecognitionQuota error:', e)
  }
}

/**
 * 依中文（或部分）股票名稱查詢候選代號；TWSE 零股交易表優先（涵蓋上市上櫃/ETF），
 * 找不到再於股東會紀念品表找。同時支援本機 SQLite 與線上 AzureSQL。
 * 回傳一組 { stock_id, stock_name }（stock_id 依市場為純數字代號，如 "2330"、"0050"）。
 */
export async function searchStocksByName(keyword: string): Promise<Array<{ stock_id: string; stock_name: string }>> {
  const trimmed = keyword.trim()
  if (!trimmed) return []
  const kw = `%${trimmed}%`
  const prefix = `${trimmed}%`
  // 1. 優先查詢 odd_lot_trades 表（涵蓋上市上櫃與 ETF，名稱最標準最新）
  // 支援同時比對 stock_name 或 stock_id；且排除少數 stock_name 純為代號的紀錄以取得正式中文
  const rows = await dbQueryAll(
    `SELECT stock_id, stock_name FROM odd_lot_trades
     WHERE (stock_name LIKE @kw OR stock_id LIKE @kw)
       AND stock_name != stock_id
     GROUP BY stock_id, stock_name
     ORDER BY CASE 
       WHEN stock_id = @exact THEN 0 
       WHEN stock_name = @exact THEN 1 
       WHEN stock_id LIKE @prefix THEN 2
       WHEN stock_name LIKE @prefix THEN 3
       ELSE 4 
     END, stock_id
     LIMIT 15`,
    { kw, exact: trimmed, prefix },
  )
  if (rows.length) return rows as Array<{ stock_id: string; stock_name: string }>

  // 2. 備援查詢股東會紀念品表 shareholder_gifts
  const gifts = await dbQueryAll(
    `SELECT DISTINCT stock_id, stock_name FROM shareholder_gifts
     WHERE stock_name LIKE @kw OR stock_id LIKE @kw
     ORDER BY CASE 
       WHEN stock_id = @exact THEN 0 
       WHEN stock_name = @exact THEN 1 
       WHEN stock_id LIKE @prefix THEN 2
       ELSE 3 
     END, stock_id
     LIMIT 15`,
    { kw, exact: trimmed, prefix },
  )
  if (gifts.length) return gifts as Array<{ stock_id: string; stock_name: string }>

  // 3. 若皆無正式中文，最後容許 stock_name == stock_id 的保底紀錄
  const fallbackRows = await dbQueryAll(
    `SELECT stock_id, stock_name FROM odd_lot_trades
     WHERE stock_name LIKE @kw OR stock_id LIKE @kw
     GROUP BY stock_id, stock_name
     ORDER BY CASE WHEN stock_id = @exact THEN 0 ELSE 1 END, stock_id
     LIMIT 15`,
    { kw, exact: trimmed },
  )
  return fallbackRows as Array<{ stock_id: string; stock_name: string }>
}

/**
 * Optimal String Alignment Damerau-Levenshtein 距離（插入/刪除/取代/相鄰交換）。
 * 供模糊比對用；兩個字串相同回 0。
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost)
      }
    }
  }
  return dp[m][n]
}

/**
 * 模糊股票名稱搜尋：依查詢前兩個中文字（發行商前綴）撈候選池，
 * 再用 Damerau-Levenshtein 距離排序，撈回與 OCR 誤讀名稱最接近的正名。
 * 只處理「整段名稱幾乎正確、僅單字誤讀」的典型 OCR 錯誤
 * （如「國泰永績高股息」→「國泰永續高股息」），距離超過門檻一律丟棄。
 */
export async function fuzzySearchStocksByName(
  query: string,
  limit = 8,
): Promise<Array<{ stock_id: string; stock_name: string; dist: number }>> {
  const trimmed = query.trim()
  if (!trimmed || trimmed.length < 3) return []
  const prefix = trimmed.match(/[\u4e00-\u9fff]{2}/)?.[0] ?? ''
  if (!prefix || prefix.length < 2) return []

  const pool = (await dbQueryAll(
    `SELECT stock_id, stock_name FROM odd_lot_trades
     WHERE stock_name LIKE @prefix
     GROUP BY stock_id, stock_name
     ORDER BY stock_id
     LIMIT 80`,
    { prefix: `${prefix}%` },
  )) as Array<{ stock_id: string; stock_name: string }>

  let poolSet = pool
  if (pool.length < limit) {
    const gifts = (await dbQueryAll(
      `SELECT DISTINCT stock_id, stock_name FROM shareholder_gifts
       WHERE stock_name LIKE @prefix
       ORDER BY stock_id
       LIMIT 80`,
      { prefix: `${prefix}%` },
    )) as Array<{ stock_id: string; stock_name: string }>
    if (gifts.length) {
      const seen = new Set(pool.map(r => r.stock_id))
      poolSet = [...pool, ...gifts.filter(r => !seen.has(r.stock_id))]
    }
  }

  if (!poolSet.length) return []
  const threshold = Math.max(3, Math.ceil(trimmed.length / 2))
  const scored = poolSet
    .map(r => ({ ...r, dist: damerauLevenshtein(r.stock_name, trimmed) }))
    .filter(r => r.dist <= threshold)
    .sort((x, y) => x.dist - y.dist || x.stock_id.localeCompare(y.stock_id))
    .slice(0, limit)
  return scored
}

/**
 * Atomically consume one image-recognition quota for the given user/date.
 * Separate from `consumeAnalysisQuota` (uses its own table/limit).
 */
export async function consumeRecognitionQuota(userId: number, date: string, max: number): Promise<QuotaResult> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return { allowed: false, used: 0, remaining: 0, max }
    try {
      await pool.request()
        .input('uid', sql.Int, userId)
        .input('d', sql.NVarChar(10), date)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM recognition_usage WHERE user_id = @uid AND usage_date = @d)
          BEGIN
            INSERT INTO recognition_usage (user_id, usage_date, count) VALUES (@uid, @d, 0)
          END
        `)
      const res = await pool.request()
        .input('uid', sql.Int, userId)
        .input('d', sql.NVarChar(10), date)
        .input('max', sql.Int, max)
        .query('UPDATE recognition_usage SET count = count + 1 WHERE user_id = @uid AND usage_date = @d AND count < @max')
      const allowed = (res.rowsAffected[0] ?? 0) > 0
      const used = await getRecognitionUsage(userId, date)
      return { allowed, used, remaining: Math.max(0, max - used), max }
    } catch (e) {
      console.error('[AzureSQL] consumeRecognitionQuota error:', e)
      return { allowed: false, used: 0, remaining: 0, max }
    }
  }

  const db = getSqliteDb()
  if (!db) return { allowed: false, used: 0, remaining: 0, max }
  try {
    db.prepare('INSERT OR IGNORE INTO recognition_usage (user_id, usage_date, count) VALUES (?, ?, 0)').run(userId, date)
    const res = db.prepare('UPDATE recognition_usage SET count = count + 1 WHERE user_id = ? AND usage_date = ? AND count < ?').run(userId, date, max)
    const allowed = res.changes > 0
    const used = await getRecognitionUsage(userId, date)
    return { allowed, used, remaining: Math.max(0, max - used), max }
  } catch (e) {
    console.error('[SQLite] consumeRecognitionQuota error:', e)
    return { allowed: false, used: 0, remaining: 0, max }
  }
}

// ─── AI Agent 競技場 (arena_*) ──────────────────────────────────

export const ARENA_MAX_AGENTS_PER_USER = 1

export interface ArenaSeasonRow {
  id: number
  name: string
  status: 'registration' | 'live' | 'closed'
  start_date: string | null
  end_date: string | null
  registration_start: string | null
  registration_end: string | null
  created_at?: string
}

export interface ArenaAgentRow {
  id: number
  season_id: number
  owner_user_id: number
  name: string
  division: 'season' | 'open'
  strategy_id: string
  tone: 'aggressive' | 'neutral' | 'conservative'
  personality: string | null
  strategy_params: string | null
  initial_capital: number
  cash: number
  status: 'active' | 'paused' | 'reset'
  is_system: number
  joined_at: string | null
  adjust_count: number
  last_round_date: string | null
  reset_note: string | null
  created_at?: string
}

export interface ArenaHoldingRow {
  agent_id: number
  symbol: string
  symbol_name: string | null
  shares: number
  avg_cost: number
  updated_round_date: string | null
}

export interface ArenaTradeRow {
  id: number
  agent_id: number
  round_date: string
  slot: number | null
  action: string
  symbol: string | null
  symbol_name: string | null
  shares: number | null
  price: number | null
  fee: number | null
  tax: number | null
  reason: string | null
  model: string | null
  fallback_used: number
  error: string | null
  created_at?: string
}

export interface ArenaSnapshotRow {
  id: number
  agent_id: number
  season_id: number
  round_date: string
  cash: number
  equity: number
  return_pct: number
}

export interface ArenaIntradayPriceRow {
  round_date: string
  symbol: string
  slot: number
  time_label: string | null
  price: number
  change_pct: number | null
  created_at?: string
}

export interface ArenaMarketBriefingRow {
  round_date: string
  content: string
  model: string | null
  fallback_used: number
  created_at?: string
}

export interface ArenaDecisionLogRow {
  id: number
  agent_id: number
  season_id: number | null
  round_date: string
  phase: string
  slot: number | null
  content: string
  model: string | null
  fallback_used: number
  created_at?: string
}

export interface ArenaDiscussionRow {
  round_date: string
  content: string
  model: string | null
  fallback_used: number
  created_at?: string
}

export interface ArenaAgentInput {
  name: string
  division: 'season' | 'open'
  strategyId: string
  tone: 'aggressive' | 'neutral' | 'conservative'
  personality?: string | null
  strategyParams?: Record<string, unknown> | null
  initialCapital?: number
}

export async function saveArenaSeason(input: {
  name: string
  status?: ArenaSeasonRow['status']
  startDate?: string
  endDate?: string
  registrationStart?: string
  registrationEnd?: string
}): Promise<number> {
  const status = input.status ?? 'registration'
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const result = await pool.request()
          .input('name', sql.NVarChar(100), input.name)
          .input('status', sql.NVarChar(20), status)
          .input('start', sql.NVarChar(20), input.startDate ?? null)
          .input('end', sql.NVarChar(20), input.endDate ?? null)
          .input('regStart', sql.NVarChar(20), input.registrationStart ?? null)
          .input('regEnd', sql.NVarChar(20), input.registrationEnd ?? null)
          .query(`
            INSERT INTO arena_seasons (name, status, start_date, end_date, registration_start, registration_end)
            VALUES (@name, @status, @start, @end, @regStart, @regEnd);
            SELECT SCOPE_IDENTITY() AS id
          `)
        return Number(result.recordset?.[0]?.id ?? -1)
      } catch (e) {
        console.error('[AzureSQL] saveArenaSeason error:', e)
      }
    }
    return -1
  }
  const db = getSqliteDb()
  if (!db) return -1
  try {
    const info = db.prepare(`
      INSERT INTO arena_seasons (name, status, start_date, end_date, registration_start, registration_end)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.name, status, input.startDate ?? null, input.endDate ?? null, input.registrationStart ?? null, input.registrationEnd ?? null)
    return Number(info.lastInsertRowid)
  } catch (e) {
    console.error('[SQLite] saveArenaSeason error:', e)
    return -1
  }
}

export async function getArenaSeasonById(id: number): Promise<ArenaSeasonRow | undefined> {
  return dbQueryFirst<ArenaSeasonRow>('SELECT * FROM arena_seasons WHERE id = @id LIMIT 1', { id })
}

export async function getActiveArenaSeason(): Promise<ArenaSeasonRow | undefined> {
  const existing = await dbQueryFirst<ArenaSeasonRow>(
    "SELECT * FROM arena_seasons WHERE status IN ('registration', 'live') ORDER BY id DESC LIMIT 1",
  )
  if (existing) {
    // 已有進行中賽季：確認該賽季已種入系統示範 agent。
    await ensureSystemArenaAgents(existing.id)
    return existing
  }
  // 沒有進行中賽季時自動建立一筆預設常駐賽季（live），確保賽場隨時可加入。
  return ensureActiveArenaSeason()
}

export async function ensureActiveArenaSeason(): Promise<ArenaSeasonRow | undefined> {
  const name = `${new Date().getFullYear()} 常駐賽季`
  const id = await saveArenaSeason({ name, status: 'live' })
  if (id <= 0) return undefined
  await ensureSystemArenaAgents(id)
  return getArenaSeasonById(id)
}

const SYSTEM_DEMO_AGENTS: Array<{
  name: string
  strategy_id: string
  tone: string
  personality: string
  strategy_params: Record<string, number>
}> = [
  {
    name: '存股老阿伯',
    strategy_id: 'buffett',
    tone: 'conservative',
    personality: 'zen',
    strategy_params: { maxPositionPct: 25, stopLossPct: 20, minCashBufferPct: 10, maxTradesPerSlot: 2 },
  },
  {
    name: '少年股神阿虎',
    strategy_id: 'growth',
    tone: 'aggressive',
    personality: 'decisive',
    strategy_params: { maxPositionPct: 40, stopLossPct: 10, minCashBufferPct: 0, maxTradesPerSlot: 5 },
  },
  {
    name: '股息包租嬤',
    strategy_id: 'dividend',
    tone: 'conservative',
    personality: 'risk_averse',
    strategy_params: { maxPositionPct: 20, stopLossPct: 15, minCashBufferPct: 15, maxTradesPerSlot: 2 },
  },
  {
    name: '佛系平衡嬤',
    strategy_id: 'balanced',
    tone: 'neutral',
    personality: 'contrarian',
    strategy_params: { maxPositionPct: 30, stopLossPct: 15, minCashBufferPct: 5, maxTradesPerSlot: 3 },
  },
]

// 內建系統示範 agent：一律 owner_user_id = 0、division = 'open'、is_system = 1。
// 不佔一般使用者名額，並隨每日 tick 一起參與（含 ETF 池），顯示於公開排行榜。
export async function ensureSystemArenaAgents(seasonId: number): Promise<number> {
  const existing = await dbQueryFirst<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM arena_agents WHERE season_id = @seasonId AND owner_user_id = 0',
    { seasonId },
  )
  const today = new Date().toISOString().slice(0, 10)
  if ((existing?.cnt ?? 0) > 0) {
    // 冪等補齊既有系統 agent 的性格與參數
    for (const demo of SYSTEM_DEMO_AGENTS) {
      await dbExecute(
        `UPDATE arena_agents
         SET personality = @personality, strategy_params = @params
         WHERE season_id = @seasonId AND owner_user_id = 0 AND name = @name AND (personality IS NULL OR strategy_params IS NULL)`,
        { seasonId, name: demo.name, personality: demo.personality, params: JSON.stringify(demo.strategy_params) },
      )
    }
    return existing?.cnt ?? 0
  }

  for (const demo of SYSTEM_DEMO_AGENTS) {
    await dbExecute(
      `INSERT INTO arena_agents
        (season_id, owner_user_id, name, division, strategy_id, tone,
         personality, strategy_params, initial_capital, cash, status, is_system, joined_at)
       VALUES (@seasonId, 0, @name, 'open', @strategyId, @tone,
         @personality, @params, 500000, 500000, 'active', 1, @joinedAt)`,
      {
        seasonId,
        name: demo.name,
        strategyId: demo.strategy_id,
        tone: demo.tone,
        personality: demo.personality,
        params: JSON.stringify(demo.strategy_params),
        joinedAt: today,
      },
    )
  }
  return SYSTEM_DEMO_AGENTS.length
}

export async function listArenaSeasons(): Promise<ArenaSeasonRow[]> {
  return dbQueryAll<ArenaSeasonRow>('SELECT * FROM arena_seasons ORDER BY id DESC')
}

export async function updateArenaSeasonStatus(id: number, status: ArenaSeasonRow['status']): Promise<void> {
  await dbExecute('UPDATE arena_seasons SET status = @status WHERE id = @id', { id, status })
}

export async function createArenaAgent(ownerUserId: number, input: ArenaAgentInput): Promise<number> {
  const capital = input.initialCapital ?? 500000
  const nowStr = new Date().toISOString().substring(0, 10)
  const personality = input.personality ?? null
  const strategyParams = input.strategyParams ? JSON.stringify(input.strategyParams) : null

  if (isAzureSql) {
    const pool = await getAzurePool()
    if (pool) {
      try {
        const season = await getActiveArenaSeason()
        const seasonId = season?.id ?? -1
        const result = await pool.request()
          .input('seasonId', sql.Int, seasonId)
          .input('owner', sql.Int, ownerUserId)
          .input('name', sql.NVarChar(80), input.name)
          .input('division', sql.NVarChar(10), input.division)
          .input('strategy', sql.NVarChar(40), input.strategyId)
          .input('tone', sql.NVarChar(20), input.tone)
          .input('personality', sql.NVarChar(100), personality)
          .input('params', sql.NVarChar(sql.MAX), strategyParams)
          .input('capital', sql.Float, capital)
          .input('joined', sql.NVarChar(20), nowStr)
          .query(`
            INSERT INTO arena_agents (season_id, owner_user_id, name, division, strategy_id, tone, personality, strategy_params, initial_capital, cash, joined_at)
            VALUES (@seasonId, @owner, @name, @division, @strategy, @tone, @personality, @params, @capital, @capital, @joined);
            SELECT SCOPE_IDENTITY() AS id
          `)
        return Number(result.recordset?.[0]?.id ?? -1)
      } catch (e) {
        console.error('[AzureSQL] createArenaAgent error:', e)
      }
    }
    return -1
  }
  const db = getSqliteDb()
  if (!db) return -1
  try {
    const season = await getActiveArenaSeason()
    const seasonId = season?.id ?? -1
    const info = db.prepare(`
      INSERT INTO arena_agents (season_id, owner_user_id, name, division, strategy_id, tone, personality, strategy_params, initial_capital, cash, joined_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(seasonId, ownerUserId, input.name, input.division, input.strategyId, input.tone, personality, strategyParams, capital, capital, nowStr)
    return Number(info.lastInsertRowid)
  } catch (e) {
    console.error('[SQLite] createArenaAgent error:', e)
    return -1
  }
}

export function getActiveArenaAgentByOwner(ownerUserId: number): Promise<ArenaAgentRow | undefined> {
  return dbQueryFirst<ArenaAgentRow>(
    "SELECT * FROM arena_agents WHERE owner_user_id = @owner AND status = 'active' ORDER BY id DESC LIMIT 1",
    { owner: ownerUserId },
  )
}

export function countArenaAgentsByOwner(ownerUserId: number): Promise<number> {
  return dbQueryFirst<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM arena_agents WHERE owner_user_id = @owner AND status IN ('active', 'paused')",
    { owner: ownerUserId },
  ).then((r) => r?.cnt ?? 0)
}

export function getArenaAgentById(id: number): Promise<ArenaAgentRow | undefined> {
  return dbQueryFirst<ArenaAgentRow>('SELECT * FROM arena_agents WHERE id = @id LIMIT 1', { id })
}

export function listActiveArenaAgents(): Promise<ArenaAgentRow[]> {
  return dbQueryAll<ArenaAgentRow>("SELECT * FROM arena_agents WHERE status = 'active' ORDER BY id")
}

export function listArenaAgentsBySeason(seasonId: number): Promise<ArenaAgentRow[]> {
  return dbQueryAll<ArenaAgentRow>("SELECT * FROM arena_agents WHERE season_id = @seasonId AND status = 'active' ORDER BY id", { seasonId })
}

export async function updateArenaAgentConfig(
  id: number,
  patch: { name?: string; strategyId?: string; tone?: string; personality?: string | null; strategyParams?: Record<string, unknown> | null },
): Promise<boolean> {
  const agent = await getArenaAgentById(id)
  if (!agent) return false
  const name = patch.name ?? agent.name
  const strategyId = patch.strategyId ?? agent.strategy_id
  const tone = patch.tone ?? agent.tone
  const personality = patch.personality !== undefined ? patch.personality : agent.personality
  const strategyParams = patch.strategyParams !== undefined ? (patch.strategyParams ? JSON.stringify(patch.strategyParams) : null) : agent.strategy_params
  const changed = strategyId !== agent.strategy_id || tone !== agent.tone
  await dbExecute(
    `UPDATE arena_agents
     SET name = @name, strategy_id = @strategyId, tone = @tone, personality = @personality, strategy_params = @strategyParams, adjust_count = adjust_count + @delta
     WHERE id = @id`,
    { id, name, strategyId, tone, personality, strategyParams, delta: changed ? 1 : 0 },
  )
  return true
}

export async function setArenaAgentStatus(id: number, status: ArenaAgentRow['status'], resetNote?: string): Promise<boolean> {
  const agent = await getArenaAgentById(id)
  if (!agent) return false
  await dbExecute(
    'UPDATE arena_agents SET status = @status, reset_note = @resetNote WHERE id = @id',
    { id, status, resetNote: resetNote ?? agent.reset_note ?? null },
  )
  return true
}

export async function updateArenaAgentLastRound(id: number, roundDate: string): Promise<void> {
  await dbExecute('UPDATE arena_agents SET last_round_date = @roundDate WHERE id = @id', { id, roundDate })
}

export async function updateArenaAgentCash(id: number, cash: number): Promise<void> {
  await dbExecute('UPDATE arena_agents SET cash = @cash WHERE id = @id', { id, cash })
}

export function getArenaHoldings(agentId: number): Promise<ArenaHoldingRow[]> {
  return dbQueryAll<ArenaHoldingRow>('SELECT * FROM arena_holdings WHERE agent_id = @agentId ORDER BY symbol', { agentId })
}

export async function replaceArenaHoldings(
  agentId: number,
  holdings: Array<{ symbol: string; symbolName?: string | null; shares: number; avgCost: number; roundDate: string }>,
): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      await pool.request().input('agentId', sql.Int, agentId).query('DELETE FROM arena_holdings WHERE agent_id = @agentId')
      for (const h of holdings) {
        if (h.shares <= 0) continue
        await pool.request()
          .input('agentId', sql.Int, agentId)
          .input('symbol', sql.NVarChar(20), h.symbol)
          .input('name', sql.NVarChar(100), h.symbolName ?? null)
          .input('shares', sql.Float, h.shares)
          .input('cost', sql.Float, h.avgCost)
          .input('round', sql.NVarChar(20), h.roundDate)
          .query(`
            INSERT INTO arena_holdings (agent_id, symbol, symbol_name, shares, avg_cost, updated_round_date)
            VALUES (@agentId, @symbol, @name, @shares, @cost, @round)
          `)
      }
    } catch (e) {
      console.error('[AzureSQL] replaceArenaHoldings error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    const del = db.prepare('DELETE FROM arena_holdings WHERE agent_id = ?')
    const ins = db.prepare(`
      INSERT INTO arena_holdings (agent_id, symbol, symbol_name, shares, avg_cost, updated_round_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const tx = db.transaction((rows: typeof holdings) => {
      del.run(agentId)
      for (const h of rows) {
        if (h.shares <= 0) continue
        ins.run(agentId, h.symbol, h.symbolName ?? null, h.shares, h.avgCost, h.roundDate)
      }
    })
    tx(holdings)
  } catch (e) {
    console.error('[SQLite] replaceArenaHoldings error:', e)
  }
}

export async function insertArenaTrade(record: {
  agentId: number
  roundDate: string
  slot?: number | null
  action: string
  symbol?: string | null
  symbolName?: string | null
  shares?: number | null
  price?: number | null
  fee?: number | null
  tax?: number | null
  reason?: string | null
  model?: string | null
  fallbackUsed?: boolean
  error?: string | null
}): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      await pool.request()
        .input('agentId', sql.Int, record.agentId)
        .input('round', sql.NVarChar(20), record.roundDate)
        .input('slot', sql.Int, record.slot ?? null)
        .input('action', sql.NVarChar(10), record.action)
        .input('symbol', sql.NVarChar(20), record.symbol ?? null)
        .input('name', sql.NVarChar(100), record.symbolName ?? null)
        .input('shares', sql.Float, record.shares ?? null)
        .input('price', sql.Float, record.price ?? null)
        .input('fee', sql.Float, record.fee ?? null)
        .input('tax', sql.Float, record.tax ?? null)
        .input('reason', sql.NVarChar(sql.MAX), record.reason ?? null)
        .input('model', sql.NVarChar(100), record.model ?? null)
        .input('fb', sql.Int, record.fallbackUsed ? 1 : 0)
        .input('error', sql.NVarChar(500), record.error ?? null)
        .query(`
          INSERT INTO arena_trades (agent_id, round_date, slot, action, symbol, symbol_name, shares, price, fee, tax, reason, model, fallback_used, error)
          VALUES (@agentId, @round, @slot, @action, @symbol, @name, @shares, @price, @fee, @tax, @reason, @model, @fb, @error)
        `)
    } catch (e) {
      console.error('[AzureSQL] insertArenaTrade error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    db.prepare(`
      INSERT INTO arena_trades (agent_id, round_date, slot, action, symbol, symbol_name, shares, price, fee, tax, reason, model, fallback_used, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.agentId, record.roundDate, record.slot ?? null, record.action, record.symbol ?? null, record.symbolName ?? null,
      record.shares ?? null, record.price ?? null, record.fee ?? null, record.tax ?? null, record.reason ?? null,
      record.model ?? null, record.fallbackUsed ? 1 : 0, record.error ?? null)
  } catch (e) {
    console.error('[SQLite] insertArenaTrade error:', e)
  }
}

export function getArenaTrades(agentId: number, limit = 50): Promise<ArenaTradeRow[]> {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200))
  return dbQueryAll<ArenaTradeRow>(`SELECT * FROM arena_trades WHERE agent_id = @agentId ORDER BY round_date DESC, id DESC LIMIT ${safeLimit}`, { agentId })
}

export async function upsertArenaSnapshot(snapshot: {
  agentId: number
  seasonId: number
  roundDate: string
  cash: number
  equity: number
  returnPct: number
}): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      await pool.request()
        .input('agentId', sql.Int, snapshot.agentId)
        .input('round', sql.NVarChar(20), snapshot.roundDate)
        .input('seasonId', sql.Int, snapshot.seasonId)
        .input('cash', sql.Float, snapshot.cash)
        .input('equity', sql.Float, snapshot.equity)
        .input('returnPct', sql.Float, snapshot.returnPct)
        .query(`
          UPDATE arena_equity_snapshots SET season_id = @seasonId, cash = @cash, equity = @equity, return_pct = @returnPct
          WHERE agent_id = @agentId AND round_date = @round;
          IF @@ROWCOUNT = 0
            INSERT INTO arena_equity_snapshots (agent_id, season_id, round_date, cash, equity, return_pct)
            VALUES (@agentId, @seasonId, @round, @cash, @equity, @returnPct)
        `)
    } catch (e) {
      console.error('[AzureSQL] upsertArenaSnapshot error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    db.prepare(`
      INSERT INTO arena_equity_snapshots (agent_id, season_id, round_date, cash, equity, return_pct)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, round_date) DO UPDATE SET
        season_id = excluded.season_id,
        cash = excluded.cash,
        equity = excluded.equity,
        return_pct = excluded.return_pct
    `).run(snapshot.agentId, snapshot.seasonId, snapshot.roundDate, snapshot.cash, snapshot.equity, snapshot.returnPct)
  } catch (e) {
    console.error('[SQLite] upsertArenaSnapshot error:', e)
  }
}

// Issue #38 選邊：維持 ORDER BY round_date ASC（時間序）。
// 取「最新快照」一律用最後一筆（見 @stock/ai-engine arena/returns.ts latestArenaSnapshot）：
// admin `/api/admin/arena/round` 的 equitySeries 依賴 ASC 時間序，改排序會連動影響，故不動 DB。
export function getArenaSnapshots(agentId: number): Promise<ArenaSnapshotRow[]> {
  return dbQueryAll<ArenaSnapshotRow>('SELECT * FROM arena_equity_snapshots WHERE agent_id = @agentId ORDER BY round_date', { agentId })
}

export interface ArenaLeaderboardRow {
  agent_id: number
  agent_name: string
  owner_name: string | null
  division: 'season' | 'open'
  strategy_id: string
  tone: string
  status: string
  is_system: number
  initial_capital: number | null
  equity: number | null
  cash: number | null
  return_pct: number | null
  round_date: string | null
  rounds: number
  joined_at: string | null
}

export function getArenaLeaderboard(seasonId: number, division: 'season' | 'open' | null): Promise<ArenaLeaderboardRow[]> {
  const divisionSql = division ? 'AND a.division = @division' : ''
  return dbQueryAll<ArenaLeaderboardRow>(
    `
      SELECT
        a.id AS agent_id,
        a.name AS agent_name,
        u.display_name AS owner_name,
        a.division,
        a.strategy_id,
        a.tone,
        a.status,
        a.is_system,
        a.initial_capital AS initial_capital,
        s.equity,
        s.cash,
        s.return_pct,
        s.round_date,
        (SELECT COUNT(*) FROM arena_equity_snapshots c WHERE c.agent_id = a.id) AS rounds,
        a.joined_at
      FROM arena_agents a
      LEFT JOIN users u ON u.id = a.owner_user_id
      LEFT JOIN arena_equity_snapshots s ON s.agent_id = a.id
        AND s.round_date = (SELECT MAX(s2.round_date) FROM arena_equity_snapshots s2 WHERE s2.agent_id = a.id)
      WHERE a.season_id = @seasonId ${divisionSql}
      ORDER BY a.division, s.return_pct DESC, s.equity DESC, a.id ASC
    `,
    division ? { seasonId, division } : { seasonId },
  )
}

export function resetArenaAgentLedger(agentId: number): Promise<void> {
  return (async () => {
    await dbExecute('DELETE FROM arena_holdings WHERE agent_id = @agentId', { agentId })
    await dbExecute('DELETE FROM arena_trades WHERE agent_id = @agentId', { agentId })
    await dbExecute('DELETE FROM arena_equity_snapshots WHERE agent_id = @agentId', { agentId })
  })()
}

// ── 盤中時點路徑 (arena_intraday_prices) ──────────────────────
export async function saveArenaIntradayPrices(
  rows: Array<{
    roundDate: string
    symbol: string
    slot: number
    timeLabel?: string | null
    price: number
    changePct?: number | null
  }>,
): Promise<void> {
  if (rows.length === 0) return
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      for (const r of rows) {
        await pool.request()
          .input('round', sql.NVarChar(20), r.roundDate)
          .input('symbol', sql.NVarChar(20), r.symbol)
          .input('slot', sql.Int, r.slot)
          .input('timeLabel', sql.NVarChar(20), r.timeLabel ?? null)
          .input('price', sql.Float, r.price)
          .input('change', sql.Float, r.changePct ?? null)
          .query(`
            UPDATE arena_intraday_prices
            SET time_label = @timeLabel, price = @price, change_pct = @change
            WHERE round_date = @round AND symbol = @symbol AND slot = @slot;
            IF @@ROWCOUNT = 0
              INSERT INTO arena_intraday_prices (round_date, symbol, slot, time_label, price, change_pct)
              VALUES (@round, @symbol, @slot, @timeLabel, @price, @change)
          `)
      }
    } catch (e) {
      console.error('[AzureSQL] saveArenaIntradayPrices error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    const ins = db.prepare(`
      INSERT INTO arena_intraday_prices (round_date, symbol, slot, time_label, price, change_pct)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(round_date, symbol, slot) DO UPDATE SET
        time_label = excluded.time_label,
        price = excluded.price,
        change_pct = excluded.change_pct
    `)
    const tx = db.transaction((items: typeof rows) => {
      for (const r of items) {
        ins.run(r.roundDate, r.symbol, r.slot, r.timeLabel ?? null, r.price, r.changePct ?? null)
      }
    })
    tx(rows)
  } catch (e) {
    console.error('[SQLite] saveArenaIntradayPrices error:', e)
  }
}

export function getArenaIntradayPrices(roundDate: string, symbol?: string): Promise<ArenaIntradayPriceRow[]> {
  if (symbol) {
    return dbQueryAll<ArenaIntradayPriceRow>(
      'SELECT * FROM arena_intraday_prices WHERE round_date = @roundDate AND symbol = @symbol ORDER BY slot ASC',
      { roundDate, symbol },
    )
  }
  return dbQueryAll<ArenaIntradayPriceRow>(
    'SELECT * FROM arena_intraday_prices WHERE round_date = @roundDate ORDER BY symbol ASC, slot ASC',
    { roundDate },
  )
}

// ── 盤前簡報 (arena_market_briefings) ─────────────────────────
export async function saveArenaMarketBriefing(
  roundDate: string,
  content: string,
  model?: string | null,
  fallbackUsed?: boolean | null,
): Promise<void> {
  const fb = fallbackUsed ? 1 : 0
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      await pool.request()
        .input('round', sql.NVarChar(20), roundDate)
        .input('content', sql.NVarChar(sql.MAX), content)
        .input('model', sql.NVarChar(100), model ?? null)
        .input('fb', sql.Int, fb)
        .query(`
          UPDATE arena_market_briefings
          SET content = @content, model = @model, fallback_used = @fb
          WHERE round_date = @round;
          IF @@ROWCOUNT = 0
            INSERT INTO arena_market_briefings (round_date, content, model, fallback_used)
            VALUES (@round, @content, @model, @fb)
        `)
    } catch (e) {
      console.error('[AzureSQL] saveArenaMarketBriefing error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    db.prepare(`
      INSERT INTO arena_market_briefings (round_date, content, model, fallback_used)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(round_date) DO UPDATE SET
        content = excluded.content,
        model = excluded.model,
        fallback_used = excluded.fallback_used
    `).run(roundDate, content, model ?? null, fb)
  } catch (e) {
    console.error('[SQLite] saveArenaMarketBriefing error:', e)
  }
}

export function getArenaMarketBriefing(roundDate: string): Promise<ArenaMarketBriefingRow | undefined> {
  return dbQueryFirst<ArenaMarketBriefingRow>(
    'SELECT * FROM arena_market_briefings WHERE round_date = @roundDate LIMIT 1',
    { roundDate },
  )
}

// ── 分段 tick 進度 (arena_round_progress) ──────────────────────
export async function getArenaRoundProgress(roundDate: string, phase: string): Promise<boolean> {
  const row = await dbQueryFirst<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM arena_round_progress WHERE round_date = @roundDate AND phase = @phase',
    { roundDate, phase },
  )
  return (row?.cnt ?? 0) > 0
}

export async function listArenaRoundProgress(roundDate: string): Promise<Array<{ phase: string; note: string | null; created_at: string | null }>> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return []
    try {
      const rs = await pool.request()
        .input('round', sql.NVarChar(20), roundDate)
        .query('SELECT phase, note, created_at FROM arena_round_progress WHERE round_date = @round')
      return (rs.recordset ?? []).map((r: any) => ({
        phase: r.phase,
        note: r.note,
        created_at: r.created_at,
      }))
    } catch (e) {
      console.error('[AzureSQL] listArenaRoundProgress error:', e)
      return []
    }
  }
  const db = getSqliteDb()
  if (!db) return []
  try {
    const rows = db.prepare(
      'SELECT phase, note, created_at FROM arena_round_progress WHERE round_date = ?',
    ).all(roundDate) as Array<{ phase: string; note: string | null; created_at: string | null }>
    return rows
  } catch (e) {
    console.error('[SQLite] listArenaRoundProgress error:', e)
    return []
  }
}

export async function markArenaRoundProgress(roundDate: string, phase: string, note?: string | null): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      await pool.request()
        .input('round', sql.NVarChar(20), roundDate)
        .input('phase', sql.NVarChar(40), phase)
        .input('note', sql.NVarChar(500), note ?? null)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM arena_round_progress WHERE round_date = @round AND phase = @phase)
            INSERT INTO arena_round_progress (round_date, phase, note) VALUES (@round, @phase, @note)
        `)
    } catch (e) {
      console.error('[AzureSQL] markArenaRoundProgress error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    db.prepare(`
      INSERT INTO arena_round_progress (round_date, phase, note)
      VALUES (?, ?, ?)
      ON CONFLICT(round_date, phase) DO NOTHING
    `).run(roundDate, phase, note ?? null)
  } catch (e) {
    console.error('[SQLite] markArenaRoundProgress error:', e)
  }
}

export async function clearArenaRoundProgress(roundDate: string, phase: string): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      await pool.request()
        .input('round', sql.NVarChar(20), roundDate)
        .input('phase', sql.NVarChar(40), phase)
        .query('DELETE FROM arena_round_progress WHERE round_date = @round AND phase = @phase')
    } catch (e) {
      console.error('[AzureSQL] clearArenaRoundProgress error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    db.prepare('DELETE FROM arena_round_progress WHERE round_date = ? AND phase = ?').run(roundDate, phase)
  } catch (e) {
    console.error('[SQLite] clearArenaRoundProgress error:', e)
  }
}

// ── 每日股票池固化 (arena_round_universe) ───────────────────────
export async function replaceArenaRoundUniverse(
  roundDate: string,
  items: Array<{ symbol: string; name?: string | null }>,
): Promise<void> {
  if (items.length === 0) return
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      const tx = new sql.Transaction(pool)
      await tx.begin()
      try {
        await tx.request()
          .input('round', sql.NVarChar(20), roundDate)
          .query('DELETE FROM arena_round_universe WHERE round_date = @round')
        if (items.length > 0) {
          const rows = items
            .map((i) => `(@round, N'${i.symbol.replace(/'/g, "''")}', ${i.name ? `N'${i.name.replace(/'/g, "''")}'` : 'NULL'})`)
            .join(',\n')
          await tx.request()
            .input('round', sql.NVarChar(20), roundDate)
            .query(`INSERT INTO arena_round_universe (round_date, symbol, name) VALUES ${rows}`)
        }
        await tx.commit()
      } catch (e) {
        await tx.rollback()
        throw e
      }
    } catch (e) {
      console.error('[AzureSQL] replaceArenaRoundUniverse error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    const del = db.prepare('DELETE FROM arena_round_universe WHERE round_date = ?')
    const ins = db.prepare('INSERT INTO arena_round_universe (round_date, symbol, name) VALUES (?, ?, ?)')
    const tx = db.transaction((rowsItems: typeof items) => {
      del.run(roundDate)
      for (const i of rowsItems) ins.run(roundDate, i.symbol, i.name ?? null)
    })
    tx(items)
  } catch (e) {
    console.error('[SQLite] replaceArenaRoundUniverse error:', e)
  }
}

export async function getArenaRoundUniverse(roundDate: string): Promise<Array<{ symbol: string; name: string | null }>> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return []
    try {
      const rs = await pool.request()
        .input('round', sql.NVarChar(20), roundDate)
        .query('SELECT symbol, name FROM arena_round_universe WHERE round_date = @round ORDER BY symbol ASC')
      return (rs.recordset ?? []).map((r: any) => ({ symbol: r.symbol, name: r.name }))
    } catch (e) {
      console.error('[AzureSQL] getArenaRoundUniverse error:', e)
      return []
    }
  }
  const db = getSqliteDb()
  if (!db) return []
  try {
    const rows = db.prepare('SELECT symbol, name FROM arena_round_universe WHERE round_date = ? ORDER BY symbol ASC')
      .all(roundDate) as Array<{ symbol: string; name: string | null }>
    return rows
  } catch (e) {
    console.error('[SQLite] getArenaRoundUniverse error:', e)
    return []
  }
}

// ── 分段重跑清理（force）──────────────────────────────────────
export async function clearArenaPhaseArtifacts(roundDate: string, phase: string, slot?: number | null): Promise<void> {
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      if (phase === 'premarket') {
        await pool.request()
          .input('round', sql.NVarChar(20), roundDate)
          .query('DELETE FROM arena_decision_logs WHERE round_date = @round AND phase = \'premarket\'')
        await pool.request()
          .input('round', sql.NVarChar(20), roundDate)
          .query('DELETE FROM arena_market_briefings WHERE round_date = @round')
        return
      }
      if (phase === 'close') {
        await pool.request()
          .input('round', sql.NVarChar(20), roundDate)
          .query('DELETE FROM arena_equity_snapshots WHERE round_date = @round')
        await pool.request()
          .input('round', sql.NVarChar(20), roundDate)
          .query('DELETE FROM arena_decision_logs WHERE round_date = @round AND phase = \'postclose\'')
        await pool.request()
          .input('round', sql.NVarChar(20), roundDate)
          .query('DELETE FROM arena_discussions WHERE round_date = @round')
        return
      }
      if (phase === 'slot' && slot !== undefined && slot !== null) {
        await pool.request()
          .input('round', sql.NVarChar(20), roundDate)
          .input('slot', sql.Int, slot)
          .query('DELETE FROM arena_trades WHERE round_date = @round AND slot = @slot')
        await pool.request()
          .input('round', sql.NVarChar(20), roundDate)
          .input('slot', sql.Int, slot)
          .query('DELETE FROM arena_decision_logs WHERE round_date = @round AND phase = \'trade\' AND slot = @slot')
        await pool.request()
          .input('round', sql.NVarChar(20), roundDate)
          .input('slot', sql.Int, slot)
          .query('DELETE FROM arena_intraday_prices WHERE round_date = @round AND slot = @slot')
        return
      }
    } catch (e) {
      console.error('[AzureSQL] clearArenaPhaseArtifacts error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    if (phase === 'premarket') {
      db.prepare('DELETE FROM arena_decision_logs WHERE round_date = ? AND phase = ?').run(roundDate, 'premarket')
      db.prepare('DELETE FROM arena_market_briefings WHERE round_date = ?').run(roundDate)
      return
    }
    if (phase === 'close') {
      db.prepare('DELETE FROM arena_equity_snapshots WHERE round_date = ?').run(roundDate)
      db.prepare('DELETE FROM arena_decision_logs WHERE round_date = ? AND phase = ?').run(roundDate, 'postclose')
      db.prepare('DELETE FROM arena_discussions WHERE round_date = ?').run(roundDate)
      return
    }
    if (phase === 'slot' && slot !== undefined && slot !== null) {
      db.prepare('DELETE FROM arena_trades WHERE round_date = ? AND slot = ?').run(roundDate, slot)
      db.prepare('DELETE FROM arena_decision_logs WHERE round_date = ? AND phase = ? AND slot = ?').run(roundDate, 'trade', slot)
      db.prepare('DELETE FROM arena_intraday_prices WHERE round_date = ? AND slot = ?').run(roundDate, slot)
      return
    }
  } catch (e) {
    console.error('[SQLite] clearArenaPhaseArtifacts error:', e)
  }
}

export function getArenaTradesByRound(agentId: number, roundDate: string): Promise<ArenaTradeRow[]> {
  return dbQueryAll<ArenaTradeRow>(
    'SELECT * FROM arena_trades WHERE agent_id = @agentId AND round_date = @roundDate ORDER BY slot ASC, id ASC',
    { agentId, roundDate },
  )
}

export function getArenaTradesAllByRound(roundDate: string): Promise<ArenaTradeRow[]> {
  return dbQueryAll<ArenaTradeRow>(
    'SELECT * FROM arena_trades WHERE round_date = @roundDate ORDER BY agent_id ASC, slot ASC, id ASC',
    { roundDate },
  )
}

// ── 決策時間軸記錄 (arena_decision_logs) ──────────────────────
export async function insertArenaDecisionLog(record: {
  agentId: number
  seasonId?: number | null
  roundDate: string
  phase: string
  slot?: number | null
  content: string
  model?: string | null
  fallbackUsed?: boolean | null
}): Promise<void> {
  const fb = record.fallbackUsed ? 1 : 0
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      await pool.request()
        .input('agentId', sql.Int, record.agentId)
        .input('seasonId', sql.Int, record.seasonId ?? null)
        .input('round', sql.NVarChar(20), record.roundDate)
        .input('phase', sql.NVarChar(20), record.phase)
        .input('slot', sql.Int, record.slot ?? null)
        .input('content', sql.NVarChar(sql.MAX), record.content)
        .input('model', sql.NVarChar(100), record.model ?? null)
        .input('fb', sql.Int, fb)
        .query(`
          INSERT INTO arena_decision_logs (agent_id, season_id, round_date, phase, slot, content, model, fallback_used)
          VALUES (@agentId, @seasonId, @round, @phase, @slot, @content, @model, @fb)
        `)
    } catch (e) {
      console.error('[AzureSQL] insertArenaDecisionLog error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    db.prepare(`
      INSERT INTO arena_decision_logs (agent_id, season_id, round_date, phase, slot, content, model, fallback_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.agentId, record.seasonId ?? null, record.roundDate, record.phase, record.slot ?? null, record.content, record.model ?? null, fb)
  } catch (e) {
    console.error('[SQLite] insertArenaDecisionLog error:', e)
  }
}

export function getArenaDecisionLogs(agentId: number, roundDate?: string): Promise<ArenaDecisionLogRow[]> {
  if (roundDate) {
    return dbQueryAll<ArenaDecisionLogRow>(
      'SELECT * FROM arena_decision_logs WHERE agent_id = @agentId AND round_date = @roundDate ORDER BY id ASC',
      { agentId, roundDate },
    )
  }
  return dbQueryAll<ArenaDecisionLogRow>(
    'SELECT * FROM arena_decision_logs WHERE agent_id = @agentId ORDER BY round_date DESC, id ASC LIMIT 100',
    { agentId },
  )
}

export function getArenaRoundDecisionLogs(roundDate: string): Promise<ArenaDecisionLogRow[]> {
  return dbQueryAll<ArenaDecisionLogRow>(
    'SELECT * FROM arena_decision_logs WHERE round_date = @roundDate ORDER BY agent_id ASC, id ASC',
    { roundDate },
  )
}

// ── 圓桌討論 (arena_discussions) ──────────────────────────────
export async function saveArenaDiscussion(
  roundDate: string,
  content: string,
  model?: string | null,
  fallbackUsed?: boolean | null,
): Promise<void> {
  const fb = fallbackUsed ? 1 : 0
  if (isAzureSql) {
    const pool = await getAzurePool()
    if (!pool) return
    try {
      await pool.request()
        .input('round', sql.NVarChar(20), roundDate)
        .input('content', sql.NVarChar(sql.MAX), content)
        .input('model', sql.NVarChar(100), model ?? null)
        .input('fb', sql.Int, fb)
        .query(`
          UPDATE arena_discussions
          SET content = @content, model = @model, fallback_used = @fb
          WHERE round_date = @round;
          IF @@ROWCOUNT = 0
            INSERT INTO arena_discussions (round_date, content, model, fallback_used)
            VALUES (@round, @content, @model, @fb)
        `)
    } catch (e) {
      console.error('[AzureSQL] saveArenaDiscussion error:', e)
    }
    return
  }
  const db = getSqliteDb()
  if (!db) return
  try {
    db.prepare(`
      INSERT INTO arena_discussions (round_date, content, model, fallback_used)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(round_date) DO UPDATE SET
        content = excluded.content,
        model = excluded.model,
        fallback_used = excluded.fallback_used
    `).run(roundDate, content, model ?? null, fb)
  } catch (e) {
    console.error('[SQLite] saveArenaDiscussion error:', e)
  }
}

export function getArenaDiscussion(roundDate: string): Promise<ArenaDiscussionRow | undefined> {
  return dbQueryFirst<ArenaDiscussionRow>(
    'SELECT * FROM arena_discussions WHERE round_date = @roundDate LIMIT 1',
    { roundDate },
  )
}

/**
 * 歷史輪次日期清單（keyset 分頁，供 agent-arena 時間軸回看用）。
 * 以 arena_equity_snapshots 的 distinct round_date 為權威輪次列表（每輪跑完必寫 snapshots）。
 * @param limit 每頁筆數（呼叫端已夾取 1~30）
 * @param cursor 僅回傳早於此日期（YYYY-MM-DD）的輪次；省略則從最新開始
 */
export function listArenaRoundDates(limit: number, cursor?: string): Promise<Array<{ round_date: string }>> {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 10, 1), 30)
  if (cursor) {
    return dbQueryAll<{ round_date: string }>(
      'SELECT DISTINCT round_date FROM arena_equity_snapshots WHERE round_date < @cursor ORDER BY round_date DESC LIMIT @limit',
      { cursor, limit: safeLimit },
    )
  }
  return dbQueryAll<{ round_date: string }>(
    'SELECT DISTINCT round_date FROM arena_equity_snapshots ORDER BY round_date DESC LIMIT @limit',
    { limit: safeLimit },
  )
}

// ─── 社群小編 (social_posts) ─────────────────────────────────────
export type SocialPostPlatform = 'instagram' | 'threads' | 'facebook'
export type SocialPostStatus = 'pending' | 'container_created' | 'published' | 'failed' | 'dry_run'

export interface SocialPostRow {
  id: number
  platform: SocialPostPlatform
  edition_key: string
  content: string
  image_url: string | null
  status: SocialPostStatus
  container_id: string | null
  external_id: string | null
  error: string | null
  published_at: string | null
  /** IG：發布後自動貼上的第一則留言狀態（posted | failed；其他平台為 null）。 */
  comment_status: string | null
  comment_external_id: string | null
  comment_error: string | null
  /**
   * Issue #31 首回覆問 Meta AI（social_posts 加欄定案，不另建表）：
   * - 去重鍵：同 (platform, edition_key) 列 first_reply_status='posted' 即不重發。
   * - first_reply_category：本次輪換類別（value｜news｜risk｜mood）。
   * - first_reply_text：實際發出的首回覆全文（含 @meta.ai 或去 tag 版）。
   * - first_reply_checked_at＋first_reply_verdict：驗證協議執行記錄
   *  （pending｜keep_tag 常駐｜downgraded 降級去 tag）。
   * 舊庫未跑 024 migration 時這些欄位為 undefined，讀取端一律以 ?? null 承接。
   */
  first_reply_status?: string | null
  first_reply_external_id?: string | null
  first_reply_error?: string | null
  first_reply_category?: string | null
  first_reply_text?: string | null
  first_reply_checked_at?: string | null
  first_reply_verdict?: string | null
  created_at: string
}

export interface SocialPostInput {
  platform: SocialPostPlatform
  editionKey: string
  content: string
  imageUrl?: string | null
}

/** 這期 edition 是否已對該平台發布過任何紀錄（含失敗），用於去重。 */
/**
 * 該平台該 edition 是否「已發布成功」。只認 status='published'；
 * failed / container_created 等未完成狀態允許重試。
 */
export async function hasSocialPosted(platform: string, editionKey: string): Promise<boolean> {
  const row = await dbQueryFirst<{ n: number }>(
    `SELECT COUNT(*) AS n FROM social_posts WHERE platform = @platform AND edition_key = @editionKey AND status = 'published' LIMIT 1`,
    { platform, editionKey },
  )
  return (row?.n ?? 0) > 0
}

/** 計算該平台已「成功發布」的總數（只算 published），用於 IG 圖卡風格的每 N 則輪換。 */
export async function countSocialPublishedPosts(platform: string): Promise<number> {
  const row = await dbQueryFirst<{ n: number }>(
    `SELECT COUNT(*) AS n FROM social_posts WHERE platform = @platform AND status = 'published'`,
    { platform },
  )
  return row?.n ?? 0
}

/** 讀取該平台該 edition 的發文紀錄（含 #31 首回覆欄位）；無紀錄回傳 undefined。 */
export async function getSocialPost(platform: string, editionKey: string): Promise<SocialPostRow | undefined> {
  return dbQueryFirst<SocialPostRow>(
    'SELECT * FROM social_posts WHERE platform = @platform AND edition_key = @editionKey LIMIT 1',
    { platform, editionKey },
  )
}

/** 建立一筆發文紀錄。若同 (platform, edition_key) 已存在則回傳既有紀錄，不重複插入。 */
export async function createSocialPost(input: SocialPostInput): Promise<SocialPostRow> {
  const existing = await dbQueryFirst<SocialPostRow>(
    'SELECT * FROM social_posts WHERE platform = @platform AND edition_key = @editionKey LIMIT 1',
    { platform: input.platform, editionKey: input.editionKey },
  )
  if (existing) return existing

  try {
    await dbExecute(
      `INSERT INTO social_posts (platform, edition_key, content, image_url)
       VALUES (@platform, @editionKey, @content, @imageUrl)`,
      {
        platform: input.platform,
        editionKey: input.editionKey.slice(0, 100),
        content: input.content.slice(0, 4000),
        imageUrl: input.imageUrl ? input.imageUrl.slice(0, 500) : null,
      },
    )
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      const raced = await dbQueryFirst<SocialPostRow>(
        'SELECT * FROM social_posts WHERE platform = @platform AND edition_key = @editionKey LIMIT 1',
        { platform: input.platform, editionKey: input.editionKey },
      )
      if (raced) return raced
    }
    throw e
  }

  const row = await dbQueryFirst<SocialPostRow>(
    'SELECT * FROM social_posts WHERE platform = @platform AND edition_key = @editionKey LIMIT 1',
    { platform: input.platform, editionKey: input.editionKey },
  )
  if (!row) throw new Error('createSocialPost: inserted row not found')
  return row
}

/** 更新發文紀錄狀態與欄位（失敗原因 / container / external id / IG 留言狀態 / #31 首回覆 …）。 */
export async function updateSocialPost(
  id: number,
  patch: Partial<
    Pick<
      SocialPostRow,
      'status' | 'container_id' | 'external_id' | 'error' | 'published_at' | 'image_url' | 'comment_status' | 'comment_external_id' | 'comment_error' | 'first_reply_status' | 'first_reply_external_id' | 'first_reply_error' | 'first_reply_category' | 'first_reply_text' | 'first_reply_checked_at' | 'first_reply_verdict'
    >
  >,
): Promise<void> {
  const sets: string[] = []
  const params: Record<string, any> = { id }
  if (patch.status !== undefined) {
    sets.push('status = @status')
    params.status = patch.status
  }
  if (patch.container_id !== undefined) {
    sets.push('container_id = @container_id')
    params.container_id = patch.container_id
  }
  if (patch.external_id !== undefined) {
    sets.push('external_id = @external_id')
    params.external_id = patch.external_id
  }
  if (patch.error !== undefined) {
    sets.push('error = @error')
    params.error = patch.error
  }
  if (patch.published_at !== undefined) {
    sets.push('published_at = @published_at')
    params.published_at = patch.published_at
  }
  if (patch.image_url !== undefined) {
    sets.push('image_url = @image_url')
    params.image_url = patch.image_url
  }
  if (patch.comment_status !== undefined) {
    sets.push('comment_status = @comment_status')
    params.comment_status = patch.comment_status
  }
  if (patch.comment_external_id !== undefined) {
    sets.push('comment_external_id = @comment_external_id')
    params.comment_external_id = patch.comment_external_id
  }
  if (patch.comment_error !== undefined) {
    sets.push('comment_error = @comment_error')
    params.comment_error = patch.comment_error
  }
  if (patch.first_reply_status !== undefined) {
    sets.push('first_reply_status = @first_reply_status')
    params.first_reply_status = patch.first_reply_status
  }
  if (patch.first_reply_external_id !== undefined) {
    sets.push('first_reply_external_id = @first_reply_external_id')
    params.first_reply_external_id = patch.first_reply_external_id
  }
  if (patch.first_reply_error !== undefined) {
    sets.push('first_reply_error = @first_reply_error')
    params.first_reply_error = patch.first_reply_error
  }
  if (patch.first_reply_category !== undefined) {
    sets.push('first_reply_category = @first_reply_category')
    params.first_reply_category = patch.first_reply_category
  }
  if (patch.first_reply_text !== undefined) {
    sets.push('first_reply_text = @first_reply_text')
    params.first_reply_text = patch.first_reply_text
  }
  if (patch.first_reply_checked_at !== undefined) {
    sets.push('first_reply_checked_at = @first_reply_checked_at')
    params.first_reply_checked_at = patch.first_reply_checked_at
  }
  if (patch.first_reply_verdict !== undefined) {
    sets.push('first_reply_verdict = @first_reply_verdict')
    params.first_reply_verdict = patch.first_reply_verdict
  }
  if (sets.length === 0) return
  await dbExecute(`UPDATE social_posts SET ${sets.join(', ')} WHERE id = @id`, params)
}

/** 查詢最近 N 筆發文紀錄（跨平台或單平台）。 */
export function listSocialPosts(platform?: string, limit = 20): Promise<SocialPostRow[]> {
  if (platform) {
    return dbQueryAll<SocialPostRow>(
      'SELECT * FROM social_posts WHERE platform = @platform ORDER BY id DESC LIMIT ' + Math.max(1, limit),
      { platform },
    )
  }
  return dbQueryAll<SocialPostRow>(
    'SELECT * FROM social_posts ORDER BY id DESC LIMIT ' + Math.max(1, limit),
  )
}

/** 清除該平台該 edition 的發文紀錄（force 重發用）。 */
export async function deleteSocialPostByEdition(platform: string, editionKey: string): Promise<void> {
  await dbExecute(
    'DELETE FROM social_posts WHERE platform = @platform AND edition_key = @editionKey',
    { platform, editionKey },
  )
}

// ─── 後台手動發布用的圖卡快照 (social_card_images) ────────────────
// 乾跑選定、要真的發布的那張圖會以 bytes 快照存下，並由公開 /api/social/card-image
// 提供給 IG/Threads 下載，確保發布的圖與預覽完全一致（og 動態重繪梗圖文案每次不同）。

/** 儲存（覆寫）指定 edition+style 的圖卡 bytes。 */
export async function saveSocialCardImage(editionKey: string, style: string, data: Buffer): Promise<void> {
  await dbExecute(
    'DELETE FROM social_card_images WHERE edition_key = @editionKey AND style = @style',
    { editionKey, style },
  )
  await dbExecute(
    'INSERT INTO social_card_images (edition_key, style, image_data) VALUES (@editionKey, @style, @imageData)',
    { editionKey, style, imageData: data },
  )
}

/** 讀取指定 edition+style 的圖卡 bytes（無則回傳 null）。 */
export async function getSocialCardImage(editionKey: string, style: string): Promise<Buffer | null> {
  const row = await dbQueryFirst<{ image_data: Buffer | null }>(
    'SELECT image_data FROM social_card_images WHERE edition_key = @editionKey AND style = @style',
    { editionKey, style },
  )
  return row?.image_data ?? null
}

// ─── 後台 Agent 設定 (agent_settings) ──────────────────────────────

export interface AgentSettingRow {
  key: string
  value: string | null
  category: string | null
  label: string | null
  updated_at: string | null
}

/** 讀取單一 Agent 設定值；無設定時回傳 null。 */
export async function getAgentSetting(key: string): Promise<string | null> {
  const row = await dbQueryFirst<{ value: string | null }>(
    'SELECT value FROM agent_settings WHERE setting_key = @key',
    { key },
  )
  return row?.value ?? null
}

/** 列出全部 Agent 設定（依 class 排序）。 */
export function listAgentSettings(category?: string): Promise<AgentSettingRow[]> {
  if (category) {
    return dbQueryAll<AgentSettingRow>(
      'SELECT setting_key AS [key], value, category, label, updated_at FROM agent_settings WHERE category = @category ORDER BY setting_key',
      { category },
    )
  }
  return dbQueryAll<AgentSettingRow>(
    'SELECT setting_key AS [key], value, category, label, updated_at FROM agent_settings ORDER BY category, setting_key',
  )
}

/** 寫入或更新 Agent 設定；回傳是否為新增。 */
export async function setAgentSetting(input: {
  key: string
  value: string
  category?: string
  label?: string
}): Promise<boolean> {
  const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
  const existing = await dbQueryFirst<{ key: string }>(
    'SELECT setting_key AS [key] FROM agent_settings WHERE setting_key = @key',
    { key: input.key },
  )
  if (existing) {
    await dbExecute(
      'UPDATE agent_settings SET value = @value, updated_at = @updatedAt WHERE setting_key = @key',
      { key: input.key, value: input.value, updatedAt: nowIso() },
    )
    return false
  }
  await dbExecute(
    `INSERT INTO agent_settings (setting_key, value, category, label, updated_at)
     VALUES (@key, @value, @category, @label, @updatedAt)`,
    {
      key: input.key,
      value: input.value,
      category: input.category ?? null,
      label: input.label ?? null,
      updatedAt: nowIso(),
    },
  )
  return true
}

// ─── 後台使用者用量報表 ──────────────────────────────────────────

export interface UserUsageReportRow {
  userId: number
  displayName: string | null
  email: string | null
  createdAt: string | null
  apiUsageCount: number
  recognitionCount: number
  arenaAgentCount: number
}

/** 彙總每位使用者的 API / 辨識 / 競技場用量報表。 */
export async function getUserUsageReport(): Promise<UserUsageReportRow[]> {
  const rows = await dbQueryAll<any>(
    `SELECT
       u.id AS userId,
       u.display_name AS displayName,
       u.email AS email,
       u.created_at AS createdAt,
       (SELECT COALESCE(SUM(a.count), 0) FROM api_usage a WHERE a.user_id = u.id) AS apiUsageCount,
       (SELECT COALESCE(SUM(r.count), 0) FROM recognition_usage r WHERE r.user_id = u.id) AS recognitionCount,
       (SELECT COUNT(*) FROM arena_agents aa WHERE aa.owner_user_id = u.id) AS arenaAgentCount
     FROM users u
     ORDER BY u.id DESC`,
  )
  return (rows ?? []).map((r) => ({
    userId: Number(r.userId),
    displayName: r.displayName ?? null,
    email: r.email ?? null,
    createdAt: r.createdAt ?? null,
    apiUsageCount: Number(r.apiUsageCount ?? 0),
    recognitionCount: Number(r.recognitionCount ?? 0),
    arenaAgentCount: Number(r.arenaAgentCount ?? 0),
  }))
}

// ─── 市場焦點電子報訂閱 (market_focus_subscribers) ────────────────

export type MarketFocusSubscriberStatus = 'active' | 'pending' | 'unsubscribed'

export interface MarketFocusSubscriberRow {
  id: number
  email: string
  status: MarketFocusSubscriberStatus
  token: string
  created_at: string
  updated_at: string
  unsubscribed_at: string | null
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function newSubscriberToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * 訂閱（double opt-in 第一段）：建立 pending 紀錄並換發新 token。
 * 確認信寄出後，使用者點擊 /api/market-focus/confirm 才會轉為 active。
 * 已存在的 email（含 active）一律回 pending 並換新 token，需重新確認。
 */
export async function subscribeMarketFocus(email: string): Promise<MarketFocusSubscriberRow> {
  const normalized = email.trim().toLowerCase().slice(0, 255)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('invalid email')
  }
  const existing = await dbQueryFirst<MarketFocusSubscriberRow>(
    'SELECT * FROM market_focus_subscribers WHERE email = @email LIMIT 1',
    { email: normalized },
  )
  if (existing) {
    await dbExecute(
      `UPDATE market_focus_subscribers
         SET status = 'pending', token = @token, unsubscribed_at = NULL, updated_at = @updatedAt
       WHERE email = @email`,
      { email: normalized, token: newSubscriberToken(), updatedAt: nowIso() },
    )
  } else {
    try {
      await dbExecute(
        `INSERT INTO market_focus_subscribers (email, status, token, created_at, updated_at)
         VALUES (@email, 'pending', @token, @createdAt, @updatedAt)`,
        { email: normalized, token: newSubscriberToken(), createdAt: nowIso(), updatedAt: nowIso() },
      )
    } catch (e) {
      // UNIQUE race：並發訂閱同一 email 時回填既有紀錄與否即可
      if (String(e).includes('UNIQUE')) {
        const raced = await dbQueryFirst<MarketFocusSubscriberRow>(
          'SELECT * FROM market_focus_subscribers WHERE email = @email LIMIT 1',
          { email: normalized },
        )
        if (raced) return raced
      }
      throw e
    }
  }
  const row = await dbQueryFirst<MarketFocusSubscriberRow>(
    'SELECT * FROM market_focus_subscribers WHERE email = @email LIMIT 1',
    { email: normalized },
  )
  if (!row) throw new Error('subscribeMarketFocus: row not found')
  return row
}

/** 訂閱確認（double opt-in 第二段）：以 email + token 驗證，僅 pending 可轉 active；已 active 時冪等回傳 true。 */
export async function confirmMarketFocusSubscription(email: string, token: string): Promise<boolean> {
  const row = await dbQueryFirst<MarketFocusSubscriberRow>(
    'SELECT * FROM market_focus_subscribers WHERE email = @email LIMIT 1',
    { email: email.trim().toLowerCase() },
  )
  if (!row || row.token !== token) return false
  if (row.status === 'active') return true
  if (row.status !== 'pending') return false
  await dbExecute(
    `UPDATE market_focus_subscribers
       SET status = 'active', unsubscribed_at = NULL, updated_at = @updatedAt
     WHERE id = @id`,
    { id: row.id, updatedAt: nowIso() },
  )
  return true
}

/** 公開退訂：以 email + token 驗證；token 不符或已退訂時回傳 false。 */
export async function unsubscribeMarketFocusByToken(email: string, token: string): Promise<boolean> {
  const row = await dbQueryFirst<MarketFocusSubscriberRow>(
    'SELECT * FROM market_focus_subscribers WHERE email = @email LIMIT 1',
    { email: email.trim().toLowerCase() },
  )
  if (!row || row.status !== 'active' || row.token !== token) return false
  await dbExecute(
    `UPDATE market_focus_subscribers
       SET status = 'unsubscribed', unsubscribed_at = @unsubscribedAt, updated_at = @updatedAt
     WHERE id = @id`,
    { id: row.id, unsubscribedAt: nowIso(), updatedAt: nowIso() },
  )
  return true
}

/** 後台管理用的單筆狀態變更（取消訂閱 / 恢復訂閱）。 */
export async function setMarketFocusSubscriberStatus(id: number, status: MarketFocusSubscriberStatus): Promise<void> {
  await dbExecute(
    `UPDATE market_focus_subscribers
       SET status = @status,
           unsubscribed_at = CASE WHEN @status = 'active' THEN NULL ELSE unsubscribed_at END,
           updated_at = @updatedAt
     WHERE id = @id`,
    { id, status, updatedAt: nowIso() },
  )
  if (status === 'unsubscribed') {
    await dbExecute(
      `UPDATE market_focus_subscribers SET unsubscribed_at = @unsubscribedAt WHERE id = @id AND status = 'unsubscribed'`,
      { id, unsubscribedAt: nowIso() },
    )
  }
}

/** 後台管理用的刪除名單。 */
export async function deleteMarketFocusSubscriber(id: number): Promise<void> {
  await dbExecute('DELETE FROM market_focus_subscribers WHERE id = @id', { id })
}

/** 列出全部訂閱（新→舊）。 */
export function listMarketFocusSubscribers(limit = 500): Promise<MarketFocusSubscriberRow[]> {
  return dbQueryAll<MarketFocusSubscriberRow>(
    'SELECT * FROM market_focus_subscribers ORDER BY id DESC LIMIT ' + Math.max(1, limit),
  )
}

/** 列出所有 active 訂閱者（供電子報寄送）。 */
export function listActiveMarketFocusSubscribers(): Promise<MarketFocusSubscriberRow[]> {
  return dbQueryAll<MarketFocusSubscriberRow>(
    "SELECT * FROM market_focus_subscribers WHERE status = 'active' ORDER BY id",
  )
}

/** 訂閱統計：總數 / 有效 / 待確認 / 已退訂。 */
export async function countMarketFocusSubscribers(): Promise<{ total: number; active: number; pending: number; unsubscribed: number }> {
  const row = await dbQueryFirst<{ total: number; active: number; pending: number; unsubscribed: number }>(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed
    FROM market_focus_subscribers
  `)
  return {
    total: Number(row?.total ?? 0),
    active: Number(row?.active ?? 0),
    pending: Number(row?.pending ?? 0),
    unsubscribed: Number(row?.unsubscribed ?? 0),
  }
}

// ─── LLM Usage Logs (逐次呼叫明細) ───────────────────────────────

/** LLM 用量資料庫寫入輔助型別。 */
export interface LlmUsageLogInput {
  agent: string
  model: string
  usedFallback: boolean
  promptTokens: number
  completionTokens: number
}

/**
 * 將每筆成功 LLM 呼叫寫入 llm_usage_logs 表。
 * fire-and-forget 設計：DB 失敗一律 try/catch 吞掉，絕不影響呼叫方。
 */
export async function logLlmUsage(entry: LlmUsageLogInput): Promise<void> {
  try {
    const usedFallback = entry.usedFallback ? 1 : 0
    const totalTokens = (entry.promptTokens || 0) + (entry.completionTokens || 0)
    await dbExecute(
      `INSERT INTO llm_usage_logs (agent, model, usedFallback, promptTokens, completionTokens, totalTokens)
       VALUES (@agent, @model, @usedFallback, @promptTokens, @completionTokens, @totalTokens)`,
      {
        agent: (entry.agent || '').slice(0, 80),
        model: (entry.model || '').slice(0, 100),
        usedFallback,
        promptTokens: entry.promptTokens || 0,
        completionTokens: entry.completionTokens || 0,
        totalTokens,
      },
    )
  } catch (e) {
    console.error('[DB] logLlmUsage failed:', e)
  }
}

/** LLM Agent 用量報表（per-agent 聚合）。 */
export interface LlmUsageAgentReport {
  agent: string
  callCount: number
  /** 各模型服務的呼叫次數（model → count）。 */
  models: Record<string, number>
  /** 走備援（non-primary）的呼叫次數。 */
  fallbackCalls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface LlmUsageReportResult {
  from: string
  to: string
  agents: LlmUsageAgentReport[]
  total: { callCount: number; fallbackCalls: number; promptTokens: number; completionTokens: number; totalTokens: number }
}

/**
 * 回傳指定時間範圍內的 LLM 用量聚合報表（DB 端 GROUP BY）。
 * 若 from/to 均未提供，預設今日（台灣時區 00:00:00 ~ 23:59:59）。
 * llm_usage_logs 表不存在或無資料時回傳空 agents + 全 0 的 total，不報錯。
 */
export async function getLlmUsageReport(opts?: { from?: string; to?: string }): Promise<LlmUsageReportResult> {
  // 預設今日台灣時區
  const now = new Date()
  const tzOffset = 8 * 60 * 60 * 1000
  const todayTaipei = new Date(now.getTime() + tzOffset)
  const yyyy = todayTaipei.getUTCFullYear()
  const mm = String(todayTaipei.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(todayTaipei.getUTCDate()).padStart(2, '0')
  const todayStr = `${yyyy}-${mm}-${dd}`

  const from = opts?.from ? opts.from.trim() : todayStr
  const to = opts?.to ? opts.to.trim() : todayStr
  const fromDT = `${from} 00:00:00`
  const toDT = `${to} 23:59:59`

  const rows = await dbQueryAll<{
    agent: string
    model: string
    calls: number
    fallbackCalls: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }>(
    `SELECT agent, model, COUNT(*) AS calls,
            SUM(usedFallback) AS fallbackCalls,
            SUM(promptTokens) AS promptTokens,
            SUM(completionTokens) AS completionTokens,
            SUM(totalTokens) AS totalTokens
     FROM llm_usage_logs
     WHERE created_at >= @from AND created_at <= @to
     GROUP BY agent, model
     ORDER BY agent, calls DESC`,
    { from: fromDT, to: toDT },
  )

  // 依 agent 分組，組裝 models 物件
  const agentMap = new Map<string, LlmUsageAgentReport>()
  let totalCalls = 0
  let totalFallbackCalls = 0
  let totalPrompt = 0
  let totalCompletion = 0
  let totalTokens = 0

  for (const row of rows) {
    let agentReport = agentMap.get(row.agent)
    if (!agentReport) {
      agentReport = { agent: row.agent, callCount: 0, models: {}, fallbackCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      agentMap.set(row.agent, agentReport)
    }
    agentReport.callCount += row.calls
    agentReport.models[row.model] = (agentReport.models[row.model] || 0) + row.calls
    agentReport.fallbackCalls += row.fallbackCalls
    agentReport.promptTokens += row.promptTokens
    agentReport.completionTokens += row.completionTokens
    agentReport.totalTokens += row.totalTokens
  }

  // 從 DB GROUP BY 結果中彙整 total
  for (const agentReport of agentMap.values()) {
    totalCalls += agentReport.callCount
    totalFallbackCalls += agentReport.fallbackCalls
    totalPrompt += agentReport.promptTokens
    totalCompletion += agentReport.completionTokens
    totalTokens += agentReport.totalTokens
  }

  return {
    from,
    to,
    agents: Array.from(agentMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    total: { callCount: totalCalls, fallbackCalls: totalFallbackCalls, promptTokens: totalPrompt, completionTokens: totalCompletion, totalTokens },
  }
}

// ─── LLM Usage 日報表＋分鐘級 OTPM（#45；唯讀 llm_usage_logs） ────
// 與 #4 區隔：#4 是逐次寫入（logLlmUsage）＋上方的區間聚合（getLlmUsageReport）。
// 本節只讀表做「per-agent 每日 in/out」與「分鐘級 OTPM 估算」，不新增任何寫入路徑。

/** Groq qwen OTPM 硬上限（9/23 事件）：分鐘級 bucket tokens 的對照基準。 */
export const LLM_OTPM_LIMIT = 1000
/** 單分鐘用量超過此值視為近上限：UI 標紅＋沿用 #24 reportServerError 告警。 */
export const LLM_OTPM_ALERT_THRESHOLD = 800
/** 日報表查詢區間上限（天，Asia/Taipei 日曆日）：超過直接 throw，由 API 轉 400。 */
export const LLM_USAGE_DAILY_MAX_DAYS = 31
/**
 * 日／分鐘聚合的原始列讀取上限（防全表掃描）。
 * 分鐘級固定單日、今日 LLM 呼叫量遠小於此值；日報 31 天區間同樣受此上限保護。
 */
export const LLM_USAGE_ROW_LIMIT = 20000

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
const WALL_CLOCK_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/** 驗證 YYYY-MM-DD；不合法 throw（API 層轉 400）。 */
function assertTaipeiDateStr(v: string, name: string): void {
  if (!DATE_ONLY_RE.test(v)) throw new Error(`${name} 需為 YYYY-MM-DD 格式`)
  const d = new Date(`${v}T00:00:00+08:00`)
  if (Number.isNaN(d.getTime())) throw new Error(`${name} 不是合法日期`)
}

/** 台北今日（YYYY-MM-DD）。 */
export function taipeiTodayStr(nowMs: number = Date.now()): string {
  return new Date(nowMs + TAIPEI_OFFSET_MS).toISOString().slice(0, 10)
}

function taipeiPartsFromInstant(ms: number): { date: string; minute: string } {
  const iso = new Date(ms + TAIPEI_OFFSET_MS).toISOString()
  return { date: iso.slice(0, 10), minute: `${iso.slice(0, 10)} ${iso.slice(11, 16)}` }
}

/**
 * 將 llm_usage_logs.created_at 換算為台北牆鐘的 { date, minute }。
 * - SQLite TEXT 'YYYY-MM-DD HH:MM:SS'（datetime('now','localtime') 無時區）：
 *   依既有慣例（getLlmUsageReport 直接拿台北日期字串比對）視為台北牆鐘，直接取分量。
 * - Date 物件（Azure DATETIME2 經 mssql 回傳）或帶時區的 ISO 字串：視為瞬時，+08:00 換算。
 */
export function toTaipeiParts(ts: string | Date): { date: string; minute: string } {
  if (typeof ts !== 'string') {
    return taipeiPartsFromInstant(ts.getTime())
  }
  const s = ts.trim()
  const wall = s.match(WALL_CLOCK_RE)
  if (wall && !/[+-]\d{2}:?\d{2}$/.test(s) && !s.endsWith('Z')) {
    return { date: wall[1], minute: `${wall[1]} ${wall[2]}` }
  }
  const ms = new Date(s).getTime()
  if (Number.isNaN(ms)) throw new Error(`無法解析時間戳: ${s}`)
  return taipeiPartsFromInstant(ms)
}

/** 台北日（YYYY-MM-DD）。 */
export function taipeiDayOf(ts: string | Date): string {
  return toTaipeiParts(ts).date
}

/** 台北分鐘（'YYYY-MM-DD HH:MM'）。 */
export function taipeiMinuteOf(ts: string | Date): string {
  return toTaipeiParts(ts).minute
}

/** 日／分鐘聚合用的原始列（僅讀取，不含個資）。 */
export interface LlmUsageRawRow {
  agent: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  created_at: string | Date
}

export interface LlmUsageDailyAgentRow {
  agent: string
  callCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface LlmUsageDailyDay {
  date: string
  agents: LlmUsageDailyAgentRow[]
  total: { callCount: number; promptTokens: number; completionTokens: number; totalTokens: number }
}

export interface LlmUsageDailyResult {
  from: string
  to: string
  /** 區間內的每一天（含無資料的日子，total 全 0，方便 7 日趨勢直接畫）。 */
  days: LlmUsageDailyDay[]
  grandTotal: { callCount: number; promptTokens: number; completionTokens: number; totalTokens: number }
}

function emptyDayTotal(): { callCount: number; promptTokens: number; completionTokens: number; totalTokens: number } {
  return { callCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

/** 純函式：原始列 → per-agent 每日聚合（台北日界）。供單測與 getLlmUsageDailyReport 共用。 */
export function groupLlmUsageByDay(rows: LlmUsageRawRow[], from: string, to: string): LlmUsageDailyDay[] {
  const dayMap = new Map<string, Map<string, LlmUsageDailyAgentRow>>()
  for (const r of rows) {
    const date = taipeiDayOf(r.created_at)
    if (date < from || date > to) continue
    let agents = dayMap.get(date)
    if (!agents) {
      agents = new Map()
      dayMap.set(date, agents)
    }
    let row = agents.get(r.agent)
    if (!row) {
      row = { agent: r.agent, callCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      agents.set(r.agent, row)
    }
    row.callCount += 1
    row.promptTokens += r.promptTokens || 0
    row.completionTokens += r.completionTokens || 0
    row.totalTokens += r.totalTokens || 0
  }

  // 區間內逐日補齊（台北日曆日），無資料的日子 total 全 0。
  // 注意：起點為台北午夜瞬時，必須以 taipeiPartsFromInstant 還原日曆日；
  // 直接對該 Date 取 getUTC* 會得到前一天（午夜+08:00 = UTC 前一日 16:00）。
  const days: LlmUsageDailyDay[] = []
  const startMs = new Date(`${from}T00:00:00+08:00`).getTime()
  const endMs = new Date(`${to}T00:00:00+08:00`).getTime()
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const date = taipeiPartsFromInstant(ms).date
    const agents = Array.from((dayMap.get(date) ?? new Map()).values()).sort((a, b) => b.totalTokens - a.totalTokens)
    const total = emptyDayTotal()
    for (const a of agents) {
      total.callCount += a.callCount
      total.promptTokens += a.promptTokens
      total.completionTokens += a.completionTokens
      total.totalTokens += a.totalTokens
    }
    days.push({ date, agents, total })
  }
  return days
}

/**
 * per-agent 每日 tokens（in／out）日報表。
 * 只讀 llm_usage_logs（created_at＋token 欄）；區間上限 31 天、原始列上限 20000，
 * 超過直接 throw（API 轉 400），避免全表掃描。
 */
export async function getLlmUsageDailyReport(opts: { from: string; to: string }): Promise<LlmUsageDailyResult> {
  const from = opts.from.trim()
  const to = opts.to.trim()
  assertTaipeiDateStr(from, 'from')
  assertTaipeiDateStr(to, 'to')
  if (from > to) throw new Error('from 不可晚於 to')
  const spanDays = Math.round(
    (new Date(`${to}T00:00:00+08:00`).getTime() - new Date(`${from}T00:00:00+08:00`).getTime()) / 86_400_000,
  ) + 1
  if (spanDays > LLM_USAGE_DAILY_MAX_DAYS) {
    throw new Error(`日報區間上限 ${LLM_USAGE_DAILY_MAX_DAYS} 天（本次 ${spanDays} 天），請縮小範圍`)
  }

  const rows = await dbQueryAll<LlmUsageRawRow>(
    `SELECT agent, promptTokens, completionTokens, totalTokens, created_at
     FROM llm_usage_logs
     WHERE created_at >= @from AND created_at <= @to
     ORDER BY created_at ASC
     LIMIT ${LLM_USAGE_ROW_LIMIT}`,
    { from: `${from} 00:00:00`, to: `${to} 23:59:59` },
  )
  const days = groupLlmUsageByDay(rows, from, to)
  const grandTotal = emptyDayTotal()
  for (const d of days) {
    grandTotal.callCount += d.total.callCount
    grandTotal.promptTokens += d.total.promptTokens
    grandTotal.completionTokens += d.total.completionTokens
    grandTotal.totalTokens += d.total.totalTokens
  }
  return { from, to, days, grandTotal }
}

export interface LlmUsageMinuteBucket {
  /** 台北分鐘 'YYYY-MM-DD HH:MM'。 */
  minute: string
  totalTokens: number
  callCount: number
  /** 單分鐘用量＞800（近上限）：UI 標紅＋#24 告警。 */
  overThreshold: boolean
}

export interface LlmUsageMinuteResult {
  day: string
  otpmLimit: number
  alertThreshold: number
  /** 分鐘級為估算值（log 時間戳還原，非帳單精確值）：UI 必須加註。 */
  estimated: true
  /** 僅含「有呼叫」的分鐘（全 0 分鐘省略，避免 1440 列噪音）。 */
  buckets: LlmUsageMinuteBucket[]
  peak: LlmUsageMinuteBucket | null
  overMinutes: string[]
}

/** 純函式：原始列 → 每分鐘聚合（台北分鐘，僅保留有呼叫的分鐘）。 */
export function groupLlmUsageByMinute(rows: LlmUsageRawRow[], day: string): LlmUsageMinuteBucket[] {
  const minuteMap = new Map<string, LlmUsageMinuteBucket>()
  for (const r of rows) {
    const parts = toTaipeiParts(r.created_at)
    if (parts.date !== day) continue
    let b = minuteMap.get(parts.minute)
    if (!b) {
      b = { minute: parts.minute, totalTokens: 0, callCount: 0, overThreshold: false }
      minuteMap.set(parts.minute, b)
    }
    b.totalTokens += r.totalTokens || 0
    b.callCount += 1
  }
  const buckets = Array.from(minuteMap.values()).sort((a, b) => (a.minute < b.minute ? -1 : 1))
  for (const b of buckets) {
    b.overThreshold = b.totalTokens > LLM_OTPM_ALERT_THRESHOLD
  }
  return buckets
}

/**
 * 分鐘級 OTPM 估算：以 llm_usage_logs 時間戳還原每分鐘用量，對照上限 1000。
 * 固定單日查詢＋原始列上限 20000；回傳 estimated: true，UI 需註明非帳單精確值。
 */
export async function getLlmUsageMinuteReport(opts: { day: string }): Promise<LlmUsageMinuteResult> {
  const day = opts.day.trim()
  assertTaipeiDateStr(day, 'day')
  const rows = await dbQueryAll<LlmUsageRawRow>(
    `SELECT agent, promptTokens, completionTokens, totalTokens, created_at
     FROM llm_usage_logs
     WHERE created_at >= @from AND created_at <= @to
     ORDER BY created_at ASC
     LIMIT ${LLM_USAGE_ROW_LIMIT}`,
    { from: `${day} 00:00:00`, to: `${day} 23:59:59` },
  )
  const buckets = groupLlmUsageByMinute(rows, day)
  let peak: LlmUsageMinuteBucket | null = null
  for (const b of buckets) {
    if (!peak || b.totalTokens > peak.totalTokens) peak = b
  }
  return {
    day,
    otpmLimit: LLM_OTPM_LIMIT,
    alertThreshold: LLM_OTPM_ALERT_THRESHOLD,
    estimated: true,
    buckets,
    peak,
    overMinutes: buckets.filter((b) => b.overThreshold).map((b) => b.minute),
  }
}
