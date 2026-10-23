// Global State
const state = {
  cart: JSON.parse(localStorage.getItem("evhub_cart") || "[]"),
  allProducts: [],
  categories: [],
  currentCategory: null,
  currentProduct: null,
  currentVehicleFilter: "all",
  currentSortOption: "default",
  detailQty: 1
};

const $ = s => document.querySelector(s);
const money = n => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

function toast(msg) {
  const e = $("#toast");
  if (!e) return;
  e.textContent = msg;
  e.style.display = "block";
  setTimeout(() => e.style.display = "none", 2200);
}

// Category Icons Mapping
const defaultCategoryIcons = {
  "Lithium Battery Chargers": "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=160&auto=format&fit=crop&q=60",
  "Lead Acid EV Chargers": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=160&auto=format&fit=crop&q=60",
  "EV Iron Parts & Guards": "https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=160&auto=format&fit=crop&q=60",
  "EV Motors & Motor Kits": "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=160&auto=format&fit=crop&q=60",
  "EV Controllers": "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=160&auto=format&fit=crop&q=60"
};

async function initStore() {
  updateCartCounters();
  try {
    const res = await fetch("https://sparewallah.onrender.com/api/products");
    state.allProducts = await res.json();
    buildCategoryStructure();
    renderTopSlider();
    renderVerticalSidebar();
    renderAllCategoriesAndProducts();
  } catch (err) {
    console.error("Store init error:", err);
  }
}

function buildCategoryStructure() {
  const catMap = {};
  state.allProducts.forEach(p => {
    const cat = p.category || p.type || "General Spares";
    if (!catMap[cat]) {
      catMap[cat] = {
        name: cat,
        image: p.image || defaultCategoryIcons[cat] || "https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=160&auto=format&fit=crop&q=60",
        count: 0
      };
    }
    catMap[cat].count++;
  });
  state.categories = Object.values(catMap);
}

// 1. TOP SLIDER (PLAIN RECTANGLE)
function renderTopSlider() {
  const slider = $("#categorySlider");
  if (!slider) return;

  slider.innerHTML = state.categories.map(c => `
    <div class="slide-cat-item" onclick="scrollToCategorySection('${esc(c.name)}')">
      <div class="slide-cat-img-box">
        <img src="${c.image}" alt="${esc(c.name)}" onerror="this.src='https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=160&auto=format&fit=crop&q=60'">
      </div>
      <span class="slide-cat-title">${esc(c.name)}</span>
    </div>
  `).join("");
}

function scrollSlider(amt) {
  const s = $("#categorySlider");
  if (s) s.scrollBy({ left: amt, behavior: "smooth" });
}

// 2. VERTICAL SIDEBAR
function renderVerticalSidebar() {
  const list = $("#verticalCategoryList");
  if (!list) return;

  list.innerHTML = state.categories.map(c => `
    <li onclick="scrollToCategorySection('${esc(c.name)}')">
      ${esc(c.name)}
    </li>
  `).join("");
}

// SMOOTH SCROLL DIRECTLY TO THAT CATEGORY
function scrollToCategorySection(catName) {
  showStoreView();
  const targetId = "cat-sec-" + catName.replace(/[^a-zA-Z0-9]/g, "-");
  const el = document.getElementById(targetId);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Highlight selected in sidebar
  document.querySelectorAll("#verticalCategoryList li").forEach(li => {
    li.classList.toggle("active", li.textContent.trim() === catName);
  });
}

// 3. RENDER ALL CATEGORIES & THEIR PRODUCTS ONE AFTER ANOTHER
function renderAllCategoriesAndProducts() {
  const container = $("#allCategoriesSectionsContainer");
  if (!container) return;

  if (!state.categories.length) {
    container.innerHTML = '<p style="color:var(--muted);padding:20px;">No products in store.</p>';
    return;
  }

  container.innerHTML = state.categories.map(cat => {
    let prods = state.allProducts.filter(p => (p.category || p.type) === cat.name);

    // Apply Filter
    if (state.currentVehicleFilter !== "all") {
      prods = prods.filter(p => p.brand === state.currentVehicleFilter);
    }

    // Apply Sort
    if (state.currentSortOption === "low-to-high") {
      prods.sort((a, b) => Number(a.price) - Number(b.price));
    } else if (state.currentSortOption === "high-to-low") {
      prods.sort((a, b) => Number(b.price) - Number(a.price));
    } else if (state.currentSortOption === "discount") {
      prods.sort((a, b) => {
        const discA = a.mrp && Number(a.mrp) > Number(a.price) ? ((Number(a.mrp) - Number(a.price)) / Number(a.mrp)) : 0;
        const discB = b.mrp && Number(b.mrp) > Number(b.price) ? ((Number(b.mrp) - Number(b.price)) / Number(b.mrp)) : 0;
        return discB - discA;
      });
    }

    if (!prods.length && state.currentVehicleFilter !== "all") {
      return "";
    }

    const secId = "cat-sec-" + cat.name.replace(/[^a-zA-Z0-9]/g, "-");

    return `
      <section class="category-block-section" id="${secId}">
        <div class="category-block-header">
          <h3 class="category-block-title">${esc(cat.name)}</h3>
          <span class="category-count-badge">${prods.length} Items</span>
        </div>
        <div class="products-row-container">
          ${prods.map(p => {
            const hasDiscount = p.mrp && Number(p.mrp) > Number(p.price);
            const discountPercent = hasDiscount ? Math.round(((Number(p.mrp) - Number(p.price)) / Number(p.mrp)) * 100) : 0;

            return `
            <article class="product-row-card">
              <div class="product-row-img" onclick="openProductDetail('${p.id}')">
                ${p.image ? `<img src="${p.image}" alt="${esc(p.name)}">` : `<span style="font-size:24px">⚙</span>`}
              </div>
              <div class="product-row-info">
                <h4 class="product-row-title" onclick="openProductDetail('${p.id}')">${esc(p.name)}</h4>
                <div class="product-row-price-wrap">
                  <span class="product-row-price">${money(p.price)} <small>/ PCS</small></span>${hasDiscount ? `<span class="product-row-mrp">${money(p.mrp)}</span><span class="badge-row-discount">${discountPercent}% OFF</span>` : ""}
                </div>
              </div>
              <button class="btn-add-quote" onclick="addToCart('${p.id}')">
                Add to Cart +
              </button>
            </article>`;
          }).join("")}
        </div>
      </section>
    `;
  }).join("");
}

// FILTERS & SORTS
function filterByVehicle(val) {
  state.currentVehicleFilter = val;
  renderAllCategoriesAndProducts();
}

function sortByOption(val) {
  state.currentSortOption = val;
  renderAllCategoriesAndProducts();
}

// 4. VIEW SWITCHING & NO JUMP IN PRODUCT VIEW
function showStoreView() {
  $("#storeLayoutView").classList.remove("hidden");
  $("#productDetailView").classList.add("hidden");
}

function openProductDetail(productId) {
  const p = state.allProducts.find(x => x.id === productId);
  if (!p) return;

  state.currentProduct = p;
  state.detailQty = 1;
  $("#detailQtyValue").textContent = "1";

  // Hide list and show product detail
  $("#storeLayoutView").classList.add("hidden");
  $("#productDetailView").classList.remove("hidden");

  // Breadcrumbs
  const cat = p.category || p.type || "Category";
  $("#crumbCategory").textContent = cat;
  $("#crumbProductName").textContent = p.name;

  // Data
  $("#detailMainImg").src = p.image || "";
  $("#detailTitle").textContent = p.name;
  $("#detailPrice").textContent = money(p.price);

  const discBadge = $("#detailDiscountBadge");
  if (p.mrp && Number(p.mrp) > Number(p.price)) {
    $("#detailMrp").textContent = money(p.mrp);
    $("#detailMrp").style.display = "inline";
    const discount = Math.round(((Number(p.mrp) - Number(p.price)) / Number(p.mrp)) * 100);
    discBadge.textContent = `${discount}% OFF`;
    discBadge.style.display = "inline-block";
  } else {
    $("#detailMrp").style.display = "none";
    discBadge.style.display = "none";
  }

  // Parse structured details
  let desc = p.description || "";
  let features = [];
  let compat = `#Compatible with ${p.brand || "Electric Vehicles"}.`;
  let specs = `SKU: ${p.sku} | High Durability Standard Fitment`;
  let warranty = "7-Day Replacement Guarantee on manufacturing defects.";

  if (desc.startsWith("{") && desc.endsWith("}")) {
    try {
      const obj = JSON.parse(desc);
      desc = obj.description || "";
      features = obj.features || [];
      if (obj.compatibility) compat = `#${obj.compatibility}`;
      if (obj.specs) specs = obj.specs;
      if (obj.warranty) warranty = obj.warranty;
    } catch (_) {}
  }

  if (!features.length) {
    features = [
      "Heavy-duty materials engineered for daily commercial EV use",
      "High-efficiency performance with low thermal resistance",
      "Direct plug & play installation"
    ];
  }

  $("#detailCompatibilityNote").textContent = compat;
  $("#detailSubHeading").textContent = p.name;
  $("#detailDescriptionText").textContent = desc || "Heavy-duty electric vehicle replacement part engineered for optimum durability and seamless fitting.";

  $("#detailFeaturesList").innerHTML = features.map(f => `<li>${esc(f)}</li>`).join("");
  $("#detailFitmentText").textContent = p.brand || "Universal Fitment for all standard EV models";
  $("#detailWarrantyText").textContent = warranty;

  // Similar items
  const similar = state.allProducts.filter(item => (item.category || item.type) === (p.category || p.type) && item.id !== p.id).slice(0, 4);
  renderSimilarProducts(similar);
}

function renderSimilarProducts(items) {
  const container = $("#similarProductsGrid");
  if (!items.length) {
    container.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;">No similar items available.</p>';
    return;
  }

  container.innerHTML = items.map(p => `
    <div class="similar-card">
      <div class="similar-img-box" onclick="openProductDetail('${p.id}')">
        ${p.image ? `<img src="${p.image}" alt="${esc(p.name)}">` : `<span style="font-size:28px">⚙</span>`}
      </div>
      <h4 class="similar-title" onclick="openProductDetail('${p.id}')">${esc(p.name)}</h4>
      <div class="similar-price">${money(p.price)} <small>/ PCS</small></div>
      <button class="btn-similar-quote" onclick="addToCart('${p.id}')">Add to Cart</button>
    </div>
  `).join("");
}

function adjustDetailQty(delta) {
  const n = state.detailQty + delta;
  if (n >= 1) {
    state.detailQty = n;
    $("#detailQtyValue").textContent = n;
  }
}

function addCurrentProductToCart() {
  if (state.currentProduct) addToCart(state.currentProduct.id, state.detailQty);
}

// 5. CART MANAGEMENT
function addToCart(id, qty = 1) {
  const p = state.allProducts.find(x => x.id === id);
  if (!p) return;

  const item = state.cart.find(x => x.productId === id);
  if (item) item.quantity += qty;
  else state.cart.push({ productId: id, name: p.name, price: p.price, quantity: qty });

  saveCart();
  toast("Added to Cart");
}

function changeCartQty(id, delta) {
  const item = state.cart.find(x => x.productId === id);
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) state.cart = state.cart.filter(x => x.productId !== id);

  saveCart();
}

function saveCart() {
  localStorage.setItem("evhub_cart", JSON.stringify(state.cart));
  updateCartCounters();
  renderEmbeddedCart();
  renderDrawerCart();
}

function updateCartCounters() {
  const count = state.cart.reduce((a, b) => a + b.quantity, 0);
  const badge = $("#cartCountBadge");
  if (badge) badge.textContent = count;
}

function renderEmbeddedCart() {
  const box = $("#embeddedCartContent");
  if (!box) return;

  if (!state.cart.length) {
    box.innerHTML = `
      <div class="empty-cart-state">
        <span class="empty-bag-icon">🛍️</span>
        <p>Cart is empty</p>
      </div>`;
    return;
  }

  const total = state.cart.reduce((a, b) => a + b.price * b.quantity, 0);

  box.innerHTML = `
    <div>
      ${state.cart.map(x => `
        <div class="cart-item-row">
          <div>
            <div style="font-weight:600;margin-bottom:2px;">${esc(x.name)}</div>
            <div style="color:var(--muted);font-size:11.5px;">${money(x.price)} ×${x.quantity}</div>
          </div>
          <div>
            <button class="cart-item-qty-btn" onclick="changeCartQty('${x.productId}', -1)">−</button>
            <span style="margin:0 4px;font-weight:600;">${x.quantity}</span>
            <button class="cart-item-qty-btn" onclick="changeCartQty('${x.productId}', 1)">+</button>
          </div>
        </div>
      `).join("")}
      <div style="display:flex;justify-content:space-between;margin:12px 0 8px;font-weight:700;">
        <span>Total:</span>
        <span style="color:var(--accent)">${money(total)}</span>
      </div>
      <button class="btn-primary-add full" onclick="openCheckout()">Checkout</button>
    </div>
  `;
}

function renderDrawerCart() {
  const box = $("#drawerCartItems");
  if (!box) return;

  if (!state.cart.length) {
    box.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px 0;">Your cart is empty.</p>';
    $("#drawerCartTotal").textContent = money(0);
    return;
  }

  box.innerHTML = state.cart.map(x => `
    <div class="cart-item-row">
      <div>
        <div style="font-weight:600">${esc(x.name)}</div>
        <div style="color:var(--muted);font-size:12px;">${money(x.price)} × ${x.quantity}</div>
      </div>
      <div>
        <button class="cart-item-qty-btn" onclick="changeCartQty('${x.productId}', -1)">−</button>
        <span style="margin:0 4px;font-weight:600">${x.quantity}</span>
        <button class="cart-item-qty-btn" onclick="changeCartQty('${x.productId}', 1)">+</button>
      </div>
    </div>
  `).join("");

  $("#drawerCartTotal").textContent = money(state.cart.reduce((a, b) => a + b.price * b.quantity, 0));
}

function openCart() { renderDrawerCart(); $("#cartDrawer").classList.add("open"); }
function closeCart() { $("#cartDrawer").classList.remove("open"); }

// 6. ORDER SUMMARY POPUP & DIRECT WHATSAPP FLOW
function openCheckout() {
  if (!state.cart.length) return toast("Cart is empty");
  closeCart();

  const listContainer = $("#checkoutItemsList");
  const totalContainer = $("#checkoutTotalAmount");

  if (listContainer) {
    listContainer.innerHTML = state.cart.map((x, index) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;">
        <div style="text-align:left;">
          <div style="font-weight:600;color:#fff;">${index + 1}. ${esc(x.name)}</div>
          <div style="color:var(--muted);font-size:11.5px;">${money(x.price)} × ${x.quantity}</div>
        </div>
        <div style="font-weight:700;color:var(--accent);">${money(x.price * x.quantity)}</div>
      </div>
    `).join("");
  }

  const grandTotal = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  if (totalContainer) totalContainer.textContent = money(grandTotal);

  $("#checkoutModal").classList.add("open");
}

function closeCheckout() {
  $("#checkoutModal").classList.remove("open");
}

function sendOrderViaWhatsApp() {
  if (!state.cart.length) return toast("Cart is empty");

  const number = (window.WHATSAPP_NUMBER || "917668133191").replace(/^"|"$/g, "");
  const grandTotal = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const lines = state.cart.map((x, i) => `${i + 1}. *${x.name}*\n   Qty: ${x.quantity} | Subtotal: ${money(x.price * x.quantity)}`).join("\n\n");
  const msg = `🛒 *NEW SPARE PARTS ORDER / INQUIRY*\n\n*Items List:*\n${lines}\n\n*Total Payable:* ${money(grandTotal)}\n\nKripya order confirmation aur availability confirm karein.`;

  window.open(`https://wa.me/${number}?text=${encodeURIComponent(msg)}`, "_blank");

  // Cart clear and close
  state.cart = [];
  saveCart();
  closeCheckout();
  toast("Order sent on WhatsApp!");
}

// 7. SEARCH FUNCTIONALITY
let searchTimer;
function debouncedSearch(val) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = val.trim().toLowerCase();
    if (!q) { renderAllCategoriesAndProducts(); return; }

    showStoreView();
    const container = $("#allCategoriesSectionsContainer");
    const matches = state.allProducts.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      ((p.category || p.type) && (p.category || p.type).toLowerCase().includes(q))
    );

    if (!matches.length) {
      container.innerHTML = `<p style="color:var(--muted);padding:24px;">No products found for "${val}".</p>`;
      return;
    }

    container.innerHTML = `
      <section class="category-block-section">
        <div class="category-block-header">
          <h3 class="category-block-title">Search Results ("${val}")</h3>
          <span class="category-count-badge">${matches.length} Items</span>
        </div>
        <div class="products-row-container">
          ${matches.map(p => `
            <article class="product-row-card">
              <div class="product-row-img" onclick="openProductDetail('${p.id}')">
                ${p.image ? `<img src="${p.image}" alt="${esc(p.name)}">` : `<span style="font-size:24px">⚙</span>`}
              </div>
              <div class="product-row-info">
                <h4 class="product-row-title" onclick="openProductDetail('${p.id}')">${esc(p.name)}</h4>
                <div class="product-row-price-wrap">
                  <span class="product-row-price">${money(p.price)} <small>/ PCS</small></span>
                </div>
              </div>
              <button class="btn-add-quote" onclick="addToCart('${p.id}')">Add to Cart +</button>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }, 250);
}

// WhatsApp Number Config fetch & Store Initialization
fetch("https://sparewallah.onrender.com/api/config")
  .then(r => r.json())
  .then(c => window.WHATSAPP_NUMBER = c.whatsappNumber)
  .catch(() => {});

initStore();