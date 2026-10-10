require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const app = express();
const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const UPLOADS = path.join(ROOT, "uploads");

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOADS));
app.use(express.static(path.join(ROOT, "public")));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "-");
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/^image\/(jpeg|png|webp|jpg)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG or WEBP images are allowed"));
  }
});

// Database Variable
let db;

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
    brand: p.brand,
    type: p.type,
    category: p.category,
    sku: p.sku,
    description: p.description,
    price: p.price,
    mrp: p.mrp,
    stock: p.stock,
    image: p.image,
    active: p.active === 1
  };
}

// --- API ROUTES ---

app.get("/api/products", async (req, res) => {
  try {
    let query = "SELECT * FROM products WHERE active = 1";
    const params = [];
    
    if (req.query.brand && req.query.brand !== "all") {
      query += " AND brand = ?";
      params.push(req.query.brand);
    }
    if (req.query.type && req.query.type !== "all") {
      query += " AND type = ?";
      params.push(req.query.type);
    }
    if (req.query.q) {
      query += " AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)";
      const search = `%${req.query.q}%`;
      params.push(search, search, search);
    }
    
    query += " ORDER BY id DESC";
    const products = await db.all(query, params);
    res.json(products.map(publicProduct));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const p = await db.get("SELECT * FROM products WHERE id = ?", [req.params.id]);
    if (!p || p.active === 0) return res.status(404).json({ message: "Product not found" });
    res.json(publicProduct(p));
  } catch (e) { res.status(400).json({ message: "Invalid product ID" }); }
});

app.post("/api/orders", async (req, res) => {
  const { customer, items } = req.body;
  if (!customer?.name || !customer?.phone || !customer?.address || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: "Customer details and cart items are required" });
  }
  
  try {
    await db.run("BEGIN TRANSACTION");
    let total = 0;
    const cleanItems = [];

    for (const item of items) {
      const product = await db.get("SELECT * FROM products WHERE id = ? AND active = 1", [item.productId]);
      const qty = Math.max(1, Math.floor(Number(item.quantity)));
      
      if (!product) throw new Error(`Product not found: ${item.productId}`);
      if (product.stock < qty) throw new Error(`${product.name} has only ${product.stock} item(s) in stock`);
      
      const subtotal = product.price * qty;
      cleanItems.push({ productId: product.id, name: product.name, sku: product.sku, price: product.price, quantity: qty, subtotal });
      total += subtotal;
      
      await db.run("UPDATE products SET stock = stock - ? WHERE id = ?", [qty, product.id]);
    }

    // Database se total orders count nikalo
       const countRow = await db.get("SELECT COUNT(*) AS totalOrders FROM orders");
       const nextNum = (countRow?.totalOrders || 0) + 1;
       const orderId = `ORD-${String(nextNum).padStart(4, "0")}`;
       
    const orderResult = await db.run(
      `INSERT INTO orders (orderId, customer_name, customer_phone, customer_address, customer_city, customer_pincode, subtotal, total, status, source) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, customer.name, customer.phone, customer.address, customer.city || "", customer.pincode || "", total, total, "Pending", "website"]
    );

    const internalOrderId = orderResult.lastID;

    for (const item of cleanItems) {
      await db.run(
        `INSERT INTO order_items (order_id, productId, name, sku, price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [internalOrderId, item.productId, item.name, item.sku, item.price, item.quantity, item.subtotal]
      );
    }

    await db.run("COMMIT");
    res.status(201).json({ orderId, total, message: "Order placed successfully" });
  } catch (e) {
    await db.run("ROLLBACK");
    res.status(400).json({ message: e.message });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const password = String(req.body.password || "");
    
    const admin = await db.get("SELECT * FROM admins WHERE email = ?", [email]);
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    
    const token = jwt.sign({ id: admin.id, email: admin.email }, process.env.JWT_SECRET || "default_secret_key", { expiresIn: "8h" });
    res.json({ token, email: admin.email });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/admin/me", auth, (req, res) => res.json({ email: req.admin.email }));

app.get("/api/admin/products", auth, async (_, res) => {
  const products = await db.all("SELECT * FROM products ORDER BY id DESC");
  res.json(products.map(publicProduct));
});

app.post("/api/admin/products", auth, upload.single("image"), async (req, res) => {
  try {
    const data = req.body;
    const activeStatus = data.active !== "false" ? 1 : 0;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : "";
    
    const result = await db.run(
      `INSERT INTO products (name, brand, type, category, sku, description, price, mrp, stock, active, image) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.name, data.brand, data.type, data.category || "", data.sku, data.description || "", Number(data.price), Number(data.mrp || 0), Number(data.stock || 0), activeStatus, imagePath]
    );
    
    const p = await db.get("SELECT * FROM products WHERE id = ?", [result.lastID]);
    res.status(201).json(publicProduct(p));
  } catch (e) { res.status(400).json({ message: e.message }); }
});

app.put("/api/admin/products/:id", auth, upload.single("image"), async (req, res) => {
  try {
    const id = req.params.id;
    const p = await db.get("SELECT * FROM products WHERE id = ?", [id]);
    if (!p) return res.status(404).json({ message: "Product not found" });

    const updates = [];
    const params = [];
    const fields = ["name", "brand", "type", "category", "sku", "description"];
    
    fields.forEach(k => { 
      if (req.body[k] !== undefined) { updates.push(`${k} = ?`); params.push(req.body[k]); } 
    });
    
    ["price", "mrp", "stock"].forEach(k => { 
      if (req.body[k] !== undefined) { updates.push(`${k} = ?`); params.push(Number(req.body[k])); } 
    });
    
    if (req.body.active !== undefined) { updates.push(`active = ?`); params.push(req.body.active !== "false" ? 1 : 0); }
    if (req.file) { updates.push(`image = ?`); params.push(`/uploads/${req.file.filename}`); }
    
    if (updates.length > 0) {
      params.push(id);
      await db.run(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`, params);
    }
    
    const updated = await db.get("SELECT * FROM products WHERE id = ?", [id]);
    res.json(publicProduct(updated));
  } catch (e) { res.status(400).json({ message: e.message }); }
});

app.delete("/api/admin/products/:id", auth, async (req, res) => {
  try {
    await db.run("DELETE FROM products WHERE id = ?", [req.params.id]);
    res.json({ message: "Product deleted" });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

app.get("/api/admin/orders", auth, async (_, res) => {
  const orders = await db.all("SELECT * FROM orders ORDER BY id DESC LIMIT 500");
  for (let order of orders) {
    order._id = String(order.id); // <-- MongoDB compatibility ke liye _id aur String add kiya
    order.items = await db.all("SELECT * FROM order_items WHERE order_id = ?", [order.id]);
    
    // Format customer object for frontend
    order.customer = {
      name: order.customer_name,
      phone: order.customer_phone,
      address: order.customer_address,
      city: order.customer_city,
      pincode: order.customer_pincode
    };
  }
  res.json(orders);
});

app.patch("/api/admin/orders/:id/status", auth, async (req, res) => {
  const allowed = ["Pending", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled"];
  const newStatus = req.body.status;
  if (!allowed.includes(newStatus)) return res.status(400).json({ message: "Invalid status" });
  
  try {
    await db.run("BEGIN TRANSACTION");

    const order = await db.get("SELECT * FROM orders WHERE id = ?", [req.params.id]);
    if (!order) {
      await db.run("ROLLBACK");
      return res.status(404).json({ message: "Order not found" });
    }

    const previousStatus = order.status;

    // 1. Agar order abhi 'Cancelled' ho raha hai (pehle cancelled nahi tha) -> Stock wapas add karein
    if (newStatus === "Cancelled" && previousStatus !== "Cancelled") {
      const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", [order.id]);
      for (const item of items) {
        if (item.productId) {
          await db.run("UPDATE products SET stock = stock + ? WHERE id = ?", [item.quantity, item.productId]);
        }
      }
    }

    // 2. Agar pehle se 'Cancelled' tha aur ab dobara active kiya ja raha hai -> Stock deduct karein
    if (previousStatus === "Cancelled" && newStatus !== "Cancelled") {
      const items = await db.all("SELECT * FROM order_items WHERE order_id = ?", [order.id]);
      for (const item of items) {
        if (item.productId) {
          await db.run("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?", [item.quantity, item.productId]);
        }
      }
    }

    // Order status update karein
    await db.run("UPDATE orders SET status = ? WHERE id = ?", [newStatus, req.params.id]);
    await db.run("COMMIT");

    const updated = await db.get("SELECT * FROM orders WHERE id = ?", [req.params.id]);
    res.json(updated);
  } catch (err) {
    await db.run("ROLLBACK");
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/stats", auth, async (_, res) => {
  const products = await db.get("SELECT COUNT(*) as count FROM products");
  const orders = await db.get("SELECT COUNT(*) as count FROM orders");
  const lowStock = await db.get("SELECT COUNT(*) as count FROM products WHERE stock <= 5");
  const revenue = await db.get("SELECT SUM(total) as sum FROM orders WHERE status != 'Cancelled'");
  
  res.json({ 
    products: products.count, 
    orders: orders.count, 
    lowStock: lowStock.count, 
    revenue: revenue.sum || 0 
  });
});

app.get("/api/config", (req,res) => res.json({ whatsappNumber: process.env.WHATSAPP_NUMBER || "" }));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ message: "API route not found" });
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

// --- DATABASE INITIALIZATION & BOOTSTRAP ---
async function bootstrap() {
  db = await open({
    filename: path.join(ROOT, "database.sqlite"),
    driver: sqlite3.Database
  });

  // Create Tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      passwordHash TEXT
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT DEFAULT '',
      sku TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      price REAL NOT NULL,
      mrp REAL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      image TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId TEXT UNIQUE,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      customer_city TEXT,
      customer_pincode TEXT,
      subtotal REAL,
      total REAL,
      status TEXT DEFAULT 'Pending',
      source TEXT DEFAULT 'website',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      productId INTEGER,
      name TEXT,
      sku TEXT,
      price REAL,
      quantity INTEGER,
      subtotal REAL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );
  `);

 const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  
  if (email && password) {
    const hash = await bcrypt.hash(password, 12);
    const existing = await db.get("SELECT * FROM admins WHERE email = ?", [email.toLowerCase()]);
    if (!existing) {
      await db.run("INSERT INTO admins (email, passwordHash) VALUES (?, ?)", [email.toLowerCase(), hash]);
      console.log(`Admin created: ${email}`);
    } else {
      await db.run("UPDATE admins SET passwordHash = ? WHERE email = ?", [hash, email.toLowerCase()]);
      console.log(`Admin password synced from .env for: ${email}`);
    }
  }

  app.listen(PORT, () => console.log(`Store running offline with SQLite on http://localhost:${PORT}`));
}

bootstrap().catch(err => { console.error(err); process.exit(1); });