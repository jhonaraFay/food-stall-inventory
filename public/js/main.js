// --------------------
// GLOBALS
// --------------------
let authToken = null; // store login token

// DOM Elements
const loginForm = document.getElementById('loginForm');
const loginStatus = document.getElementById('loginStatus');
const loginContainer = document.getElementById('loginContainer');
const mainContent = document.getElementById('mainContent');

const addItemForm = document.getElementById('addItemForm');
const updateItemForm = document.getElementById('updateItemForm');
const deleteItemForm = document.getElementById('deleteItemForm');
const saleForm = document.getElementById('saleForm');
const viewAllInventoryBtn = document.getElementById('viewAllInventory');
const branchInventories = document.getElementById('branchInventories');
const viewSalesBtn = document.getElementById('viewSales');
const salesBranchInput = document.getElementById('salesBranch');
const salesTableBody = document.getElementById('salesTable').querySelector('tbody');
const viewTotalProfitBtn = document.getElementById('viewTotalProfit');
const totalProfitDisplay = document.getElementById('totalProfitDisplay');
const simulateSalesBtn = document.getElementById('simulateSales');
const simulationStatus = document.getElementById('simulationStatus');

// --------------------
// LOGIN
// --------------------
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));

    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: data.username, pass: data.password })
        });
        const result = await res.json();

        if (res.ok) {
            authToken = result.token;
            loginStatus.textContent = 'Login successful!';
            loginContainer.style.display = 'none';
            mainContent.style.display = 'block';

            // Load initial data
            fetchAllInventory();
            fetchSales();
            fetchTotalProfit();
        } else {
            loginStatus.textContent = result.message || 'Login failed';
        }
    } catch (err) {
        console.error('Login error:', err);
        loginStatus.textContent = 'Error connecting to server';
    }
});

// --------------------
// HELPER: fetch with auth
// --------------------
async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['x-auth-token'] = authToken;
    return fetch(url, options);
}

// --------------------
// CRUD OPERATIONS
// --------------------
addItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await authFetch('/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await res.json();
    alert(result.message);
    fetchAllInventory();
});

updateItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await authFetch('/item', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await res.json();
    alert(result.message);
    fetchAllInventory();
});

deleteItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await authFetch('/item', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await res.json();
    alert(result.message);
    fetchAllInventory();
});

// --------------------
// RECORD SALE
// --------------------
saleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await authFetch('/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await res.json();
    alert(result.message);
    fetchAllInventory();
    fetchSales();
    fetchTotalProfit();
});

// --------------------
// FETCH INVENTORY
// --------------------
async function fetchAllInventory() {
    const branches = ['main', '2'];
    branchInventories.innerHTML = '';
    const stockThreshold = 10;

    for (let branch of branches) {
        try {
            const res = await authFetch(`/inventory/${branch}`);
            const items = await res.json();
            if (!Array.isArray(items)) continue;

            const div = document.createElement('div');
            div.innerHTML = `<h4>Branch: ${branch}</h4>`;

            // Table
            const table = document.createElement('table');
            table.innerHTML = `
                <thead>
                    <tr><th>Name</th><th>Stock</th><th>Price</th><th>Category</th></tr>
                </thead>
                <tbody></tbody>
            `;
            const tbody = table.querySelector('tbody');

            items.forEach(item => {
                const row = document.createElement('tr');
                if (parseInt(item.stock) < stockThreshold) row.classList.add('low-stock');
                row.innerHTML = `
                    <td>${item.name}</td>
                    <td>${item.stock}</td>
                    <td>${item.price}</td>
                    <td>${item.category}</td>
                `;
                tbody.appendChild(row);
            });

            div.appendChild(table);
            branchInventories.appendChild(div);
        } catch (err) {
            console.error('Inventory fetch error:', err);
        }
    }
}
viewAllInventoryBtn.addEventListener('click', fetchAllInventory);

// --------------------
// FETCH SALES
// --------------------
async function fetchSales() {
    const branch = salesBranchInput.value;
    try {
        const res = await authFetch(`/sales/${branch}`);
        const sales = await res.json();

        salesTableBody.innerHTML = '';
        sales.forEach(sale => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${sale.item}</td>
                <td>${sale.quantity}</td>
                <td>${sale.total}</td>
                <td>${new Date(sale.date).toLocaleString()}</td>
            `;
            salesTableBody.appendChild(row);
        });
    } catch (err) {
        console.error('Sales fetch error:', err);
    }
}
viewSalesBtn.addEventListener('click', fetchSales);

// --------------------
// TOTAL PROFIT
// --------------------
async function fetchTotalProfit() {
    try {
        const res = await authFetch('/total-profit');
        const data = await res.json();
        totalProfitDisplay.textContent = `₱${data.totalProfit.toFixed(2)}`;
    } catch (err) {
        console.error('Total profit fetch error:', err);
    }
}
viewTotalProfitBtn.addEventListener('click', fetchTotalProfit);

// --------------------
// SIMULATION MODE
// --------------------
async function simulateRandomSales() {
    const branches = ['main', '2'];
    const itemsPerBranch = 3;

    for (let branch of branches) {
        try {
            const res = await authFetch(`/inventory/${branch}`);
            const items = await res.json();
            for (let i = 0; i < itemsPerBranch; i++) {
                if (items.length === 0) break;
                const item = items[Math.floor(Math.random() * items.length)];
                const quantity = Math.floor(Math.random() * 5) + 1;

                await authFetch('/sale', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ branch, name: item.name, quantity })
                });
            }
        } catch (err) {
            console.error('Simulation error:', err);
        }
    }

    simulationStatus.textContent = 'Simulation complete! Inventory and sales updated.';
    fetchAllInventory();
    fetchSales();
    fetchTotalProfit();
}
simulateSalesBtn.addEventListener('click', simulateRandomSales);

// --------------------
// TAB FUNCTIONALITY
// --------------------
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        tabContents.forEach(c => c.classList.remove('active'));
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

// --------------------
// AUTO-REFRESH EVERY 5s
// --------------------
setInterval(() => {
    if (!authToken) return; // skip if not logged in
    const activeTab = document.querySelector('.tab.active').dataset.tab;
    if (activeTab === 'inventory') fetchAllInventory();
    if (activeTab === 'sales') fetchSales();
    if (activeTab === 'profit') fetchTotalProfit();
}, 5000);
