/* ---------- Product Detail (Professional View) ---------- */
async function openProduct(id) {
  const body = $("#productDetail"); 
  body.innerHTML = `<div class="skeleton" style="height:350px;border-radius:16px"></div>`; 
  openM("productModal");
  
  try {
    const snap = await getDoc(doc(db, "products", id)); 
    if (!snap.exists()) throw new Error("Not found");
    const p = { id: snap.id, ...snap.data() };
    const price = Number(p.price) || 0;
    
    // Screenshots HTML
    const screenshots = (p.screenshotUrls || []).map(url => 
      `<img src="${safeUrl(url) || PH}" style="width:100%;border-radius:12px;margin-bottom:10px;border:1px solid #eee" alt="Screenshot">`
    ).join("");

    body.innerHTML = `
      <div class="product-detail">
        <div style="display:flex; gap:16px; align-items:center; margin-bottom:20px">
          <img src="${safeUrl(p.imageUrl) || PH}" style="width:80px; height:80px; border-radius:20px; box-shadow:0 4px 10px rgba(0,0,0,0.1)" alt="Logo">
          <div>
            <h2 style="font-size:1.3rem; margin:0 0 4px 0">${esc(p.name)}</h2>
            <span class="product-cat" style="font-size:0.85rem">${esc(p.categoryName || "App")}</span>
            <div style="margin-top:6px; display:flex; align-items:center; gap:8px">
              <span class="price-now" style="font-size:1.4rem; color:var(--primary)">${money(price)}</span>
              ${Number(p.originalPrice) > price ? `<span class="price-old">${money(p.originalPrice)}</span>` : ""}
            </div>
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:20px">
          <button class="btn btn-primary btn-block" id="pmBuyNow" ${p.available === false ? "disabled" : ""}>
            <i class="fa-solid fa-bolt"></i> Buy Now
          </button>
          <button class="btn btn-ghost btn-block" id="pmAddCart" ${p.available === false ? "disabled" : ""}>
            <i class="fa-solid fa-cart-plus"></i> Add to Cart
          </button>
        </div>

        <div class="detail-desc" style="margin-bottom:20px">
          <h4 style="color:var(--text); margin-bottom:6px">Description</h4>
          <p style="color:var(--muted); font-size:0.9rem; line-height:1.6">${esc(p.description || "No description available.")}</p>
        </div>

        ${screenshots ? `
        <div class="detail-screenshots">
          <h4 style="color:var(--text); margin-bottom:10px">Screenshots</h4>
          <div style="display:flex; overflow-x:auto; gap:10px; padding-bottom:10px; scrollbar-width:none;">
             ${(p.screenshotUrls || []).map(url => `<img src="${safeUrl(url)||PH}" style="min-width:200px; height:300px; object-fit:cover; border-radius:12px; border:1px solid #eee">`).join('')}
          </div>
        </div>` : ""}
      </div>`;
      
    // Buy Now Logic (Direct Checkout)
    $("#pmBuyNow").onclick = () => { 
       localStorage.setItem(CART_KEY, JSON.stringify([{ id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, qty: 1 }]));
       updateCartBadge();
       closeM("productModal");
       renderOrderSummary(); 
       renderPaymentInstructions($("#ofMethod").value);
       openM("orderModal");
    };

    // Add to Cart Logic
    $("#pmAddCart").onclick = () => { addToCart(p); closeM("productModal"); };

  } catch (err) { 
    body.innerHTML = `<div class="alert alert-danger">Failed to load product details.</div>`; 
  }
}
