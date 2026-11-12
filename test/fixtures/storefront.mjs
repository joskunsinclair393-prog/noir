export const storefront = {
  'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="styles.css"><script src="script.js" defer></script></head><body>
<header><button id="menu" aria-expanded="false">Menu</button><nav hidden><a href="#shop">Shop</a></nav></header>
<main id="shop"><h1>Test storefront</h1><label>Search <input data-product-search></label>
<label>Category <select data-category-filter><option value="">All</option><option>Clothing</option><option>Accessories</option></select></label>
<section id="products" aria-label="Products"></section><h2>Cart</h2><div data-cart-items></div><output data-cart-total></output></main><footer>Contact</footer></body></html>`,
  'styles.css': 'body{margin:12px;font:16px system-ui}#products{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}article{padding:12px;border:1px solid} @media(max-width:500px){#products{grid-template-columns:1fr}}',
  'script.js': `
const products = [
  { name: 'Blue shirt', category: 'Clothing', price: 2000 },
  { name: 'Blue cap', category: 'Accessories', price: 1000 },
  { name: 'Red shirt', category: 'Clothing', price: 2500 }
];
const search = document.querySelector('[data-product-search]');
const category = document.querySelector('[data-category-filter]');
const grid = document.querySelector('#products');
const list = document.querySelector('[data-cart-items]');
const total = document.querySelector('[data-cart-total]');
const money = cents => '$' + (cents / 100).toFixed(2);
let cart = {};
try { cart = JSON.parse(localStorage.getItem('demo-cart-v1') || '{}') || {}; } catch {}
function renderCart() {
  list.replaceChildren();
  let sum = 0;
  for (const [id, quantity] of Object.entries(cart)) {
    const item = products[id];
    if (!item || !quantity) continue;
    sum += item.price * quantity;
    const row = document.createElement('p');
    row.textContent = item.name + ' × ' + quantity + ' · ' + money(item.price) + ' each · ' + money(item.price * quantity) + ' ';
    const remove = document.createElement('button');
    remove.textContent = 'Remove ' + item.name;
    remove.onclick = () => { delete cart[id]; save(); };
    row.append(remove);
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'Your cart is empty';
  total.textContent = money(sum);
}
function save() { localStorage.setItem('demo-cart-v1', JSON.stringify(cart)); renderCart(); }
function renderProducts() {
  grid.replaceChildren();
  products.forEach((item, id) => {
    if (!item.name.toLowerCase().includes(search.value.trim().toLowerCase())) return;
    if (category.value && item.category !== category.value) return;
    const card = document.createElement('article');
    card.textContent = item.name + ' · ' + money(item.price) + ' ';
    const button = document.createElement('button');
    button.dataset.addToCart = id;
    button.textContent = 'Add ' + item.name;
    button.onclick = () => { cart[id] = (cart[id] || 0) + 1; save(); };
    card.append(button);
    grid.append(card);
  });
  if (!grid.childElementCount) grid.textContent = 'No results';
}
search.oninput = category.onchange = renderProducts;
const menu = document.querySelector('#menu');
const nav = document.querySelector('nav');
menu.onclick = () => { nav.hidden = !nav.hidden; menu.setAttribute('aria-expanded', String(!nav.hidden)); };
nav.querySelector('a').onclick = () => { nav.hidden = true; menu.setAttribute('aria-expanded', 'false'); };
renderProducts();
renderCart();`,
};

// Append this only in browser tests, after the generated fixture's script.
export const storefrontBrowserChecks = `
function check(condition, message) { if (!condition) throw new Error(message); }
try {
  if (localStorage.getItem('browser-check-phase') !== 'added') {
    search.value = 'blue';
    search.dispatchEvent(new Event('input'));
    category.value = 'Clothing';
    category.dispatchEvent(new Event('change'));
    check(grid.children.length === 1 && grid.textContent.includes('Blue shirt'), 'Search and category must intersect');
    grid.querySelector('button').click();
    grid.querySelector('button').click();
    check(list.textContent.includes('Blue shirt × 2') && total.textContent === '$40.00', 'Cart must show quantity and total');
    localStorage.setItem('browser-check-phase', 'added');
    document.body.dataset.result = 'cart-added';
  } else {
    check(list.textContent.includes('Blue shirt × 2'), 'Cart must restore after preview refresh');
    list.querySelector('button').click();
    check(total.textContent === '$0.00' && list.textContent.includes('empty'), 'Remove must reset cart and total');
    menu.click();
    check(!nav.hidden && menu.getAttribute('aria-expanded') === 'true', 'Menu must open');
    nav.querySelector('a').click();
    check(nav.hidden, 'Menu must close after choosing a link');
    document.body.dataset.result = 'cart-restored-and-removed';
  }
} catch (error) {
  document.body.dataset.result = 'failure';
  document.body.dataset.failure = error.message;
}
`;
