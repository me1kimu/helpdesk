import { Router } from "express";
import { body, param, query as queryValidator, validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { query } from "../db/pool.js";

const router = Router();

const PRODUCT_BASE_SELECT = `SELECT p.id, p.code, p.name, p.description, p.price, p.active,
        COALESCE(s.quantity, 0) AS stock_quantity
      FROM inventory_products p
      LEFT JOIN inventory_stocks s ON s.product_id = p.id`;

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ detail: "Datos inválidos", errors: errors.array() });
    return true;
  }
  return false;
}

function mapProductRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    codigo: row.code,
    nombre: row.name,
    descripcion: row.description,
    precio: Number(row.price || 0),
    activo: row.active,
    stock: row.stock_quantity !== null ? Number(row.stock_quantity) : 0,
  };
}

async function fetchProductById(id) {
  const { rows } = await query(`${PRODUCT_BASE_SELECT} WHERE p.id = $1`, [id]);
  return rows.length ? mapProductRow(rows[0]) : null;
}

async function upsertStock(productId, quantity) {
  const qtyNumber = Number(quantity);
  if (Number.isNaN(qtyNumber) || qtyNumber < 0) return;
  await query(
    `INSERT INTO inventory_stocks (product_id, quantity)
     VALUES ($1, $2)
     ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
    [productId, qtyNumber]
  );
}

function decodeProductsPayload(body) {
  if (Array.isArray(body?.productos)) {
    return body.productos;
  }
  if (body?.productos_compressed) {
    try {
      const decoded = Buffer.from(body.productos_compressed, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch (error) {
      return [];
    }
  }
  return [];
}

router.use(authenticate);

router.get(
  "/products",
  [
    queryValidator("codigo").optional().isString(),
    queryValidator("search").optional().isString(),
  ],
  asyncHandler(async (req, res) => {
    const { codigo, search } = req.query;
    const params = [];
    const conditions = [];

    if (codigo) {
      params.push(codigo);
      conditions.push(`LOWER(p.code) = LOWER($${params.length})`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.code ILIKE $${params.length})`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await query(`${PRODUCT_BASE_SELECT} ${whereClause} ORDER BY p.name ASC`, params);
    res.json(rows.map(mapProductRow));
  })
);

router.get(
  "/products/:id",
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const productId = Number(req.params.id);
    const product = await fetchProductById(productId);
    if (!product) return res.status(404).json({ detail: "Producto no encontrado" });
    res.json(product);
  })
);

router.post(
  "/products",
  requireRoles("ADMIN", "COORDINADOR"),
  [
    body("codigo").isString().isLength({ min: 1, max: 120 }),
    body("nombre").isString().isLength({ min: 1, max: 200 }),
    body("precio").isFloat({ min: 0 }),
    body("descripcion").optional().isString(),
    body("activo").optional().isBoolean(),
    body("stock").optional().isInt({ min: 0 }),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const codigo = req.body.codigo.trim();
    const nombre = req.body.nombre.trim();
    const precio = Number(req.body.precio);
    const descripcion = req.body.descripcion?.trim() || null;
    const activo = typeof req.body.activo === "boolean" ? req.body.activo : true;

    const { rows: existing } = await query(`SELECT id FROM inventory_products WHERE LOWER(code) = LOWER($1)`, [codigo]);
    if (existing.length) {
      return res.status(409).json({ detail: "El código ya se encuentra registrado" });
    }

    const { rows } = await query(
      `INSERT INTO inventory_products (code, name, description, price, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [codigo, nombre, descripcion, precio, activo]
    );
    const productId = rows[0].id;

    if (req.body.stock !== undefined) {
      await upsertStock(productId, Number(req.body.stock));
    }

    const product = await fetchProductById(productId);
    res.status(201).json(product);
  })
);

router.put(
  "/products/:id",
  requireRoles("ADMIN", "COORDINADOR"),
  [
    param("id").isInt({ min: 1 }),
    body("codigo").optional().isString().isLength({ min: 1, max: 120 }),
    body("nombre").optional().isString().isLength({ min: 1, max: 200 }),
    body("precio").optional().isFloat({ min: 0 }),
    body("descripcion").optional().isString(),
    body("activo").optional().isBoolean(),
    body("stock").optional().isInt({ min: 0 }),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const productId = Number(req.params.id);
    const existing = await fetchProductById(productId);
    if (!existing) return res.status(404).json({ detail: "Producto no encontrado" });

    const updates = [];
    const params = [];

    if (req.body.codigo) {
      const codigo = req.body.codigo.trim();
      const { rows } = await query(
        `SELECT id FROM inventory_products WHERE LOWER(code) = LOWER($1) AND id <> $2`,
        [codigo, productId]
      );
      if (rows.length) {
        return res.status(409).json({ detail: "El código ya se encuentra registrado" });
      }
      updates.push(`code = $${updates.length + 1}`);
      params.push(codigo);
    }

    if (req.body.nombre) {
      updates.push(`name = $${updates.length + 1}`);
      params.push(req.body.nombre.trim());
    }

    if (req.body.precio !== undefined) {
      updates.push(`price = $${updates.length + 1}`);
      params.push(Number(req.body.precio));
    }

    if (req.body.descripcion !== undefined) {
      updates.push(`description = $${updates.length + 1}`);
      params.push(req.body.descripcion.trim());
    }

    if (req.body.activo !== undefined) {
      updates.push(`active = $${updates.length + 1}`);
      params.push(Boolean(req.body.activo));
    }

    if (updates.length) {
      updates.push(`updated_at = NOW()`);
      params.push(productId);
      await query(`UPDATE inventory_products SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
    }

    if (req.body.stock !== undefined) {
      await upsertStock(productId, Number(req.body.stock));
    }

    const product = await fetchProductById(productId);
    res.json(product);
  })
);

router.delete(
  "/products/:id",
  requireRoles("ADMIN", "COORDINADOR"),
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const productId = Number(req.params.id);
    const product = await fetchProductById(productId);
    if (!product) return res.status(404).json({ detail: "Producto no encontrado" });

    await query(`UPDATE inventory_products SET active = FALSE, updated_at = NOW() WHERE id = $1`, [productId]);
    await query(`UPDATE inventory_stocks SET quantity = 0, updated_at = NOW() WHERE product_id = $1`, [productId]);

    res.status(204).send();
  })
);

router.get(
  "/stocks",
  [queryValidator("product_id").optional().isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const { product_id } = req.query;
    const params = [];
    let whereClause = "";
    if (product_id) {
      params.push(Number(product_id));
      whereClause = "WHERE product_id = $1";
    }
    const { rows } = await query(
      `SELECT id, product_id, quantity, created_at, updated_at FROM inventory_stocks ${whereClause}`,
      params
    );
    res.json(
      rows.map((row) => ({
        id: row.id,
        producto: row.product_id,
        cantidad: Number(row.quantity),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
    );
  })
);

router.post(
  "/stocks",
  requireRoles("ADMIN", "COORDINADOR"),
  [body("producto").isInt({ min: 1 }), body("cantidad").isInt({ min: 0 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const productId = Number(req.body.producto);
    const product = await fetchProductById(productId);
    if (!product) return res.status(404).json({ detail: "Producto no encontrado" });

    await upsertStock(productId, Number(req.body.cantidad));
    const { rows } = await query(`SELECT id, product_id, quantity FROM inventory_stocks WHERE product_id = $1`, [productId]);
    const row = rows[0];
    res.status(201).json({ id: row.id, producto: row.product_id, cantidad: Number(row.quantity) });
  })
);

router.put(
  "/stocks/:id",
  requireRoles("ADMIN", "COORDINADOR"),
  [param("id").isInt({ min: 1 }), body("cantidad").isInt({ min: 0 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const stockId = Number(req.params.id);
    const { rows } = await query(`SELECT product_id FROM inventory_stocks WHERE id = $1`, [stockId]);
    if (!rows.length) return res.status(404).json({ detail: "Registro de stock no encontrado" });

    await query(
      `UPDATE inventory_stocks SET quantity = $1, updated_at = NOW() WHERE id = $2`,
      [Number(req.body.cantidad), stockId]
    );

    const { rows: updated } = await query(`SELECT id, product_id, quantity FROM inventory_stocks WHERE id = $1`, [stockId]);
    const row = updated[0];
    res.json({ id: row.id, producto: row.product_id, cantidad: Number(row.quantity) });
  })
);

function summarizeBulkResult(result) {
  return {
    total_productos: result.total,
    productos_creados: result.created,
    productos_actualizados: result.updated,
    errores: result.errors,
  };
}

async function processBulkProducts(productos, { allowUpdates }) {
  const summary = { total: 0, created: 0, updated: 0, errors: 0 };

  for (const producto of productos) {
    summary.total += 1;
    try {
      const codigo = (producto.codigo || producto.code || "").toString().trim();
      const nombre = (producto.nombre || producto.name || "").toString().trim();
      const precio = Number(producto.precio || producto.price || 0);
      const stock = producto.stock ?? producto.cantidad ?? producto.quantity ?? null;
      if (!codigo || !nombre) {
        summary.errors += 1;
        continue;
      }

      const { rows: existing } = await query(`SELECT id FROM inventory_products WHERE LOWER(code) = LOWER($1)`, [codigo]);
      if (!existing.length) {
        const { rows } = await query(
          `INSERT INTO inventory_products (code, name, price, active)
           VALUES ($1, $2, $3, TRUE)
           RETURNING id`,
          [codigo, nombre, precio]
        );
        if (stock !== null && stock !== undefined) {
          await upsertStock(rows[0].id, Number(stock));
        }
        summary.created += 1;
      } else {
        if (!allowUpdates) {
          summary.errors += 1;
          continue;
        }
        const productId = existing[0].id;
        await query(
          `UPDATE inventory_products SET name = $1, price = $2, updated_at = NOW() WHERE id = $3`,
          [nombre, precio, productId]
        );
        if (stock !== null && stock !== undefined) {
          await upsertStock(productId, Number(stock));
        }
        summary.updated += 1;
      }
    } catch (error) {
      summary.errors += 1;
    }
  }

  return summary;
}

router.post(
  "/products/bulk-import",
  requireRoles("ADMIN", "COORDINADOR"),
  asyncHandler(async (req, res) => {
    const productos = decodeProductsPayload(req.body);
    const summary = await processBulkProducts(productos, { allowUpdates: false });
    res.json(summarizeBulkResult(summary));
  })
);

router.post(
  "/products/bulk-update",
  requireRoles("ADMIN", "COORDINADOR"),
  asyncHandler(async (req, res) => {
    const productos = decodeProductsPayload(req.body);
    const summary = await processBulkProducts(productos, { allowUpdates: true });
    res.json(summarizeBulkResult(summary));
  })
);

export default router;
