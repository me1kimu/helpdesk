// frontend-node/src/server.js  (versión ES Module)

import express from "express";
import path from "path";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// 1) Middlewares
app.use(cors({ origin: "*" }));
app.use(express.json());

// 2) Servir archivos estáticos desde /public
const publicPath = path.join(process.cwd(), "public");
app.use(express.static(publicPath));

// =======================
// Mock API (standalone)
// =======================

// Mock users and simple in-memory session map
const users = {
  admin: {
    password: "admin123",
    username: "admin",
    first_name: "Admin",
    last_name: "User",
    role: "ADMIN",
  },
  trabajador: {
    password: "worker123",
    username: "trabajador",
    first_name: "Empleado",
    last_name: "Demo",
    role: "EMPLOYEE",
  },
};

const sessions = new Map(); // token -> username

// Helper to create a very simple token (NOT a real JWT)
function createToken(username) {
  return `token.${Buffer.from(
    JSON.stringify({ username, iat: Date.now() / 1000 })
  ).toString("base64")}.sig`;
}

// Auth: login to mimic Django endpoint used by index.html
app.post("/ventas/user/login/", (req, res) => {
  const { username, password } = req.body || {};
  const user = users[username];

  if (!user || user.password !== password) {
    return res.status(401).json({ detail: "Credenciales inválidas" });
  }

  const access = createToken(username);
  const refresh = `refresh-${Date.now()}`;
  sessions.set(access, username);

  return res.json({ access, refresh });
});

// Auth: current user info
app.get("/ventas/user/me/", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace("Bearer ", "");
  const username = sessions.get(token);
  if (!username) return res.status(401).json({ detail: "No autorizado" });

  const { password, ...publicUser } = users[username];
  return res.json(publicUser);
});

// Same-origin helper for POS page expecting this
app.get("/api/usuario-actual/", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace("Bearer ", "");
  const username = sessions.get(token);
  if (!username) return res.status(401).json({ detail: "No autorizado" });
  const { password, ...publicUser } = users[username];
  return res.json(publicUser);
});

// Dashboard metrics
app.get("/ventas/dashboard/metrics/", (req, res) => {
  // Datos mock sencillos
  const ventasHoy = { cantidad: 12, monto: 154000 };
  const total_productos = 42;
  return res.json({ ventas_hoy: ventasHoy, total_productos });
});

// Chart metrics
app.get("/ventas/metrics/chart/", (req, res) => {
  const period = req.query.period || "day";
  let labels = [];
  let data = [];

  if (period === "day") {
    labels = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];
    data = [12000, 18000, 35000, 24000, 28000, 19000, 18000];
  } else if (period === "week") {
    labels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    data = [85000, 92000, 78000, 110000, 125000, 140000, 70000];
  } else if (period === "month") {
    labels = ["Sem 1", "Sem 2", "Sem 3", "Sem 4"];
    data = [320000, 285000, 410000, 380000];
  } else if (period === "year") {
    labels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    data = [
      1200000, 980000, 1350000, 1420000, 1500000, 1600000,
      1700000, 1650000, 1580000, 1750000, 1800000, 1900000,
    ];
  }

  return res.json({ labels, data });
});

// =======================
// Inventario (productos y stocks)
// =======================

let productos = [
  { id: 1, codigo: "1001", nombre: "Coca Cola 500ml", precio: 1200, stock: 45 },
  { id: 2, codigo: "1002", nombre: "Pan Hallulla", precio: 1500, stock: 30 },
  { id: 3, codigo: "1003", nombre: "Leche Entera 1L", precio: 1100, stock: 20 },
];
let nextProdId = 4;

// GET /ventas/productos/ (optional ?codigo= filter)
app.get("/ventas/productos/", (req, res) => {
  const { codigo } = req.query;
  if (codigo) {
    const matches = productos.filter(
      (p) => p.codigo.toString().includes(codigo.toString()) || p.nombre.toLowerCase().includes((codigo || "").toLowerCase())
    );
    return res.json(matches);
  }
  return res.json(productos);
});

// GET single product
app.get("/ventas/productos/:id/", (req, res) => {
  const id = Number(req.params.id);
  const p = productos.find((x) => x.id === id);
  if (!p) return res.status(404).json({ detail: "Producto no encontrado" });
  return res.json(p);
});

// POST create product
app.post("/ventas/productos/", (req, res) => {
  const { codigo, nombre, precio } = req.body || {};
  if (!codigo || !nombre) return res.status(400).json({ detail: "Codigo y nombre requeridos" });
  const exists = productos.some((p) => p.codigo.toString() === codigo.toString());
  if (exists) return res.status(409).json({ detail: "Producto con ese código ya existe" });
  const nuevo = { id: nextProdId++, codigo: String(codigo), nombre, precio: Number(precio) || 0, stock: 0 };
  productos.push(nuevo);
  return res.status(201).json(nuevo);
});

// PUT update product
app.put("/ventas/productos/:id/", (req, res) => {
  const id = Number(req.params.id);
  const idx = productos.findIndex((x) => x.id === id);
  if (idx === -1) return res.status(404).json({ detail: "Producto no encontrado" });
  const { codigo, nombre, precio } = req.body || {};
  if (codigo !== undefined) productos[idx].codigo = String(codigo);
  if (nombre !== undefined) productos[idx].nombre = nombre;
  if (precio !== undefined) productos[idx].precio = Number(precio) || 0;
  return res.json(productos[idx]);
});

// DELETE product
app.delete("/ventas/productos/:id/", (req, res) => {
  const id = Number(req.params.id);
  const before = productos.length;
  productos = productos.filter((x) => x.id !== id);
  if (productos.length === before) return res.status(404).json({ detail: "Producto no encontrado" });
  return res.status(204).send();
});

// Stocks endpoints compatible with frontend expectations
app.get("/ventas/stocks/", (req, res) => {
  const { producto } = req.query;
  const id = Number(producto);
  const p = productos.find((x) => x.id === id);
  if (!p) return res.json([]);
  return res.json([{ id: id, producto: id, cantidad: Number(p.stock) || 0 }]);
});

app.post("/ventas/stocks/", (req, res) => {
  const { producto: prodId, cantidad } = req.body || {};
  const id = Number(prodId);
  const p = productos.find((x) => x.id === id);
  if (!p) return res.status(404).json({ detail: "Producto no encontrado" });
  p.stock = Number(cantidad) || 0;
  return res.status(201).json({ id, producto: id, cantidad: p.stock });
});

app.put("/ventas/stocks/:id/", (req, res) => {
  const id = Number(req.params.id);
  const p = productos.find((x) => x.id === id);
  if (!p) return res.status(404).json({ detail: "Producto no encontrado" });
  const { cantidad } = req.body || {};
  p.stock = Number(cantidad) || 0;
  return res.json({ id, producto: id, cantidad: p.stock });
});

// Bulk import/update
function decodeCompressed(compressed) {
  try {
    const jsonStr = Buffer.from(compressed, "base64").toString("utf-8");
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

app.post("/ventas/productos/bulk-import/", (req, res) => {
  const list = req.body?.productos || decodeCompressed(req.body?.productos_compressed) || [];
  let productos_creados = 0;
  let errores = 0;
  for (const it of list) {
    if (!it?.codigo) { errores++; continue; }
    const exists = productos.some((p) => p.codigo.toString() === String(it.codigo));
    if (exists) { continue; }
    productos.push({ id: nextProdId++, codigo: String(it.codigo), nombre: it.nombre || "", precio: Number(it.precio) || 0, stock: 0 });
    productos_creados++;
  }
  return res.json({ productos_creados, errores });
});

app.post("/ventas/productos/bulk-update/", (req, res) => {
  const list = req.body?.productos || decodeCompressed(req.body?.productos_compressed) || [];
  let productos_creados = 0;
  let productos_actualizados = 0;
  let errores = 0;
  for (const it of list) {
    if (!it?.codigo) { errores++; continue; }
    const idx = productos.findIndex((p) => p.codigo.toString() === String(it.codigo));
    if (idx === -1) {
      productos.push({ id: nextProdId++, codigo: String(it.codigo), nombre: it.nombre || "", precio: Number(it.precio) || 0, stock: 0 });
      productos_creados++;
    } else {
      if (it.nombre !== undefined) productos[idx].nombre = it.nombre;
      if (it.precio !== undefined) productos[idx].precio = Number(it.precio) || 0;
      productos_actualizados++;
    }
  }
  return res.json({ productos_creados, productos_actualizados, errores });
});

// =======================
// Transacciones y ventas
// =======================

let transacciones = [];
let nextTxnId = 1;

// Crear transacción
app.post("/ventas/transacciones/", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace("Bearer ", "");
  const username = sessions.get(token);
  if (!username) return res.status(401).json({ detail: "No autorizado" });

  const { items = [], descuento_carrito = 0, porcentaje_descuento = 0 } = req.body || {};

  const tx = {
    id: nextTxnId++,
    estado: "CREADA",
    items: items.map((it) => ({ codigo: String(it.codigo), cantidad: Number(it.cantidad) || 0 })),
    usuario: username,
    creado_en: new Date().toISOString(),
    descuento_carrito: Number(descuento_carrito) || 0,
    porcentaje_descuento: Number(porcentaje_descuento) || 0,
  };
  transacciones.push(tx);
  return res.status(201).json({ id: tx.id });
});

// Confirmar transacción
app.post("/ventas/transacciones/:id/confirmar/", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace("Bearer ", "");
  const username = sessions.get(token);
  if (!username) return res.status(401).json({ detail: "No autorizado" });
  const user = users[username];

  const id = Number(req.params.id);
  const tx = transacciones.find((t) => t.id === id);
  if (!tx) return res.status(404).json({ detail: "Transacción no encontrada" });

  // Verificar stock
  const items_sin_stock = [];
  for (const it of tx.items) {
    const p = productos.find((x) => x.codigo.toString() === it.codigo);
    if (!p || p.stock < it.cantidad) {
      items_sin_stock.push({
        producto: p?.nombre || "Desconocido",
        codigo: it.codigo,
        stock_disponible: p?.stock || 0,
        cantidad_solicitada: it.cantidad,
      });
    }
  }

  if (items_sin_stock.length > 0 && user.role === "EMPLOYEE") {
    return res.status(403).json({
      tipo_error: "STOCK_INSUFICIENTE_EMPLEADO",
      detalle: "Empleado no puede confirmar venta con stock insuficiente.",
      items_sin_stock,
    });
  }

  // Descontar stock
  for (const it of tx.items) {
    const p = productos.find((x) => x.codigo.toString() === it.codigo);
    if (p) p.stock = Math.max(0, (Number(p.stock) || 0) - it.cantidad);
  }

  // Calcular totales
  let total_sin_descuento = 0;
  const items_detalle = tx.items.map((it) => {
    const p = productos.find((x) => x.codigo.toString() === it.codigo);
    const precio_unitario = p?.precio || 0;
    const subtotal = precio_unitario * it.cantidad;
    total_sin_descuento += subtotal;
    return {
      producto_codigo: it.codigo,
      producto_nombre: p?.nombre || "Desconocido",
      producto_activo: Boolean(p),
      cantidad: it.cantidad,
      precio_unitario,
      subtotal,
    };
  });

  const descuento_aplicado = Number(tx.descuento_carrito) || 0;
  const porcentaje_descuento = Number(tx.porcentaje_descuento) || 0;
  const descuento_pct_monto = (total_sin_descuento * porcentaje_descuento) / 100;
  const total_final = Math.max(0, total_sin_descuento - descuento_aplicado - descuento_pct_monto);

  tx.estado = "CONFIRMADA";
  tx.confirmada_en = new Date().toISOString();
  tx.detalle = {
    total_sin_descuento,
    descuento_aplicado,
    porcentaje_descuento,
    total_final,
    items: items_detalle,
    vendedor: {
      username: user.username,
      nombre_completo: `${user.first_name} ${user.last_name}`.trim() || user.username,
      role: user.role,
    },
  };

  return res.json({ estado: tx.estado, total_final });
});

// Detalle de transacción
app.get("/ventas/transacciones/:id/detalle/", (req, res) => {
  const id = Number(req.params.id);
  const tx = transacciones.find((t) => t.id === id);
  if (!tx || tx.estado !== "CONFIRMADA") return res.status(404).json({ detail: "Detalle no disponible" });

  const detalle = {
    id: tx.id,
    estado: tx.estado,
    fecha_confirmacion_local: new Date(tx.confirmada_en).toLocaleString("es-CL", { timeZone: "America/Santiago" }),
    cantidad_productos: tx.detalle.items.reduce((acc, it) => acc + it.cantidad, 0),
    total_sin_descuento: tx.detalle.total_sin_descuento,
    total_final: tx.detalle.total_final,
    descuento_aplicado: tx.detalle.descuento_aplicado,
    porcentaje_descuento: tx.detalle.porcentaje_descuento,
    vendedor: tx.detalle.vendedor,
    items: tx.detalle.items,
  };
  return res.json(detalle);
});

// Historial de ventas con filtros simples
app.get("/ventas/historial-ventas/", (req, res) => {
  const { fecha_inicio, fecha_fin, vendedor, producto } = req.query;
  let lista = transacciones
    .filter((t) => t.estado === "CONFIRMADA")
    .map((t) => ({
      id: t.id,
      vendedor: t.detalle?.vendedor?.username || t.usuario,
      total: t.detalle?.total_final || 0,
      fecha: t.confirmada_en,
    }));

  if (vendedor) lista = lista.filter((x) => x.vendedor.toLowerCase().includes(String(vendedor).toLowerCase()));
  if (producto) {
    const prodStr = String(producto).toLowerCase();
    lista = lista.filter((x) => {
      const tx = transacciones.find((t) => t.id === x.id);
      return tx?.detalle?.items?.some((it) =>
        it.producto_nombre?.toLowerCase().includes(prodStr) || it.producto_codigo?.toLowerCase().includes(prodStr)
      );
    });
  }
  if (fecha_inicio) {
    const start = new Date(fecha_inicio);
    lista = lista.filter((x) => new Date(x.fecha).toDateString() === start.toDateString());
  }

  return res.json(lista);
});

// =======================
// Gestión de usuarios (mock)
// =======================
let usersSeqId = 3; // we have admin/trabajador implicit; assign ids 1 and 2
const usersById = {
  1: { id: 1, username: "admin", first_name: "Admin", last_name: "User", email: "admin@demo.local", role: "ADMIN", is_active: true },
  2: { id: 2, username: "trabajador", first_name: "Empleado", last_name: "Demo", email: "empleado@demo.local", role: "EMPLOYEE", is_active: true },
};

app.get("/ventas/usuarios/", (req, res) => {
  return res.json(Object.values(usersById));
});

app.get("/ventas/usuarios/:id/", (req, res) => {
  const id = Number(req.params.id);
  const u = usersById[id];
  if (!u) return res.status(404).json({ detail: "Usuario no encontrado" });
  return res.json(u);
});

app.post("/ventas/usuarios/", (req, res) => {
  const { username, email, first_name, last_name, role } = req.body || {};
  if (!username || !role) return res.status(400).json({ detail: "username y role son requeridos" });
  const exists = Object.values(usersById).some((u) => u.username === username);
  if (exists) return res.status(409).json({ detail: "Usuario ya existe" });
  const id = ++usersSeqId;
  usersById[id] = { id, username, email: email || "", first_name: first_name || "", last_name: last_name || "", role, is_active: true };
  return res.status(201).json(usersById[id]);
});

app.put("/ventas/usuarios/:id/", (req, res) => {
  const id = Number(req.params.id);
  const u = usersById[id];
  if (!u) return res.status(404).json({ detail: "Usuario no encontrado" });
  const { email, first_name, last_name, role } = req.body || {};
  if (email !== undefined) u.email = email;
  if (first_name !== undefined) u.first_name = first_name;
  if (last_name !== undefined) u.last_name = last_name;
  if (role !== undefined) u.role = role;
  return res.json(u);
});

app.delete("/ventas/usuarios/:id/", (req, res) => {
  const id = Number(req.params.id);
  if (!usersById[id]) return res.status(404).json({ detail: "Usuario no encontrado" });
  delete usersById[id];
  return res.status(204).send();
});

// 3) Rutas limpias
app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});
app.get("/login", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(publicPath, "dashboard.html"));
});
app.get("/inventario", (req, res) => {
  res.sendFile(path.join(publicPath, "inventario.html"));
});
app.get("/pos", (req, res) => {
  res.sendFile(path.join(publicPath, "pos.html"));
});

// Nueva ruta para historial de compras
app.get("/historial-ventas", (req, res) => {
  res.sendFile(path.join(publicPath, "historial-ventas.html"));
});

app.get("/trabajadores", (req, res) => {
  res.sendFile(path.join(publicPath, "trabajadores.html"));
});
app.get("/logout", (req, res) => {
  res.sendFile(path.join(publicPath, "logout.html"));
});

// 4) 404 por defecto
app.use((req, res) => {
  res.status(404).sendFile(path.join(publicPath, "index.html"));
});

// 5) Iniciar servidor
app.listen(PORT, () => {
  console.log(`⚡ Frontend Node.js escuchando en http://localhost:${PORT}`);
});
