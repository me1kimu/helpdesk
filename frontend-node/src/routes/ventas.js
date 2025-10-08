import { Router } from "express";
import { body, param, query as queryValidator, validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { query, pool } from "../db/pool.js";

const router = Router();

const requireInventoryManager = requireRoles("ADMIN", "COORDINADOR");

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
    precio: Number(row.price || 0),
    descripcion: row.description || "",
    stock: Number(row.stock || 0),
    activo: row.active,
  };
}

async function fetchProductById(productId) {
  const { rows } = await query(
    `SELECT p.id, p.code, p.name, p.description, p.price, p.active,
            COALESCE(s.quantity, 0) AS stock, s.id AS stock_id
     FROM inventory_products p
     LEFT JOIN inventory_stocks s ON s.product_id = p.id
     WHERE p.id = $1`,
    [productId]
  );
  if (!rows.length) return null;
  return rows[0];
}

function decodeProductosPayload(body) {
  if (Array.isArray(body.productos)) {
    return body.productos;
  }
  if (body.productos_compressed) {
    try {
      const jsonString = Buffer.from(body.productos_compressed, "base64").toString("utf8");
      return JSON.parse(jsonString);
    } catch (err) {
      throw new Error("No se pudo decodificar productos_compressed");
    }
  }
  return [];
}

router.use(authenticate);

// Productos -------------------------------------------------------------------
router.get(
  ["/productos", "/productos/"],
  asyncHandler(async (req, res) => {
    const search = (req.query.codigo || "").trim();
    const conditions = ["p.active = TRUE"];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push("(p.code ILIKE $1 OR p.name ILIKE $1)");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await query(
      `SELECT p.id, p.code, p.name, p.description, p.price, p.active,
              COALESCE(s.quantity, 0) AS stock
       FROM inventory_products p
       LEFT JOIN inventory_stocks s ON s.product_id = p.id
       ${whereClause}
       ORDER BY p.name ASC`,
      params
    );

    res.json(rows.map(mapProductRow));
  })
);

router.get(
  "/productos/:id",
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const productId = Number(req.params.id);
    const product = await fetchProductById(productId);
    if (!product || !product.active) {
      return res.status(404).json({ detail: "Producto no encontrado" });
    }
    res.json(mapProductRow(product));
  })
);

router.post(
  ["/productos", "/productos/"],
  requireInventoryManager,
  [
    body("codigo").isString().trim().notEmpty().isLength({ max: 64 }),
    body("nombre").isString().trim().notEmpty().isLength({ max: 255 }),
    body("precio").optional().isFloat({ min: 0 }),
    body("descripcion").optional().isString(),
    body("stock").optional().isInt({ min: 0 }),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const codigo = req.body.codigo.trim();
    const nombre = req.body.nombre.trim();
    const descripcion = req.body.descripcion ? req.body.descripcion.trim() : null;
    const precio = Number(req.body.precio ?? 0);
    const stockInicial = Number(req.body.stock ?? 0);

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const { rows } = await client.query(
        `INSERT INTO inventory_products (code, name, description, price)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, description, price, active`,
        [codigo, nombre, descripcion, precio]
      );
      const product = rows[0];

      await client.query(
        `INSERT INTO inventory_stocks (product_id, quantity)
         VALUES ($1, $2)
         ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
        [product.id, Math.max(0, stockInicial)]
      );

      await client.query("COMMIT");

      const fullProduct = await fetchProductById(product.id);
      res.status(201).json(mapProductRow(fullProduct));
    } catch (err) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          // swallow rollback error and rethrow original
        }
      }
      if (err.code === "23505") {
        return res.status(409).json({ detail: "Código de producto ya existe" });
      }
      throw err;
    } finally {
      if (client) {
        client.release();
      }
    }
  })
);

router.put(
  "/productos/:id",
  requireInventoryManager,
  [
    param("id").isInt({ min: 1 }),
    body("codigo").optional().isString().trim().isLength({ max: 64 }),
    body("nombre").optional().isString().trim().isLength({ max: 255 }),
    body("precio").optional().isFloat({ min: 0 }),
    body("descripcion").optional().isString(),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const productId = Number(req.params.id);

    const existing = await fetchProductById(productId);
    if (!existing || !existing.active) {
      return res.status(404).json({ detail: "Producto no encontrado" });
    }

    const updates = [];
    const params = [];

    if (req.body.codigo && req.body.codigo.trim() !== existing.code) {
      updates.push(`code = $${updates.length + 1}`);
      params.push(req.body.codigo.trim());
    }
    if (req.body.nombre && req.body.nombre.trim() !== existing.name) {
      updates.push(`name = $${updates.length + 1}`);
      params.push(req.body.nombre.trim());
    }
    if (req.body.descripcion !== undefined) {
      updates.push(`description = $${updates.length + 1}`);
      params.push(req.body.descripcion ? req.body.descripcion.trim() : null);
    }
    if (req.body.precio !== undefined) {
      updates.push(`price = $${updates.length + 1}`);
      params.push(Number(req.body.precio));
    }

    if (updates.length) {
      params.push(productId);
      try {
        await query(
          `UPDATE inventory_products SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length}`,
          params
        );
      } catch (err) {
        if (err.code === "23505") {
          return res.status(409).json({ detail: "Código de producto ya existe" });
        }
        throw err;
      }
    }

    const fullProduct = await fetchProductById(productId);
    res.json(mapProductRow(fullProduct));
  })
);

router.delete(
  "/productos/:id",
  requireInventoryManager,
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const productId = Number(req.params.id);
    const result = await query(
      `UPDATE inventory_products SET active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [productId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ detail: "Producto no encontrado" });
    }
    res.status(204).send();
  })
);

function decodeProductoRowToStock(row) {
  return {
    id: row.stock_id || row.id,
    producto: row.id,
    cantidad: Number(row.stock || 0),
  };
}

router.get(
  ["/stocks", "/stocks/"],
  [queryValidator("producto").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const productId = Number(req.query.producto);
    const product = await fetchProductById(productId);
    if (!product || !product.active) {
      return res.json([]);
    }
    res.json([decodeProductoRowToStock(product)]);
  })
);

router.post(
  ["/stocks", "/stocks/"],
  requireInventoryManager,
  [
    body("producto").isInt({ min: 1 }),
    body("cantidad").isInt({ min: 0 }),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const productId = Number(req.body.producto);
    const cantidad = Number(req.body.cantidad);

    const product = await fetchProductById(productId);
    if (!product || !product.active) {
      return res.status(404).json({ detail: "Producto no encontrado" });
    }

    const { rows } = await query(
      `INSERT INTO inventory_stocks (product_id, quantity)
       VALUES ($1, $2)
       ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
       RETURNING id, quantity`,
      [productId, cantidad]
    );

    res.status(201).json({ id: rows[0].id, producto: productId, cantidad: Number(rows[0].quantity) });
  })
);

router.put(
  "/stocks/:id",
  requireInventoryManager,
  [param("id").isInt({ min: 1 }), body("producto").isInt({ min: 1 }), body("cantidad").isInt({ min: 0 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const stockId = Number(req.params.id);
    const productId = Number(req.body.producto);
    const cantidad = Number(req.body.cantidad);

    const result = await query(
      `UPDATE inventory_stocks SET quantity = $1, updated_at = NOW()
       WHERE id = $2 AND product_id = $3
       RETURNING id, quantity`,
      [cantidad, stockId, productId]
    );

    if (!result.rowCount) {
      return res.status(404).json({ detail: "Stock no encontrado" });
    }

    res.json({ id: result.rows[0].id, producto: productId, cantidad: Number(result.rows[0].quantity) });
  })
);

router.post(
  "/productos/bulk-import",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    let productos;
    try {
      productos = decodeProductosPayload(req.body);
    } catch (err) {
      return res.status(400).json({ detail: err.message });
    }

    if (!Array.isArray(productos) || !productos.length) {
      return res.status(400).json({ detail: "No se proporcionaron productos" });
    }

    let creados = 0;
    let errores = 0;

    await query("BEGIN");
    try {
      for (const item of productos) {
        if (!item || !item.codigo || !item.nombre) {
          errores += 1;
          continue;
        }
        const codigo = String(item.codigo).trim();
        const nombre = String(item.nombre).trim();
        const precio = Number(item.precio ?? 0);
        const stock = Number(item.stock ?? item.cantidad ?? 0);

        try {
          const { rows } = await query(
            `INSERT INTO inventory_products (code, name, price)
             VALUES ($1, $2, $3)
             ON CONFLICT (code) DO NOTHING
             RETURNING id`,
            [codigo, nombre, precio]
          );
          let productId;
          if (rows.length) {
            creados += 1;
            productId = rows[0].id;
          } else {
            const existing = await query(`SELECT id FROM inventory_products WHERE code = $1`, [codigo]);
            if (!existing.rows.length) {
              errores += 1;
              continue;
            }
            productId = existing.rows[0].id;
          }

          await query(
            `INSERT INTO inventory_stocks (product_id, quantity)
             VALUES ($1, $2)
             ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
            [productId, Math.max(0, stock)]
          );
        } catch (err) {
          errores += 1;
        }
      }
      await query("COMMIT");
    } catch (err) {
      await query("ROLLBACK");
      throw err;
    }

    res.json({ productos_creados: creados, productos_actualizados: 0, errores });
  })
);

router.post(
  "/productos/bulk-update",
  requireInventoryManager,
  asyncHandler(async (req, res) => {
    let productos;
    try {
      productos = decodeProductosPayload(req.body);
    } catch (err) {
      return res.status(400).json({ detail: err.message });
    }

    if (!Array.isArray(productos) || !productos.length) {
      return res.status(400).json({ detail: "No se proporcionaron productos" });
    }

    let creados = 0;
    let actualizados = 0;
    let errores = 0;

    await query("BEGIN");
    try {
      for (const item of productos) {
        if (!item || !item.codigo || !item.nombre) {
          errores += 1;
          continue;
        }
        const codigo = String(item.codigo).trim();
        const nombre = String(item.nombre).trim();
        const precio = Number(item.precio ?? 0);
        const stock = Number(item.stock ?? item.cantidad ?? 0);

        const existing = await query(`SELECT id FROM inventory_products WHERE code = $1`, [codigo]);
        let productId;
        if (existing.rows.length) {
          productId = existing.rows[0].id;
          await query(
            `UPDATE inventory_products
             SET name = $1, price = $2, active = TRUE, updated_at = NOW()
             WHERE id = $3`,
            [nombre, precio, productId]
          );
          actualizados += 1;
        } else {
          const inserted = await query(
            `INSERT INTO inventory_products (code, name, price, active)
             VALUES ($1, $2, $3, TRUE)
             RETURNING id`,
            [codigo, nombre, precio]
          );
          productId = inserted.rows[0].id;
          creados += 1;
        }

        await query(
          `INSERT INTO inventory_stocks (product_id, quantity)
           VALUES ($1, $2)
           ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
          [productId, Math.max(0, stock)]
        );
      }
      await query("COMMIT");
    } catch (err) {
      await query("ROLLBACK");
      throw err;
    }

    res.json({ productos_creados: creados, productos_actualizados: actualizados, errores });
  })
);

// Transacciones ---------------------------------------------------------------
router.post(
  "/transacciones",
  [
    body("items").isArray({ min: 1 }),
    body("items.*.codigo").isString().trim().notEmpty(),
    body("items.*.cantidad").isInt({ min: 1 }),
    body("descuento_carrito").optional().isFloat({ min: 0 }),
    body("porcentaje_descuento").optional().isFloat({ min: 0, max: 100 }),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const items = req.body.items.map((item) => ({
      codigo: String(item.codigo).trim(),
      cantidad: Number(item.cantidad),
    }));

    const descuentoCarrito = Number(req.body.descuento_carrito || 0);
    const porcentajeDesc = Number(req.body.porcentaje_descuento || 0);

    const codes = items.map((item) => item.codigo);
    const { rows: productRows } = await query(
      `SELECT p.id, p.code, p.name, p.price, COALESCE(s.quantity, 0) AS stock
       FROM inventory_products p
       LEFT JOIN inventory_stocks s ON s.product_id = p.id
       WHERE p.code = ANY($1) AND p.active = TRUE`,
      [codes]
    );

    const productsByCode = new Map(productRows.map((row) => [row.code, row]));

    const preparedItems = [];
    for (const item of items) {
      const product = productsByCode.get(item.codigo);
      if (!product) {
        return res.status(400).json({ detail: `Producto ${item.codigo} no existe` });
      }
      const unitPrice = Number(product.price || 0);
      const subtotal = unitPrice * item.cantidad;
      preparedItems.push({
        producto_id: product.id,
        codigo: product.code,
        nombre: product.name,
        cantidad: item.cantidad,
        precio_unitario: unitPrice,
        subtotal,
      });
    }

    const totalBefore = preparedItems.reduce((sum, item) => sum + item.subtotal, 0);
    const absoluteDiscount = Math.max(0, Math.min(descuentoCarrito, totalBefore));
    const afterAbsolute = totalBefore - absoluteDiscount;
    const percent = Math.max(0, Math.min(porcentajeDesc, 100));
    const percentDiscount = afterAbsolute * (percent / 100);
    const totalDiscount = Math.min(totalBefore, absoluteDiscount + percentDiscount);
    const totalFinal = Math.max(0, totalBefore - totalDiscount);

    await query("BEGIN");
    try {
      const { rows } = await query(
        `INSERT INTO sales_transactions (status, total_before_discount, total_discount, total_amount, discount_percent, created_by)
         VALUES ('PENDIENTE', $1, $2, $3, $4, $5)
         RETURNING id` ,
        [totalBefore, totalDiscount, totalFinal, percent, req.user.id]
      );
      const transactionId = rows[0].id;

      for (const item of preparedItems) {
        await query(
          `INSERT INTO sales_transaction_items (transaction_id, product_id, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5)`,
          [transactionId, item.producto_id, item.cantidad, item.precio_unitario, item.subtotal]
        );
      }

      await query("COMMIT");
      res.status(201).json({ id: transactionId, estado: "PENDIENTE" });
    } catch (err) {
      await query("ROLLBACK");
      throw err;
    }
  })
);

router.post(
  "/transacciones/:id/confirmar",
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const transactionId = Number(req.params.id);

    const { rows: transactionRows } = await query(
      `SELECT id, status, total_before_discount, total_discount, total_amount, discount_percent
       FROM sales_transactions WHERE id = $1`,
      [transactionId]
    );
    if (!transactionRows.length) {
      return res.status(404).json({ detail: "Transacción no encontrada" });
    }
    const transaction = transactionRows[0];
    if (transaction.status === "CONFIRMADA") {
      return res.json({ id: transactionId, estado: "CONFIRMADA" });
    }
    if (transaction.status === "CANCELADA") {
      return res.status(400).json({ detail: "La transacción está cancelada" });
    }

    const { rows: items } = await query(
      `SELECT ti.id, ti.product_id, ti.quantity,
              p.code, p.name,
              COALESCE(s.quantity, 0) AS stock
       FROM sales_transaction_items ti
       JOIN inventory_products p ON p.id = ti.product_id
       LEFT JOIN inventory_stocks s ON s.product_id = ti.product_id
       WHERE ti.transaction_id = $1`,
      [transactionId]
    );

    if (!items.length) {
      return res.status(400).json({ detail: "La transacción no tiene items" });
    }

    for (const item of items) {
      if (item.stock < item.quantity) {
        return res.status(403).json({
          tipo_error: "STOCK_INSUFICIENTE_EMPLEADO",
          detalle: `Stock insuficiente para ${item.code}`,
          faltante: item.quantity - item.stock,
          producto: {
            codigo: item.code,
            nombre: item.name,
            stock_disponible: Number(item.stock),
          },
        });
      }
    }

    await query("BEGIN");
    try {
      for (const item of items) {
        await query(
          `UPDATE inventory_stocks SET quantity = quantity - $1, updated_at = NOW()
           WHERE product_id = $2`,
          [item.quantity, item.product_id]
        );
      }

      await query(
        `UPDATE sales_transactions
         SET status = 'CONFIRMADA', confirmed_at = NOW(), confirmed_by = $2
         WHERE id = $1`,
        [transactionId, req.user.id]
      );

      await query("COMMIT");
    } catch (err) {
      await query("ROLLBACK");
      throw err;
    }

    res.json({ id: transactionId, estado: "CONFIRMADA" });
  })
);

router.get(
  "/historial-ventas",
  [
    queryValidator("fecha_inicio").optional().isISO8601(),
    queryValidator("fecha_fin").optional().isISO8601(),
    queryValidator("vendedor").optional().isString(),
    queryValidator("producto").optional().isString(),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const params = [];
    const conditions = ["t.status = 'CONFIRMADA'"];

    if (req.query.fecha_inicio) {
      const fecha = new Date(req.query.fecha_inicio);
      fecha.setHours(0, 0, 0, 0);
      params.push(fecha);
      conditions.push(`t.confirmed_at >= $${params.length}`);
    }
    if (req.query.fecha_fin) {
      const fecha = new Date(req.query.fecha_fin);
      fecha.setHours(23, 59, 59, 999);
      params.push(fecha);
      conditions.push(`t.confirmed_at <= $${params.length}`);
    }
    if (req.query.vendedor) {
      params.push(`%${req.query.vendedor.toLowerCase()}%`);
      conditions.push(
        `(LOWER(COALESCE(u.full_name, '')) ILIKE $${params.length} OR LOWER(COALESCE(u.email, '')) ILIKE $${params.length})`
      );
    }
    let productoFilter = null;
    if (req.query.producto) {
      productoFilter = `%${req.query.producto}%`;
    }

    let sql = `SELECT t.id, t.total_amount, t.confirmed_at, t.created_at,
                      COALESCE(u.full_name, u.email) AS vendedor
               FROM sales_transactions t
               LEFT JOIN users u ON u.id = t.created_by`;

    if (productoFilter) {
      params.push(productoFilter);
      const idx = params.length;
      sql += `
        JOIN sales_transaction_items ti ON ti.transaction_id = t.id
        JOIN inventory_products p ON p.id = ti.product_id AND (
          p.name ILIKE $${idx} OR p.code ILIKE $${idx}
        )`;
    }

    if (conditions.length) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += " ORDER BY t.confirmed_at DESC NULLS LAST, t.created_at DESC";

    const { rows } = await query(sql, params);

    const seen = new Set();
    const result = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      result.push({
        id: row.id,
        vendedor: row.vendedor || "Desconocido",
        total: Number(row.total_amount || 0),
        fecha: row.confirmed_at || row.created_at,
        fecha_local: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
        estado: "CONFIRMADA",
      });
    }

    res.json(result);
  })
);

router.get(
  "/transacciones/:id/detalle",
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const transactionId = Number(req.params.id);

    const { rows: transactionRows } = await query(
      `SELECT t.id, t.status, t.total_before_discount, t.total_discount, t.total_amount,
              t.discount_percent, t.created_at, t.confirmed_at,
              u.id AS vendedor_id, u.full_name, u.email, u.role
       FROM sales_transactions t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.id = $1`,
      [transactionId]
    );

    if (!transactionRows.length) {
      return res.status(404).json({ detail: "Transacción no encontrada" });
    }
    const tx = transactionRows[0];

    const { rows: itemRows } = await query(
      `SELECT ti.id, ti.product_id, ti.quantity, ti.unit_price, ti.line_total,
              p.code, p.name
       FROM sales_transaction_items ti
       JOIN inventory_products p ON p.id = ti.product_id
       WHERE ti.transaction_id = $1`,
      [transactionId]
    );

    const cantidadProductos = itemRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

    res.json({
      id: tx.id,
      estado: tx.status,
      fecha_creacion: tx.created_at,
      fecha_confirmacion_local: tx.confirmed_at ? new Date(tx.confirmed_at).toISOString() : null,
      cantidad_productos: cantidadProductos,
      total_sin_descuento: Number(tx.total_before_discount || 0),
      total_final: Number(tx.total_amount || 0),
      descuento_aplicado: Number(tx.total_discount || 0),
      porcentaje_descuento: Number(tx.discount_percent || 0),
      vendedor: {
        id: tx.vendedor_id,
        nombre_completo: tx.full_name || tx.email || "",
        username: tx.email || "",
        role: tx.role || null,
      },
      items: itemRows.map((row) => ({
        id: row.id,
        producto_id: row.product_id,
        codigo: row.code,
        nombre: row.name,
        cantidad: Number(row.quantity || 0),
        precio_unitario: Number(row.unit_price || 0),
        subtotal: Number(row.line_total || 0),
      })),
    });
  })
);

export default router;
