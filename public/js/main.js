(async () => {
    try {
        await redisClient.connect();
        console.log('Redis connected successfully!');
    } catch(err) {
        console.error('Redis connection failed:', err);
    }
})();


// --------------------
// Add / Update / Delete / Sale
// --------------------

// Add Item
document.getElementById('addItemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await fetch('/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await res.json();
    alert(result.message);
});

// Update Item
document.getElementById('updateItemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await fetch('/item', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await res.json();
    alert(result.message);
});

// Delete Item
document.getElementById('deleteItemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await fetch('/item', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await res.json();
    alert(result.message);
});

// Record Sale
document.getElementById('saleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await fetch('/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await res.json();
    alert(result.message);
});

// --------------------
// Inventory Functions
// --------------------
async function fetchAllInventory() {
    const branches = ['main', '2']; // add more branch IDs if needed
    const container = document.getElementById('branchInventories');
    container.innerHTML = '';

    const stockThreshold = 10;

    for (let branch of branches) {
        try {
            const res = await fetch(`/inventory/${branch}`);
            const items = await res.json();

            // Safety check: ensure items is an array
            if (!Array.isArray(items)) {
                console.error(`Inventory fetch failed for branch ${branch}:`, items);
                const errorDiv = document.createElement('div');
                errorDiv.textContent = `Error fetching inventory for branch ${branch}.`;
                container.appendChild(errorDiv);
                continue; // skip to next branch
            }

            const div = document.createElement('div');
            div.innerHTML = `<h4>Branch: ${branch}</h4>`;

            // Low stock list
            const ul = document.createElement('ul');
            items.forEach(item => {
                if (parseInt(item.stock) < stockThreshold) {
                    const li = document.createElement('li');
                    li.textContent = `${item.name} (Stock: ${item.stock})`;
                    ul.appendChild(li);
                }
            });
            div.appendChild(ul);

            // Table
            const table = document.createElement('table');
            table.innerHTML = `
                <thead>
                    <tr>
                        <th>Item Name</th><th>Stock</th><th>Price</th><th>Category</th>
                    </tr>
                </thead>
                <tbody></tbody>
            `;

            const tbody = table.querySelector('tbody');
            items.forEach(item => {
                const row = document.createElement('tr');
                if (parseInt(item.stock) < stockThreshold) {
                    row.classList.add('low-stock');
                }
                row.innerHTML = `
                    <td>${item.name}</td>
                    <td>${item.stock}</td>
                    <td>${item.price}</td>
                    <td>${item.category}</td>
                `;
                tbody.appendChild(row);
            });

            div.appendChild(table);
            container.appendChild(div);

        } catch (err) {
            console.error(`Error fetching inventory for branch ${branch}:`, err);
            const errorDiv = document.createElement('div');
            errorDiv.textContent = `Error fetching inventory for branch ${branch}.`;
            container.appendChild(errorDiv);
        }
    }
}


// View all inventory button
document.getElementById('viewAllInventory').addEventListener('click', fetchAllInventory);

// --------------------
// Sales Report
// --------------------
async function fetchSales() {
    const branch = document.getElementById('salesBranch').value;
    const res = await fetch(`/sales/${branch}`);
    const sales = await res.json();

    const tbody = document.getElementById('salesTable').querySelector('tbody');
    tbody.innerHTML = '';
    sales.forEach(sale => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${sale.item}</td>
            <td>${sale.quantity}</td>
            <td>${sale.total}</td>
            <td>${new Date(sale.date).toLocaleString()}</td>
        `;
        tbody.appendChild(row);
    });
}

// Sales button
document.getElementById('viewSales').addEventListener('click', fetchSales);

// --------------------
// Total Profit
// --------------------
async function fetchTotalProfit() {
    const res = await fetch('/total-profit');
    const data = await res.json();
    document.getElementById('totalProfitDisplay').textContent = `₱${data.totalProfit.toFixed(2)}`;
}

// Total profit button
document.getElementById('viewTotalProfit').addEventListener('click', fetchTotalProfit);

// --------------------
// Simulation Mode
// --------------------
async function simulateRandomSales() {
    const branches = ['main', '2'];
    const itemsPerBranch = 3;

    for (let branch of branches) {
        const res = await fetch(`/inventory/${branch}`);
        const items = await res.json();

        for (let i = 0; i < itemsPerBranch; i++) {
            if (items.length === 0) break;
            const item = items[Math.floor(Math.random() * items.length)];
            const quantity = Math.floor(Math.random() * 5) + 1;

            await fetch('/sale', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branch, name: item.name, quantity })
            });
        }
    }

    document.getElementById('simulationStatus').textContent = 'Simulation complete! Inventory and sales updated.';
    fetchAllInventory();
    fetchSales();
    fetchTotalProfit();
}

// Simulation button
document.getElementById('simulateSales').addEventListener('click', simulateRandomSales);

// --------------------
// Auto-refresh every 5 seconds
// --------------------
setInterval(() => {
    const activeTab = document.querySelector('.tab.active').dataset.tab;
    if (activeTab === 'inventory') fetchAllInventory();
    if (activeTab === 'sales') fetchSales();
    if (activeTab === 'profit') fetchTotalProfit();
}, 5000);
