import { Router } from "express";
import { body, param, query as queryValidator, validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import { authenticate } from "../middleware/auth.js";
import { query } from "../db/pool.js";

const router = Router();

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ detail: "Datos inválidos", errors: errors.array() });
    return true;
  }
  return false;
}

async function fetchProductByCode(code) {
  const { rows } = await query(
    `SELECT p.id, p.code, p.name, p.price, p.active,
            COALESCE(s.quantity, 0) AS stock_quantity
     FROM inventory_products p
     LEFT JOIN inventory_stocks s ON s.product_id = p.id
     WHERE LOWER(p.code) = LOWER($1)`,
    [code]
  );
  return rows.length ? rows[0] : null;
}

async function fetchTransactionWithItems(id) {
  const { rows: transactionRows } = await query(
    `SELECT t.*, u.full_name AS vendedor_nombre, u.email AS vendedor_email, u.role AS vendedor_role
     FROM sales_transactions t
     LEFT JOIN users u ON u.id = COALESCE(t.confirmed_by, t.created_by)
     WHERE t.id = $1`,
    [id]
  );
  if (!transactionRows.length) return null;
  const transaction = transactionRows[0];

  const { rows: items } = await query(
    `SELECT i.id, i.transaction_id, i.product_id, i.quantity, i.unit_price, i.line_total,
            p.code, p.name
     FROM sales_transaction_items i
     JOIN inventory_products p ON p.id = i.product_id
     WHERE i.transaction_id = $1
     ORDER BY i.id`,
    [id]
  );
  transaction.items = items;
  return transaction;
}

function computeTotals(items, descuentoCLP = 0, porcentaje = 0) {
  const subtotal = items.reduce((acc, item) => acc + item.quantity * item.unit_price, 0);
  const descuentoMonetario = Math.min(descuentoCLP || 0, subtotal);
  const restante = subtotal - descuentoMonetario;
  const descuentoPorcentaje = porcentaje ? (restante * (porcentaje / 100)) : 0;
  const totalDescuento = Math.min(descuentoMonetario + descuentoPorcentaje, subtotal);
  const totalFinal = subtotal - totalDescuento;
  return {
    subtotal,
    descuento: totalDescuento,
    total: totalFinal,
    porcentaje: porcentaje || 0,
  };
}

router.use(authenticate);

router.post(
  "/transactions",
  [
    body("items").isArray({ min: 1 }),
    body("items.*.codigo").isString().trim().notEmpty(),
    body("items.*.cantidad").isInt({ min: 1 }),
    body("descuento_carrito").optional().isFloat({ min: 0 }),
    body("porcentaje_descuento").optional().isFloat({ min: 0, max: 100 }),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const descuentoCarrito = Number(req.body.descuento_carrito || 0);
    const porcentajeDescuento = Number(req.body.porcentaje_descuento || 0);

    const expandedItems = [];
    for (const item of req.body.items) {
      const producto = await fetchProductByCode(item.codigo);
      if (!producto || !producto.active) {
        return res.status(400).json({ detail: `Producto ${item.codigo} no disponible` });
      }
      expandedItems.push({
        product_id: producto.id,
        codigo: producto.code,
        nombre: producto.name,
        quantity: Number(item.cantidad),
        unit_price: Number(producto.price),
        stock: Number(producto.stock_quantity || 0),
      });
    }

    const totals = computeTotals(expandedItems, descuentoCarrito, porcentajeDescuento);

    const { rows } = await query(
      `INSERT INTO sales_transactions (total_before_discount, total_discount, total_amount, discount_percent, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, total_amount` ,
      [totals.subtotal, totals.descuento, totals.total, totals.porcentaje, req.user.id]
    );
    const transactionId = rows[0].id;

    const insertPromises = expandedItems.map((item) =>
      query(
        `INSERT INTO sales_transaction_items (transaction_id, product_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)` ,
        [transactionId, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price]
      )
    );
    await Promise.all(insertPromises);

    res.status(201).json({
      id: transactionId,
      estado: rows[0].status,
      total_final: Number(rows[0].total_amount),
    });
  })
);

router.post(
  "/transactions/:id/confirm",
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const transactionId = Number(req.params.id);
    const transaction = await fetchTransactionWithItems(transactionId);
    if (!transaction) return res.status(404).json({ detail: "Transacción no encontrada" });
    if (transaction.status === "CONFIRMADA") {
      return res.status(200).json({ id: transaction.id, estado: "CONFIRMADA", total_final: Number(transaction.total_amount) });
    }
    if (transaction.status === "CANCELADA") {
      return res.status(400).json({ detail: "La transacción está cancelada" });
    }

    const shortages = [];
    for (const item of transaction.items) {
      const { rows } = await query(
        `SELECT quantity FROM inventory_stocks WHERE product_id = $1`,
        [item.product_id]
      );
      const available = rows.length ? Number(rows[0].quantity) : 0;
      if (available < item.quantity) {
        shortages.push({ codigo: item.code, requerido: item.quantity, disponible: available });
      }
    }

    if (shortages.length) {
      const payload = {
        tipo_error: "STOCK_INSUFICIENTE_EMPLEADO",
        detalle: "Stock insuficiente para completar la venta",
        faltantes: shortages,
      };
      return res.status(403).json(payload);
    }

    for (const item of transaction.items) {
      await query(
        `UPDATE inventory_stocks SET quantity = quantity - $1, updated_at = NOW() WHERE product_id = $2`,
        [item.quantity, item.product_id]
      );
    }

    await query(
      `UPDATE sales_transactions
       SET status = 'CONFIRMADA', confirmed_by = $1, confirmed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [req.user.id, transactionId]
    );

    const fresh = await fetchTransactionWithItems(transactionId);
    res.json({ id: fresh.id, estado: fresh.status, total_final: Number(fresh.total_amount) });
  })
);

router.get(
  "/history",
  [
    queryValidator("fecha_inicio").optional().isISO8601(),
    queryValidator("fecha_fin").optional().isISO8601(),
    queryValidator("vendedor").optional().isString(),
    queryValidator("producto").optional().isString(),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const { fecha_inicio, fecha_fin, vendedor, producto } = req.query;
    const conditions = ["t.status = 'CONFIRMADA'"];
    const params = [];

    if (fecha_inicio) {
      params.push(new Date(fecha_inicio));
      conditions.push(`t.confirmed_at >= $${params.length}`);
    }
    if (fecha_fin) {
      params.push(new Date(fecha_fin));
      conditions.push(`t.confirmed_at <= $${params.length}`);
    }
    if (vendedor) {
      params.push(`%${vendedor}%`);
      conditions.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }
    if (producto) {
      params.push(`%${producto}%`);
      conditions.push(`EXISTS (SELECT 1 FROM sales_transaction_items sti JOIN inventory_products ip ON ip.id = sti.product_id
                      WHERE sti.transaction_id = t.id AND (ip.code ILIKE $${params.length} OR ip.name ILIKE $${params.length}))`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await query(
      `SELECT t.id, t.total_amount, t.total_before_discount, t.confirmed_at, t.created_at,
              COALESCE(u.full_name, u.email, 'Sin asignar') AS vendedor
       FROM sales_transactions t
       LEFT JOIN users u ON u.id = COALESCE(t.confirmed_by, t.created_by)
       ${whereClause}
       ORDER BY t.confirmed_at DESC NULLS LAST, t.created_at DESC`,
      params
    );

    const formatter = new Intl.DateTimeFormat("es-CL", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Santiago",
    });

    res.json(
      rows.map((row) => {
        const confirmedAt = row.confirmed_at ? new Date(row.confirmed_at) : null;
        return {
          id: row.id,
          vendedor: row.vendedor,
          total: Number(row.total_amount || 0),
          fecha: row.confirmed_at,
          fecha_local: confirmedAt ? formatter.format(confirmedAt) : null,
          creado_en: row.created_at,
        };
      })
    );
  })
);

router.get(
  "/transactions/:id",
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const transactionId = Number(req.params.id);
    const transaction = await fetchTransactionWithItems(transactionId);
    if (!transaction) return res.status(404).json({ detail: "Transacción no encontrada" });

    const confirmedAt = transaction.confirmed_at ? new Date(transaction.confirmed_at) : null;
    const formatter = new Intl.DateTimeFormat("es-CL", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Santiago",
    });

    res.json({
      id: transaction.id,
      estado: transaction.status,
      fecha_confirmacion: transaction.confirmed_at,
      fecha_confirmacion_local: confirmedAt ? formatter.format(confirmedAt) : null,
      total_sin_descuento: Number(transaction.total_before_discount || 0),
      total_final: Number(transaction.total_amount || 0),
      descuento_aplicado: Number(transaction.total_discount || 0),
      porcentaje_descuento: Number(transaction.discount_percent || 0),
      cantidad_productos: transaction.items.reduce((sum, item) => sum + Number(item.quantity), 0),
      vendedor: {
        nombre_completo: transaction.vendedor_nombre || null,
        username: transaction.vendedor_email || null,
        role: transaction.vendedor_role || null,
      },
      items: transaction.items.map((item) => ({
        id: item.id,
        codigo: item.code,
        nombre: item.name,
        cantidad: Number(item.quantity),
        precio_unitario: Number(item.unit_price),
        subtotal: Number(item.line_total),
      })),
    });
  })
);

export default router;
