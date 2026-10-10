let token = localStorage.getItem("evhub_admin_token") || "";
let editingId = null;
let existingCategories = ["Motor & Axle", "Controller & Wiring", "Brakes & Suspension", "Body & Lighting"];
let cachedProducts = [];
let cachedOrders = [];

const $ = s => document.querySelector(s);
const money = n => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

async function api(url, opt = {}) {
  opt.headers = { ...(opt.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(url, opt);
  if (r.status === 401) { logout(); throw Error("Session expired"); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.message || "Request failed");
  return d;
}

function toast(m) {
  const e = $("#adminToast");
  if (!e) return;
  e.textContent = m;
  e.style.display = "block";
  setTimeout(() => e.style.display = "none", 2200);
}

function showApp() {
  const loginView = document.getElementById("loginView");
  const appView = document.getElementById("appView");
  if (loginView) loginView.classList.add("hidden");
  if (appView) appView.classList.remove("hidden");
  
  api("/api/admin/me").then(x => {
    const adminEmail = document.getElementById("adminEmail");
    if (adminEmail) adminEmail.textContent = x.email;
  }).catch(() => {});
  
  showPage("dashboard");
}

function logout() {
  token = "";
  localStorage.removeItem("evhub_admin_token");
  const appView = document.getElementById("appView");
  const loginView = document.getElementById("loginView");
  if (appView) appView.classList.add("hidden");
  if (loginView) loginView.classList.remove("hidden");
}

window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm");
  const logoutBtn = document.getElementById("logout");

  if (logoutBtn) logoutBtn.onclick = logout;

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const msgEl = document.getElementById("loginMsg");
      
      try {
        const data = await (await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        })).json();

        if (data.token) {
          token = data.token;
          localStorage.setItem("evhub_admin_token", token);
          showApp();
        } else {
          throw new Error(data.message || "Login failed");
        }
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message;
      }
    });
  }

  document.querySelectorAll(".side").forEach(b => {
    b.onclick = () => showPage(b.dataset.page);
  });

  if (token) showApp();
});

function showPage(page) {
  document.querySelectorAll(".side").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  document.querySelectorAll(".page").forEach(x => x.classList.add("hidden"));
  const el = $("#" + page + "Page");
  if (el) el.classList.remove("hidden");
  const pageTitle = $("#pageTitle");
  if (pageTitle) {
    pageTitle.textContent = page === "add" ? "Add / Edit Spare Part" : page === "products" ? "Spare Parts Inventory" : page[0].toUpperCase() + page.slice(1);
  }
  if (page === "dashboard") dashboard();
  if (page === "products") products();
  if (page === "orders") orders();
  if (page === "add") addForm();
}

// -----------------------------------------------------------
// DASHBOARD WITH CLICKABLE CARDS & DETAILED REPORT POPUP
// -----------------------------------------------------------
async function dashboard() {
  try {
    const s = await api("/api/admin/stats");

    $("#dashboardPage").innerHTML = `
      <div class="cards">
        <div class="stat clickable-card" onclick="openReportModal('products')" title="Click for Parts Report">
          <small>Total Spare Parts</small>
          <strong>${s.products}</strong>
          <span class="card-hint">View Parts Report ↗</span>
        </div>
        <div class="stat clickable-card" onclick="openReportModal('orders')" title="Click for Orders Report">
          <small>Received Orders</small>
          <strong>${s.orders}</strong>
          <span class="card-hint">View Orders Report ↗</span>
        </div>
        <div class="stat clickable-card alert-card" onclick="openReportModal('lowstock')" title="Click to view Low Stock items">
          <small>Low Stock (≤ 5)</small>
          <strong style="color:var(--red)">${s.lowStock}</strong>
          <span class="card-hint" style="color:var(--red)">🚨 View Alert Items ↗</span>
        </div>
        <div class="stat clickable-card" onclick="openReportModal('revenue')" title="Click for Revenue Breakdown">
          <small>Orders Value</small>
          <strong>${money(s.revenue)}</strong>
          <span class="card-hint">View Sales Report ↗</span>
        </div>
      </div>

      <!-- Workshop Stock Alerts Banner -->
      <div class="panel clickable-panel" onclick="openReportModal('lowstock')" style="cursor:pointer;" title="Click to see refilling list">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <h3 style="margin:0 0 4px;color:var(--accent);">⚙ Workshop Stock Alerts (${s.lowStock} Items Needing Refill)</h3>
            <p style="color:var(--muted);margin:0;font-size:13px;">Parts below 5 units stock must be refilled to prevent delayed shipments. Click here to view alert list.</p>
          </div>
          <button class="btn" style="background:#222c3d;color:var(--accent);font-weight:700;">View Low Stock Products ➔</button>
        </div>
      </div>
    `;
  } catch (e) {
    console.error(e);
  }
}

// -----------------------------------------------------------
// REPORT MODAL LOGIC (OPEN REPORTS & LOW STOCK ALERTS)
// -----------------------------------------------------------
async function openReportModal(type) {
  try {
    cachedProducts = await api("/api/admin/products");
    cachedOrders = await api("/api/admin/orders");

    const modal = $("#reportModal");
    const titleEl = $("#reportModalTitle");
    const subtitleEl = $("#reportModalSubtitle");
    const theadEl = $("#reportModalThead");
    const tbodyEl = $("#reportModalTbody");

    if (!modal || !titleEl || !theadEl || !tbodyEl) return;

    if (type === "lowstock") {
      const lowItems = cachedProducts.filter(p => Number(p.stock) <= 5);
      titleEl.textContent = `🚨 Low Stock Alert Report (${lowItems.length} Items)`;
      subtitleEl.textContent = "Yeh spare parts 5 units se kam bache hain, inka stock refill karein:";

      theadEl.innerHTML = `
        <tr>
          <th>Part Image</th>
          <th>Part Name</th>
          <th>SKU Code</th>
          <th>Category</th>
          <th>Price</th>
          <th>Available Stock</th>
          <th>Action</th>
        </tr>
      `;

      if (!lowItems.length) {
        tbodyEl.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--green)">✅ Sabhi parts ka stock adequate hai (Stock > 5).</td></tr>`;
      } else {
        tbodyEl.innerHTML = lowItems.map(p => `
          <tr>
            <td>${p.image ? `<img class="thumb" src="${p.image}">` : "⚙"}</td>
            <td><b>${esc(p.name)}</b></td>
            <td><code>${esc(p.sku)}</code></td>
            <td><span class="badge">${esc(p.category || p.type)}</span></td>
            <td>${money(p.price)}</td>
            <td><b style="color:var(--red);font-size:15px;">${p.stock} units</b></td>
            <td>
              <button class="btn green" style="padding:6px 12px;font-size:12px;" onclick='closeReportModal(); editProduct(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
                Refill Stock ➕
              </button>
            </td>
          </tr>
        `).join("");
      }
    } else if (type === "products") {
      titleEl.textContent = `📦 Spare Parts Inventory Report (${cachedProducts.length} Items)`;
      subtitleEl.textContent = "Sabhi registered spare parts ki complete list:";

      theadEl.innerHTML = `
        <tr>
          <th>Part Name</th>
          <th>Category</th>
          <th>SKU Code</th>
          <th>Price</th>
          <th>Current Stock</th>
        </tr>
      `;

      tbodyEl.innerHTML = cachedProducts.map(p => `
        <tr>
          <td><b>${esc(p.name)}</b></td>
          <td>${esc(p.category || p.type)}</td>
          <td><code>${esc(p.sku)}</code></td>
          <td>${money(p.price)}</td>
          <td><b style="color:${p.stock <= 5 ? 'var(--red)' : 'var(--green)'}">${p.stock}</b></td>
        </tr>
      `).join("");
    } else if (type === "orders") {
      titleEl.textContent = `📋 Received Orders Report (${cachedOrders.length} Orders)`;
      subtitleEl.textContent = "Workshop ke sabhi received orders ki summary:";

      theadEl.innerHTML = `
        <tr>
          <th>Order No</th>
          <th>Customer Name</th>
          <th>Phone</th>
          <th>Total Amount</th>
          <th>Status</th>
          <th>Date</th>
        </tr>
      `;

      tbodyEl.innerHTML = cachedOrders.map(o => `
        <tr>
          <td><b style="color:var(--accent)">${esc(o.orderId)}</b></td>
          <td>${esc(o.customer?.name || "Customer")}</td>
          <td>${esc(o.customer?.phone || "")}</td>
          <td><b>${money(o.total)}</b></td>
          <td><span class="badge">${esc(o.status)}</span></td>
          <td>${new Date(o.createdAt).toLocaleDateString()}</td>
        </tr>
      `).join("");
    } else if (type === "revenue") {
      const activeOrders = cachedOrders.filter(o => o.status !== "Cancelled");
      const cancelledOrders = cachedOrders.filter(o => o.status === "Cancelled");
      const totalRev = activeOrders.reduce((acc, curr) => acc + Number(curr.total || 0), 0);

      titleEl.textContent = `💰 Orders Revenue Report`;
      subtitleEl.textContent = `Confirmed Sales: ${money(totalRev)} | Cancelled Orders: ${cancelledOrders.length}`;

      theadEl.innerHTML = `
        <tr>
          <th>Order No</th>
          <th>Customer</th>
          <th>Items Ordered</th>
          <th>Amount</th>
          <th>Status</th>
        </tr>
      `;

      tbodyEl.innerHTML = activeOrders.map(o => `
        <tr>
          <td><b style="color:var(--accent)">${esc(o.orderId)}</b></td>
          <td>${esc(o.customer?.name || "")}</td>
          <td>${(o.items || []).map(i => `${esc(i.name)} (×${i.quantity})`).join(", ")}</td>
          <td><b style="color:var(--green)">${money(o.total)}</b></td>
          <td><span class="badge">${esc(o.status)}</span></td>
        </tr>
      `).join("");
    }

    modal.classList.remove("hidden");
  } catch (err) {
    toast("Error loading report: " + err.message);
  }
}

function closeReportModal() {
  const m = $("#reportModal");
  if (m) m.classList.add("hidden");
}

// -----------------------------------------------------------
// 1. PRODUCTS PAGE (WITH EDIT, DELETE & HISTORY BUTTON)
// -----------------------------------------------------------
async function products() {
  try {
    const ps = await api("/api/admin/products");
    cachedProducts = ps;

    const cats = new Set(existingCategories);
    ps.forEach(p => { if (p.category) cats.add(p.category); if (p.type) cats.add(p.type); });
    existingCategories = Array.from(cats);

    $("#productsPage").innerHTML = `
      <div class="panel">
        <div class="actions" style="justify-content:space-between">
          <h3>Parts Inventory (${ps.length})</h3>
          <button class="btn green" onclick="showPage('add')">+ Add Spare Part</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Image</th>
                <th>Part Name</th>
                <th>Category</th>
                <th>SKU Code</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${ps.map(p => `
                <tr>
                  <td>${p.image ? `<img class="thumb" src="${p.image}">` : "⚙"}</td>
                  <td><b>${esc(p.name)}</b></td>
                  <td><span class="badge">${esc(p.category || p.type)}</span></td>
                  <td><code>${esc(p.sku)}</code></td>
                  <td>${money(p.price)}</td>
                  <td><b style="color:${p.stock <= 5 ? 'var(--red)' : 'var(--green)'}">${p.stock}</b></td>
                  <td>
                    <div class="actions">
                      <button class="btn" style="background:#222c3d" onclick='editProduct(${JSON.stringify(p).replace(/'/g, "&#39;")})'>Edit</button>
                      <button class="btn danger" onclick="deleteProduct('${p.id}')">Delete</button>
                      <button class="btn btn-history" onclick="viewProductHistory('${p.id}')">📜 History</button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch(e) {
    console.error(e);
  }
}

// -----------------------------------------------------------
// 2. PRODUCT HISTORY MODAL LOGIC
// -----------------------------------------------------------
async function viewProductHistory(productId) {
  const product = cachedProducts.find(p => String(p.id) === String(productId));
  if (!product) return;

  try {
    cachedOrders = await api("/api/admin/orders");

    const relevantOrders = [];
    let totalSoldUnits = 0;
    let totalRevenue = 0;

    cachedOrders.forEach(o => {
      (o.items || []).forEach(item => {
        if (String(item.productId) === String(productId) || (item.sku && item.sku === product.sku) || item.name === product.name) {
          relevantOrders.push({
            orderId: o.orderId,
            customerName: o.customer?.name || "Customer",
            phone: o.customer?.phone || "",
            quantity: item.quantity,
            subtotal: item.subtotal,
            status: o.status,
            createdAt: o.createdAt
          });
          if (o.status !== "Cancelled") {
            totalSoldUnits += Number(item.quantity || 0);
            totalRevenue += Number(item.subtotal || 0);
          }
        }
      });
    });

    $("#historyPartName").textContent = product.name;
    $("#historyPartSku").textContent = `SKU: ${product.sku} | Current Stock: ${product.stock} units`;
    $("#historyTotalSold").textContent = `${totalSoldUnits} Units`;
    $("#historyTotalRevenue").textContent = money(totalRevenue);

    const historyTableBody = $("#historyOrdersTbody");
    if (!relevantOrders.length) {
      historyTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px;">No sales history found for this part yet.</td></tr>`;
    } else {
      historyTableBody.innerHTML = relevantOrders.map(o => `
        <tr>
          <td><b style="color:var(--accent)">${esc(o.orderId)}</b></td>
          <td>${esc(o.customerName)}<br><small style="color:var(--muted)">${esc(o.phone)}</small></td>
          <td><b>${o.quantity}</b></td>
          <td>${money(o.subtotal)}</td>
          <td><span class="badge">${esc(o.status)}</span></td>
          <td><small style="color:var(--muted)">${new Date(o.createdAt).toLocaleDateString()}</small></td>
        </tr>
      `).join("");
    }

    $("#historyModal").classList.remove("hidden");
  } catch (err) {
    toast("Could not load history: " + err.message);
  }
}

function closeHistoryModal() {
  const m = $("#historyModal");
  if (m) m.classList.add("hidden");
}

// -----------------------------------------------------------
// 3. ORDERS PAGE (SINGLE LINE TABLE: ORDER NO, NAME, NO., ITEM, QTY, AMOUNT)
// -----------------------------------------------------------
async function orders() {
  try {
    const os = await api("/api/admin/orders");
    cachedOrders = os;

    $("#ordersPage").innerHTML = `
      <div class="panel">
        <div class="actions" style="justify-content:space-between;margin-bottom:12px;">
          <h3>Orders List (${os.length})</h3>
        </div>
        <div class="table-wrap">
          <table class="orders-table">
            <thead>
              <tr>
                <th>Order No</th>
                <th>Name</th>
                <th>No. (Phone)</th>
                <th>Item (Spare Parts)</th>
                <th>Quantity</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${os.map(o => {
                const itemsList = (o.items || []).map(i => esc(i.name)).join(", ") || "General Spare";
                const totalQty = (o.items || []).reduce((acc, curr) => acc + Number(curr.quantity || 0), 0);
                
                return `
                <tr class="order-single-row">
                  <td><b style="color:var(--accent);font-family:monospace;font-size:14px;">${esc(o.orderId)}</b></td>
                  <td><b>${esc(o.customer?.name || "N/A")}</b></td>
                  <td><code>${esc(o.customer?.phone || "N/A")}</code></td>
                  <td class="items-cell" title="${itemsList}">${itemsList}</td>
                  <td><b class="qty-pill">${totalQty}</b></td>
                  <td><b style="color:var(--ink);font-size:14px;">${money(o.total)}</b></td>
                  <td>
                    <select class="status-select-sm" onchange="changeStatus('${o._id}', this.value)">
                      ${["Pending", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled"].map(s => `<option ${o.status === s ? "selected" : ""}>${s}</option>`).join("")}
                    </select>
                  </td>
                </tr>`;
              }).join("") || `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">No orders received yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch(e) {
    console.error(e);
  }
}

// -----------------------------------------------------------
// ORDER STATUS CHANGE WITH AUTO RE-SYNC & STOCK RESTOCK
// -----------------------------------------------------------
async function changeStatus(id, status) {
  try {
    await api(`/api/admin/orders/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    
    cachedProducts = [];
    cachedOrders = [];
    toast(status === "Cancelled" ? "Order Cancelled & Stock Restocked!" : "Order status updated");
  } catch (e) {
    toast(e.message);
  }
}

// -----------------------------------------------------------
// 4. ADD / EDIT SPARE PART FORM
// -----------------------------------------------------------
function addForm(p = {}) {
  editingId = p.id || null;
  
  let desc = p.description || "";
  let features = "";
  let compatibility = "";
  let specs = "";
  let warranty = "";

  if (desc.startsWith("{") && desc.endsWith("}")) {
    try {
      const obj = JSON.parse(desc);
      desc = obj.description || "";
      features = (obj.features || []).join("\n");
      compatibility = obj.compatibility || "";
      specs = obj.specs || "";
      warranty = obj.warranty || "";
    } catch (_) {}
  }

  const currentCat = p.category || p.type || existingCategories[0];

  $("#addPage").innerHTML = `
    <div class="panel">
      <form id="productForm" class="form-grid" enctype="multipart/form-data">
        <div class="wide"><h3>${editingId ? "Edit" : "Add"} Spare Part</h3></div>
        
        <div>
          <label>Part Name *</label>
          <input name="name" placeholder="e.g. 48V 1000W BLDC Motor" value="${esc(p.name)}" required>
        </div>

        <div>
          <label>Vehicle / Brand Type *</label>
          <select name="brand" required>
            <option value="E-Scooty" ${p.brand === "E-Scooty" ? "selected" : ""}>E-Scooty Spare</option>
            <option value="E-Rickshaw" ${p.brand === "E-Rickshaw" ? "selected" : ""}>E-Rickshaw Spare</option>
            <option value="Universal" ${p.brand === "Universal" ? "selected" : ""}>Universal / All Models</option>
          </select>
        </div>

        <div class="wide" style="background:#18202e;padding:16px;border-radius:10px;border:1px solid var(--line);">
          <label><b>Category Selection</b></label>
          <div style="display:flex;gap:12px;margin-top:8px;">
            <select id="categorySelector" name="type" style="flex:1" onchange="toggleCustomCategory(this.value)">
              ${existingCategories.map(c => `<option value="${esc(c)}" ${c === currentCat ? "selected" : ""}>${esc(c)}</option>`).join("")}
              <option value="__NEW__">➕ Create New Custom Category</option>
            </select>
            <input id="newCatInput" placeholder="Enter New Category Name" style="display:none;flex:1;">
          </div>
        </div>

        <div>
          <label>Part SKU / Serial Code *</label>
          <input name="sku" placeholder="e.g. MTR-48V-1000" value="${esc(p.sku)}" required>
        </div>

        <div>
          <label>Selling Price (₹) *</label>
          <input name="price" type="number" min="0" placeholder="Selling Price" value="${p.price ?? ""}" required>
        </div>

        <div>
          <label>MRP (₹) - For Discount Badge</label>
          <input name="mrp" type="number" min="0" placeholder="MRP" value="${p.mrp ?? ""}">
        </div>

        <div>
          <label>Available Stock Units *</label>
          <input name="stock" type="number" min="0" placeholder="Available Quantity" value="${p.stock ?? 10}" required>
        </div>

        <div class="wide">
          <label>Upload Part Image</label>
          <input name="image" type="file" accept="image/png,image/jpeg,image/webp">
        </div>

        <div class="wide">
          <label>Description (General Details)</label>
          <textarea id="f_desc" placeholder="Write comprehensive product description...">${esc(desc)}</textarea>
        </div>

        <div class="wide">
          <label>Key Features & Specifications (Enter one feature per line)</label>
          <textarea id="f_features" placeholder="100% Pure Copper Winding&#10;Waterproof IP67 Rating&#10;Direct Plug & Play Fitting">${esc(features)}</textarea>
        </div>

        <div>
          <label>Vehicle Fitment & Compatibility</label>
          <input id="f_compat" placeholder="e.g. Compatible with Hero Electric, Okinawa, Yakuza" value="${esc(compatibility)}">
        </div>

        <div>
          <label>Warranty & Return Details</label>
          <input id="f_warranty" placeholder="e.g. 6 Months Warranty, 7-day replacement" value="${esc(warranty)}">
        </div>

        <div class="wide">
          <label>Technical Specifications (Voltage, RPM, Dimensions)</label>
          <textarea id="f_specs" style="min-height:70px" placeholder="Voltage: 48V | Current: 30A | Speed: 450 RPM">${esc(specs)}</textarea>
        </div>

        <label class="wide"><input name="active" type="checkbox" ${p.active !== false ? "checked" : ""}> Visible in Catalog</label>

        <div class="wide actions">
          <button class="btn green" type="submit">${editingId ? "Update" : "Save"} Part</button>
          <button type="button" class="btn" style="background:#222c3d" onclick="showPage('products')">Cancel</button>
        </div>
      </form>
    </div>`;

  $("#productForm").onsubmit = submitProduct;
}

function toggleCustomCategory(val) {
  const customInput = $("#newCatInput");
  if (val === "__NEW__") {
    customInput.style.display = "block";
    customInput.focus();
  } else {
    customInput.style.display = "none";
  }
}

async function submitProduct(e) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    let catVal = $("#categorySelector").value;
    if (catVal === "__NEW__") {
      catVal = $("#newCatInput").value.trim();
      if (!catVal) throw new Error("Please enter a category name");
      if (!existingCategories.includes(catVal)) existingCategories.push(catVal);
    }

    fd.set("type", catVal);
    fd.set("category", catVal);

    const detailedDescObj = {
      description: $("#f_desc").value.trim(),
      features: $("#f_features").value.split("\n").map(x => x.trim()).filter(Boolean),
      compatibility: $("#f_compat").value.trim(),
      specs: $("#f_specs").value.trim(),
      warranty: $("#f_warranty").value.trim()
    };

    fd.set("description", JSON.stringify(detailedDescObj));

    await api(editingId ? `/api/admin/products/${editingId}` : "/api/admin/products", {
      method: editingId ? "PUT" : "POST",
      body: fd
    });

    toast(editingId ? "Spare part updated successfully" : "Spare part added successfully");
    showPage("products");
  } catch (err) {
    toast(err.message);
  }
}

function editProduct(p) {
  showPage("add");
  addForm(p);
}

async function deleteProduct(id) {
  if (!confirm("Delete this spare part permanently?")) return;
  try {
    await api(`/api/admin/products/${id}`, { method: "DELETE" });
    toast("Part deleted");
    products();
  } catch (e) {
    toast(e.message);
  }
}