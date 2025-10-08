import { Router } from "express";
import { query as queryValidator } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { query } from "../db/pool.js";
import { formatISO } from "date-fns";

const router = Router();

router.use(authenticate);
router.use(requireRoles("ADMIN", "COORDINADOR"));

router.get(
  "/dashboard/metrics",
  asyncHandler(async (req, res) => {
    const { rows: todayRows } = await query(
      `SELECT COUNT(*)::INT AS cantidad
       FROM tickets
       WHERE created_at >= date_trunc('day', NOW())`
    );

    const { rows: totalTicketsRows } = await query(
      `SELECT COUNT(*)::INT AS total FROM tickets`
    );

    res.json({
      ventas_hoy: {
        cantidad: Number(todayRows[0]?.cantidad || 0),
        monto: 0,
      },
      total_productos: Number(totalTicketsRows[0]?.total || 0),
    });
  })
);

router.get(
  "/dashboard/chart",
  asyncHandler(async (req, res) => {
    const period = String(req.query.period || "day").toLowerCase();
    const allowed = ["day", "week", "month", "year"];
    if (!allowed.includes(period)) {
      return res.status(400).json({ detail: "Periodo inválido" });
    }

    let labels = [];
    switch (period) {
      case "day":
        labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
        break;
      case "week":
        labels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
        break;
      case "month":
        labels = ["Semana 1", "Semana 2", "Semana 3", "Semana 4"];
        break;
      case "year":
        labels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
        break;
      default:
        labels = [];
    }

    res.json({
      labels,
      data: labels.map(() => 0),
    });
  })
);

router.get(
  "/summary",
  [queryValidator("from").optional().isISO8601(), queryValidator("to").optional().isISO8601()],
  asyncHandler(async (req, res) => {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    const params = [];
    const conditions = [];

    if (from) {
      params.push(from);
      conditions.push(`t.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`t.created_at <= $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `SELECT c.name AS category,
                        COUNT(*) FILTER (WHERE t.status IN ('RESUELTO', 'CERRADO')) AS total_cerrados,
                        COUNT(*) FILTER (WHERE t.status = 'RESUELTO') AS total_resueltos,
                        COUNT(*) FILTER (WHERE t.status = 'CERRADO') AS total_cerrados_estado,
                        AVG(EXTRACT(EPOCH FROM (COALESCE(t.closed_at, NOW()) - t.created_at)) / 3600) AS horas_promedio,
                        SUM(CASE WHEN t.reopen_count > 0 THEN 1 ELSE 0 END)::NUMERIC / GREATEST(COUNT(*),1) * 100 AS tasa_reapertura
                 FROM tickets t
                 JOIN categories c ON c.id = t.categoria_id
                 ${whereClause}
                 GROUP BY c.name
                 ORDER BY c.name`;

    const { rows } = await query(sql, params);

    res.json({
      filters: {
        from: from ? formatISO(from) : null,
        to: to ? formatISO(to) : null,
      },
      summary: rows.map((row) => ({
        category: row.category,
        totalResueltos: Number(row.total_resueltos || 0),
        totalCerrados: Number(row.total_cerrados_estado || 0),
        totalCombinado: Number(row.total_cerrados || 0),
        horasPromedio: row.horas_promedio ? Number(row.horas_promedio).toFixed(2) : null,
        tasaReapertura: row.tasa_reapertura ? Number(row.tasa_reapertura).toFixed(2) : "0.00",
      })),
    });
  })
);

export default router;
