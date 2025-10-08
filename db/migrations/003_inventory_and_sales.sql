BEGIN;

CREATE TABLE inventory_products (
    id            BIGSERIAL PRIMARY KEY,
    code          VARCHAR(64) NOT NULL UNIQUE,
    name          VARCHAR(200) NOT NULL,
    description   TEXT,
    price         NUMERIC(12,2) NOT NULL DEFAULT 0,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_inventory_products_set_timestamp
BEFORE UPDATE ON inventory_products
FOR EACH ROW
EXECUTE PROCEDURE set_timestamp();

CREATE TABLE inventory_stocks (
    id          BIGSERIAL PRIMARY KEY,
    product_id  BIGINT NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
    quantity    INTEGER NOT NULL DEFAULT 0,
    location    VARCHAR(120),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT inventory_stocks_quantity_check CHECK (quantity >= 0)
);

ALTER TABLE inventory_stocks
    ADD CONSTRAINT inventory_stocks_product_unique UNIQUE (product_id);

CREATE TRIGGER trg_inventory_stocks_set_timestamp
BEFORE UPDATE ON inventory_stocks
FOR EACH ROW
EXECUTE PROCEDURE set_timestamp();

CREATE TYPE sales_transaction_status AS ENUM ('PENDIENTE', 'CONFIRMADA', 'CANCELADA');

CREATE TABLE sales_transactions (
    id                    BIGSERIAL PRIMARY KEY,
    status                sales_transaction_status NOT NULL DEFAULT 'PENDIENTE',
    total_before_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_percent      NUMERIC(5,2),
    created_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
    confirmed_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at          TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ,
    cancellation_reason   TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sales_transactions_status ON sales_transactions (status);
CREATE INDEX idx_sales_transactions_created_at ON sales_transactions (created_at DESC);

CREATE TRIGGER trg_sales_transactions_set_timestamp
BEFORE UPDATE ON sales_transactions
FOR EACH ROW
EXECUTE PROCEDURE set_timestamp();

CREATE TABLE sales_transaction_items (
    id             BIGSERIAL PRIMARY KEY,
    transaction_id BIGINT NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
    product_id     BIGINT NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
    quantity       INTEGER NOT NULL CHECK (quantity > 0),
    unit_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sales_transaction_items_transaction ON sales_transaction_items (transaction_id);
CREATE INDEX idx_sales_transaction_items_product ON sales_transaction_items (product_id);

CREATE TRIGGER trg_sales_transaction_items_set_timestamp
BEFORE UPDATE ON sales_transaction_items
FOR EACH ROW
EXECUTE PROCEDURE set_timestamp();

COMMIT;
