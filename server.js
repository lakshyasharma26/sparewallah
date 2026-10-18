require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Pool } = require("pg");
const { createClient } = require("@supabase/supabase-js");

// 1. App initialization pehle
const app = express();

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const UPLOADS = path.join(ROOT, "uploads");

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// 2. CORS setup
const allowedOrigins = [
  "https://sparewallah-public.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith(".vercel.app")) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Preflight requests handling
app.options("*", cors());

// 3. Parsers aur static files (Restore payload ke liye limit 20mb rakhi hai)
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use("/uploads", express.static(UPLOADS));
app.use(express.static(path.join(ROOT, "public")));

// Supabase Client Initialization
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
    realtime: { autoRefreshToken: false, createClient: false }
  }
);

// PostgreSQL Connection Pool Setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

// Multer in-memory storage for cloud upload
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/^image\/(jpeg|png|webp|jpg)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG or WEBP images are allowed"));
  }
});

// Helper: Upload image buffer directly to Supabase Storage Bucket
async function uploadToSupabase(file) {
  if (!file) return "";

  const ext = path.extname(file.originalname);
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) throw error;

  const { data: publicUrlData } = supabase.storage
    .from("product-images")
    .getPublicUrl(fileName);

  return publicUrlData.publicUrl;
}

// Authentication Middleware
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Admin login required" });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET || "default_secret_key");
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired admin token" });
  }
}

function publicProduct(p) {
  return {
    id: String(p.id),
    _id: String(p.id),
    name: p.name,
    brand: p.brand || "",
    type: p.type || "",
    category: p.category || "",
    sku: p.sku || "",
    description: p.description || "",
    price: Number(p.price || 0),
    mrp: Number(p.mrp || 0),
    stock: Number(p.stock || 0),
    image: p.image || p.image_url || "",
    image_url: p.image_url || p.image || "",
    active: p.active === 1 || p.active === true
  };
}

// --- PUBLIC API ROUTES ---

app.get("/api/products", async (req, res) => {
  try {
    let query = "SELECT * FROM products WHERE active = 1";
    const params = [];

    if (req.query.brand && req.query.brand !== "all") {
      params.push(req.query.brand);
      query += ` AND brand = $${params.length}`;
    }
    if (req.query.type && req.query.type !== "all") {
      params.push(req.query.type);
      query += ` AND type = $${params.length}`;
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      const idx = params.length;
      query += ` AND (name ILIKE $${idx} OR sku ILIKE $${idx} OR category ILIKE $${idx})`;
    }

    query += " ORDER BY id DESC";
    const { rows } = await pool.query(query, params);
    res.json(rows.map(publicProduct));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    const p = rows[0];
    if (!p || !p.active) return res.status(404).json({ message: "Product not found" });
    res.json(publicProduct(p));
  } catch (e) {
    res.status(400).json({ message: "Invalid product ID" });
  }
});

app.post("/api/orders", async (req, res) => {
  const { customer, items } = req.body;
  if (!customer?.name || !customer?.phone || !customer?.address || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: "Customer details and cart items are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let total = 0;
    const cleanItems = [];

    for (const item of items) {
      const { rows } = await client.query("SELECT * FROM products WHERE id = $1 AND active = 1 FOR UPDATE", [item.productId]);
      const product = rows[0];
      const qty = Math.max(1, Math.floor(Number(item.quantity)));

      if (!product) throw new Error(`Product not found: ${item.productId}`);
      if (product.stock < qty) throw new Error(`${product.name} has only ${product.stock} item(s) in stock`);

      const price = Number(product.price);
      const subtotal = price * qty;
      cleanItems.push({ productId: product.id, name: product.name, sku: product.sku, price, quantity: qty, subtotal });
      total += subtotal;

      await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [qty, product.id]);
    }

    const countRes = await client.query("SELECT COUNT(*) AS total_orders FROM orders");
    const nextNum = parseInt(countRes.rows[0].total_orders || 0, 10) + 1;
    const orderId = `ORD-${String(nextNum).padStart(4, "0")}`;

    const orderRes = await client.query(
      `INSERT INTO orders (orderId, customer_name, customer_phone, customer_address, customer_city, customer_pincode, subtotal, total, status, source) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [orderId, customer.name, customer.phone, customer.address, customer.city || "", customer.pincode || "", total, total, "Pending", "website"]
    );

    const internalOrderId = orderRes.rows[0].id;

    for (const item of cleanItems) {
      await client.query(
        `INSERT INTO order_items (order_id, productId, name, sku, price, quantity, subtotal) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [internalOrderId, item.productId, item.name, item.sku, item.price, item.quantity, item.subtotal]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ orderId, total, message: "Order placed successfully" });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(400).json({ message: e.message });
  } finally {
    client.release();
  }
});

// --- ADMIN API ROUTES ---

app.post("/api/admin/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const password = String(req.body.password || "");

    const { rows } = await pool.query("SELECT * FROM admins WHERE email = $1", [email]);
    const admin = rows[0];

    if (!admin || !(await bcrypt.compare(password, admin.passwordhash))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: admin.id, email: admin.email }, process.env.JWT_SECRET || "default_secret_key", { expiresIn: "8h" });
    res.json({ token, email: admin.email });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 1. Full Database JSON Backup Download
app.get("/api/admin/backup", auth, async (_, res) => {
  try {
    const productsRes = await pool.query("SELECT * FROM products ORDER BY id ASC");
    const ordersRes = await pool.query("SELECT * FROM orders ORDER BY id ASC");
    const itemsRes = await pool.query("SELECT * FROM order_items ORDER BY id ASC");

    const backupData = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      products: productsRes.rows,
      orders: ordersRes.rows,
      order_items: itemsRes.rows
    };

    res.setHeader("Content-Disposition", `attachment; filename=sparewallah-backup-${Date.now()}.json`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(backupData, null, 2));
  } catch (e) {
    res.status(500).json({ message: "Backup fetch failed: " + e.message });
  }
});

// 2. Full Database Restore from Uploaded JSON
app.post("/api/admin/restore", auth, async (req, res) => {
  const { products, orders, order_items } = req.body;
  if (!Array.isArray(products) || !Array.isArray(orders)) {
    return res.status(400).json({ message: "Invalid backup file structure." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Purana orders aur products data wipe karein (Admin credentials safe rahenge)
    await client.query("DELETE FROM order_items");
    await client.query("DELETE FROM orders");
    await client.query("DELETE FROM products");

    // Products restore
    for (const p of products) {
      await client.query(
        `INSERT INTO products (id, name, brand, type, category, sku, description, price, mrp, stock, image, active, createdAt) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET 
           name = EXCLUDED.name,
           brand = EXCLUDED.brand,
           type = EXCLUDED.type,
           category = EXCLUDED.category,
           sku = EXCLUDED.sku,
           description = EXCLUDED.description,
           price = EXCLUDED.price,
           mrp = EXCLUDED.mrp,
           stock = EXCLUDED.stock,
           image = EXCLUDED.image,
           active = EXCLUDED.active`,
        [p.id, p.name, p.brand, p.type, p.category || "", p.sku, p.description || "", p.price, p.mrp || 0, p.stock || 0, p.image || "", p.active ?? 1, p.createdat || p.createdAt || new Date()]
      );
    }

    // Orders restore
    for (const o of orders) {
      await client.query(
        `INSERT INTO orders (id, orderId, customer_name, customer_phone, customer_address, customer_city, customer_pincode, subtotal, total, status, source, createdAt) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET 
           orderId = EXCLUDED.orderId,
           customer_name = EXCLUDED.customer_name,
           customer_phone = EXCLUDED.customer_phone,
           customer_address = EXCLUDED.customer_address,
           customer_city = EXCLUDED.customer_city,
           customer_pincode = EXCLUDED.customer_pincode,
           subtotal = EXCLUDED.subtotal,
           total = EXCLUDED.total,
           status = EXCLUDED.status,
           source = EXCLUDED.source`,
        [o.id, o.orderid || o.orderId, o.customer_name, o.customer_phone, o.customer_address, o.customer_city || "", o.customer_pincode || "", o.subtotal, o.total, o.status, o.source, o.createdat || o.createdAt || new Date()]
      );
    }

    // Order items restore
    if (Array.isArray(order_items)) {
      for (const item of order_items) {
        await client.query(
          `INSERT INTO order_items (id, order_id, productId, name, sku, price, quantity, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [item.id, item.order_id, item.productid || item.productId, item.name, item.sku, item.price, item.quantity, item.subtotal]
        );
      }
    }

    // Postgres SERIAL sequences update karein taaki naye orders/products insert hone par ID collision na aaye
    await client.query(`SELECT setval('products_id_seq', COALESCE((SELECT MAX(id) FROM products), 1))`);
    await client.query(`SELECT setval('orders_id_seq', COALESCE((SELECT MAX(id) FROM orders), 1))`);
    await client.query(`SELECT setval('order_items_id_seq', COALESCE((SELECT MAX(id) FROM order_items), 1))`);

    await client.query("COMMIT");
    res.json({ message: "Database restored successfully!" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: "Restore failed: " + err.message });
  } finally {
    client.release();
  }
});

app.get("/api/admin/me", auth, (req, res) => res.json({ email: req.admin.email }));

app.get("/api/admin/products", auth, async (_, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM products ORDER BY id DESC");
    res.json(rows.map(publicProduct));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post("/api/admin/products", auth, upload.single("image"), async (req, res) => {
  try {
    const data = req.body;
    const activeStatus = data.active !== "false" ? 1 : 0;
    
    // Supabase bucket upload
    const imageUrl = req.file ? await uploadToSupabase(req.file) : "";

    const { rows } = await pool.query(
      `INSERT INTO products (name, brand, type, category, sku, description, price, mrp, stock, active, image) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [data.name, data.brand, data.type, data.category || "", data.sku, data.description || "", Number(data.price), Number(data.mrp || 0), Number(data.stock || 0), activeStatus, imageUrl]
    );

    res.status(201).json(publicProduct(rows[0]));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

app.put("/api/admin/products/:id", auth, upload.single("image"), async (req, res) => {
  try {
    const id = req.params.id;
    const check = await pool.query("SELECT * FROM products WHERE id = $1", [id]);
    if (check.rows.length === 0) return res.status(404).json({ message: "Product not found" });

    const updates = [];
    const params = [];
    const fields = ["name", "brand", "type", "category", "sku", "description"];

    fields.forEach(k => {
      if (req.body[k] !== undefined) {
        params.push(req.body[k]);
        updates.push(`${k} = $${params.length}`);
      }
    });

    ["price", "mrp", "stock"].forEach(k => {
      if (req.body[k] !== undefined) {
        params.push(Number(req.body[k]));
        updates.push(`${k} = $${params.length}`);
      }
    });

    if (req.body.active !== undefined) {
      params.push(req.body.active !== "false" ? 1 : 0);
      updates.push(`active = $${params.length}`);
    }

    if (req.file) {
      const newImageUrl = await uploadToSupabase(req.file);
      params.push(newImageUrl);
      updates.push(`image = $${params.length}`);
    }

    if (updates.length > 0) {
      params.push(id);
      const query = `UPDATE products SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`;
      const updated = await pool.query(query, params);
      return res.json(publicProduct(updated.rows[0]));
    }

    res.json(publicProduct(check.rows[0]));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

app.delete("/api/admin/products/:id", auth, async (req, res) => {
  try {
    await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    res.json({ message: "Product deleted" });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

app.get("/api/admin/orders", auth, async (_, res) => {
  try {
    const { rows: orders } = await pool.query("SELECT * FROM orders ORDER BY id DESC LIMIT 500");
    for (let order of orders) {
      order._id = String(order.id);
      order.orderId = order.orderid || order.orderId || `ORD-${String(order.id).padStart(4, "0")}`;

      const itemRes = await pool.query("SELECT * FROM order_items WHERE order_id = $1", [order.id]);
      order.items = itemRes.rows.map(item => ({
        ...item,
        productId: item.productid || item.productId
      }));

      order.customer = {
        name: order.customer_name,
        phone: order.customer_phone,
        address: order.customer_address,
        city: order.customer_city,
        pincode: order.customer_pincode
      };
    }
    res.json(orders);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.patch("/api/admin/orders/:id/status", auth, async (req, res) => {
  const allowed = ["Pending", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled"];
  const newStatus = req.body.status;
  if (!allowed.includes(newStatus)) return res.status(400).json({ message: "Invalid status" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [req.params.id]);
    const order = rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Order not found" });
    }

    const previousStatus = order.status;

    if (newStatus === "Cancelled" && previousStatus !== "Cancelled") {
      const items = await client.query("SELECT * FROM order_items WHERE order_id = $1", [order.id]);
      for (const item of items.rows) {
        if (item.productid) {
          await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [item.quantity, item.productid]);
        }
      }
    }

    if (previousStatus === "Cancelled" && newStatus !== "Cancelled") {
      const items = await client.query("SELECT * FROM order_items WHERE order_id = $1", [order.id]);
      for (const item of items.rows) {
        if (item.productid) {
          await client.query("UPDATE products SET stock = GREATEST(0, stock - $1) WHERE id = $2", [item.quantity, item.productid]);
        }
      }
    }

    const updateRes = await client.query("UPDATE orders SET status = $1 WHERE id = $2 RETURNING *", [newStatus, req.params.id]);
    await client.query("COMMIT");

    res.json(updateRes.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

app.get("/api/admin/stats", auth, async (_, res) => {
  try {
    const p = await pool.query("SELECT COUNT(*) AS count FROM products");
    const o = await pool.query("SELECT COUNT(*) AS count FROM orders");
    const ls = await pool.query("SELECT COUNT(*) AS count FROM products WHERE stock <= 5");
    const rev = await pool.query("SELECT COALESCE(SUM(total), 0) AS sum FROM orders WHERE status != 'Cancelled'");

    res.json({
      products: parseInt(p.rows[0].count, 10),
      orders: parseInt(o.rows[0].count, 10),
      lowStock: parseInt(ls.rows[0].count, 10),
      revenue: parseFloat(rev.rows[0].sum)
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.get("/api/config", (req, res) => res.json({ whatsappNumber: process.env.WHATSAPP_NUMBER || "" }));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ message: "API route not found" });
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

// --- DATABASE INITIALIZATION & BOOTSTRAP ---
async function bootstrap() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      passwordHash TEXT
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT DEFAULT '',
      sku TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      price NUMERIC NOT NULL,
      mrp NUMERIC DEFAULT 0,
      stock INTEGER DEFAULT 0,
      image TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      orderId TEXT UNIQUE,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      customer_city TEXT,
      customer_pincode TEXT,
      subtotal NUMERIC,
      total NUMERIC,
      status TEXT DEFAULT 'Pending',
      source TEXT DEFAULT 'website',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      productId INTEGER,
      name TEXT,
      sku TEXT,
      price NUMERIC,
      quantity INTEGER,
      subtotal NUMERIC
    );
  `);

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (email && password) {
    const hash = await bcrypt.hash(password, 12);
    const existing = await pool.query("SELECT * FROM admins WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length === 0) {
      await pool.query("INSERT INTO admins (email, passwordHash) VALUES ($1, $2)", [email.toLowerCase(), hash]);
      console.log(`Admin created: ${email}`);
    } else {
      await pool.query("UPDATE admins SET passwordHash = $1 WHERE email = $2", [hash, email.toLowerCase()]);
      console.log(`Admin password synced from .env for: ${email}`);
    }
  }

  app.listen(PORT, () => console.log(`Server running with PostgreSQL on http://localhost:${PORT}`));
}

bootstrap().catch(err => {
  console.error("Database connection / Bootstrap error:", err);
  process.exit(1);
});