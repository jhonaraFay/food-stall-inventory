// server.js

const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('redis');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // serve HTML + JS

// Connect to Redis Node A (Main Branch)
const redisA = createClient({ url: 'redis://localhost:6379' });
redisA.connect().then(() => console.log('Connected to Redis Node A'));

// Connect to Redis Node B (Branch 2)
const redisB = createClient({ url: 'redis://localhost:6380' });
redisB.connect().then(() => console.log('Connected to Redis Node B'));

// -------------------
// CRUD ROUTES
// -------------------

// Add a new item
app.post('/item', async (req, res) => {
    const { branch, name, stock, price, category } = req.body;
    const key = `branch:${branch}:item:${name}`;
    try {
        await redisClient.hSet(key, { stock, price, category });
        res.json({ message: 'Item added successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error adding item' });
    }
});


// Get item details
app.get('/item/:branch/:name', async (req, res) => {
    try {
        const { branch, name } = req.params;
        const key = `branch:${branch}:item:${name}`;
        const item = await redisA.hGetAll(key);

        if (!item || Object.keys(item).length === 0) return res.status(404).json({ message: 'Item not found' });
        res.json(item);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update item
app.put('/item', async (req, res) => {
    try {
        const { branch, name, stock, price, category } = req.body;
        if (!branch || !name) return res.status(400).json({ message: 'Missing branch or name' });

        const key = `branch:${branch}:item:${name}`;
        const data = {};
        if (stock !== undefined) data.stock = String(stock);
        if (price !== undefined) data.price = String(price);
        if (category !== undefined) data.category = category;

        await redisA.hSet(key, data);
        await redisB.hSet(key, data);

        res.json({ message: 'Item updated and synchronized!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete item
app.delete('/item', async (req, res) => {
    try {
        const { branch, name } = req.body;
        if (!branch || !name) return res.status(400).json({ message: 'Missing branch or name' });

        const key = `branch:${branch}:item:${name}`;
        await redisA.del(key);
        await redisB.del(key);

        res.json({ message: 'Item deleted and synchronized!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// -------------------
// SALES ROUTE
// -------------------
app.post('/sale', async (req, res) => {
    try {
        const { branch, name, quantity } = req.body;
        if (!branch || !name || !quantity) return res.status(400).json({ message: 'Missing fields' });

        const key = `branch:${branch}:item:${name}`;
        const item = await redisA.hGetAll(key);

        if (!item || Object.keys(item).length === 0) return res.status(404).json({ message: 'Item not found' });
        if (parseInt(item.stock) < quantity) return res.status(400).json({ message: 'Insufficient stock' });

        // Update stock
        const newStock = parseInt(item.stock) - quantity;
        await redisA.hSet(key, 'stock', String(newStock));
        await redisB.hSet(key, 'stock', String(newStock));

        // Record sale
        const saleRecord = JSON.stringify({ item: name, quantity, total: quantity * parseFloat(item.price), date: new Date() });
        await redisA.rPush(`branch:${branch}:sales`, saleRecord);
        await redisB.rPush(`branch:${branch}:sales`, saleRecord);

        res.json({ message: 'Sale recorded and stock updated!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});
// Get all items for a branch
app.get('/inventory/:branch', async (req, res) => {
    try {
        const { branch } = req.params;
        const keys = await redisA.keys(`branch:${branch}:item:*`);
        const items = [];

        for (let key of keys) {
            const itemName = key.split(':')[3];
            const item = await redisA.hGetAll(key);
            items.push({ name: itemName, ...item });
        }

        res.json(items);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get sales report for a branch
app.get('/sales/:branch', async (req, res) => {
    try {
        const { branch } = req.params;
        const sales = await redisA.lRange(`branch:${branch}:sales`, 0, -1);
        const parsedSales = sales.map(s => JSON.parse(s));
        res.json(parsedSales);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});
// Get total profit across all branches
app.get('/total-profit', async (req, res) => {
    try {
        const branches = ['main', '2']; // add more branch IDs if needed
        let totalProfit = 0;

        for (let branch of branches) {
            const sales = await redisA.lRange(`branch:${branch}:sales`, 0, -1);
            sales.forEach(sale => {
                const s = JSON.parse(sale);
                totalProfit += s.total;
            });
        }

        res.json({ totalProfit });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});


// -------------------
// START SERVER
// -------------------
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

(async () => {
    try {
        await redisClient.connect();
        console.log('Redis connected successfully!');
    } catch(err) {
        console.error('Redis connection failed:', err);
    }
})();
