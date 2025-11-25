// server.js
const express = require('express');
const path = require('path');
const { createClient } = require('redis');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // ADD THIS
app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;

// Create Redis clients for two nodes (master & replica)
const redisA = createClient({ url: 'redis://localhost:6379' }); // Node A (main)
const redisB = createClient({ url: 'redis://localhost:6380' }); // Node B (branch 2)

// Helper: map branch id -> redis client
function clientForBranch(branch) {
  // simple mapping: 'main' => redisA, '2' => redisB
  // extend this mapping if you add more branches
  if (branch === 'main') return redisA;
  if (branch === '2') return redisB;
  // default to redisA
  return redisA;
}

// Connect both clients then start server
async function start() {
  try {
    redisA.on('error', (e) => console.error('RedisA Error', e));
    redisB.on('error', (e) => console.error('RedisB Error', e));

    await redisA.connect();
    console.log('Connected to Redis Node A (master)');

    await redisB.connect();
    console.log('Connected to Redis Node B (replica)');

    // Start Express server only after Redis clients are connected
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
  } catch (err) {
    console.error('Failed to connect to Redis nodes:', err);
    process.exit(1);
  }
}

// -------------------
// CRUD ROUTES (FIXED)
// -------------------

// Add a new item
app.post('/item', requireAuth, async (req, res) => {
    const { branch, name, stock, price, category } = req.body;
    const redis = branch === "main" ? redisA : redisB;
    const key = `branch:${branch}:item:${name}`;

    try {
        await redis.hSet(key, { 
            stock: String(stock),
            price: String(price),
            category 
        });
        res.json({ message: 'Item added successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error adding item' });
    }
});


// UPDATE item (supports renaming + does NOT delete old fields)
app.put('/item', requireAuth, async (req, res) => {
    try {
        const { branch, name, newName, stock, price, category } = req.body;
        const redis = branch === "main" ? redisA : redisB;

        const key = `branch:${branch}:item:${name}`;

        // Read current item
        const existing = await redis.hGetAll(key);
        if (!existing || Object.keys(existing).length === 0)
            return res.status(404).json({ message: 'Item not found' });

        // Prepare updated data — KEEP old values if not provided
        const updated = {
            stock: stock !== undefined ? String(stock) : existing.stock,
            price: price !== undefined ? String(price) : existing.price,
            category: category !== undefined ? category : existing.category
        };

        // If renaming item
        if (newName && newName !== name) {
            const newKey = `branch:${branch}:item:${newName}`;
            await redis.hSet(newKey, updated);  // create new hash
            await redis.del(key);               // delete old hash

            // Also sync Rename to B
            const other = branch === "main" ? redisB : redisA;
            await other.hSet(newKey, updated);
            await other.del(key);

            return res.json({ message: 'Item renamed & updated!' });
        }

        // Normal update (no rename)
        await redis.hSet(key, updated);

        // Sync with other node
        const other = branch === "main" ? redisB : redisA;
        await other.hSet(key, updated);

        res.json({ message: 'Item updated!' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});


// DELETE item
app.delete('/item', requireAuth, async (req, res) => {
    try {
        const { branch, name } = req.body;
        const key = `branch:${branch}:item:${name}`;

        await redisA.del(key);
        await redisB.del(key);

        res.json({ message: 'Item deleted!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});


/* -----------------------
   SALES ROUTE (atomic on master)
   - we use Lua EVAL on redisA to check stock and update atomically
   - then replicate the resulting stock and sale record to redisB
   ----------------------- */

const saleLuaScript = `
-- KEYS[1] = item key, KEYS[2] = sale list key
-- ARGV[1] = qty (number), ARGV[2] = saleRecord (json string)
local itemKey = KEYS[1]
local salesKey = KEYS[2]
local qty = tonumber(ARGV[1])
if not qty then
  return {err="INVALID_QTY"}
end
local stock = tonumber(redis.call('hget', itemKey, 'stock') or '0')
local price = tonumber(redis.call('hget', itemKey, 'price') or '0')
if stock < qty then
  return {err="INSUFFICIENT_STOCK"}
end
local newStock = stock - qty
redis.call('hset', itemKey, 'stock', tostring(newStock))
redis.call('rpush', salesKey, ARGV[2])
local total = qty * price
return tostring(total)
`;

app.post('/sale', requireAuth, async (req, res) => {
  try {
    // Accept both { quantity } and { qty } (frontend variance)
    const { branch, name } = req.body;
    const quantity = req.body.quantity ?? req.body.qty ?? req.body.qtySold ?? req.body.q ?? null;

    const qty = Number(quantity);
    if (!branch || !name || !qty || qty <= 0) {
      return res.status(400).json({ message: 'Missing or invalid fields (branch, name, quantity)' });
    }

    const itemKey = `branch:${branch}:item:${name}`;
    const salesListKey = `branch:${branch}:sales`;
    const saleRecord = JSON.stringify({ item: name, quantity: qty, total: null, date: new Date().toISOString() });

    // Atomically check stock and apply on master (redisA)
    const evalResult = await redisA.eval(saleLuaScript, {
      keys: [itemKey, salesListKey],
      arguments: [String(qty), saleRecord]
    });

    // If eval returned an error message (node-redis converts server errors)
    if (evalResult === null) {
      // null is unexpected; handle gracefully
      return res.status(500).json({ message: 'Sale failed (unexpected result)' });
    }

    // If eval returned an error string (e.g., "ERR ...") it throws, but we handle returned strings:
    if (typeof evalResult === 'string') {
      // success: evalResult is total as string
      const total = Number(evalResult);
      // update the saleRecord with real total (replace last pushed value in master if needed)
      // Since we already pushed saleRecord without total, let's update the last element to include total.
      const updatedSaleRecord = JSON.stringify({ item: name, quantity: qty, total, date: new Date().toISOString() });

      // Replace last element in master sales list with updatedSaleRecord
      // Get current length
      const len = await redisA.lLen(salesListKey);
      if (len > 0) {
        await redisA.lSet(salesListKey, len - 1, updatedSaleRecord);
      }

      // Replicate to redisB: set new stock and push sale record
      const masterItem = await redisA.hGetAll(itemKey);
      if (masterItem && Object.keys(masterItem).length > 0) {
        // replicate stock
        if (masterItem.stock !== undefined) {
          await redisB.hSet(itemKey, 'stock', masterItem.stock);
        }
      }
      // push sale record to replica as well
      await redisB.rPush(salesListKey, updatedSaleRecord);

      return res.json({ message: 'Sale recorded and stock updated!', total });
    }

    // If eval returned some other type
    return res.status(500).json({ message: 'Sale failed' });
  } catch (err) {
    // handle specific errors from Lua script
    const msg = err && err.message ? err.message : String(err);
    if (msg.includes('INSUFFICIENT_STOCK')) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }
    console.error('POST /sale error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/* -----------------------
   INVENTORY & REPORT ROUTES
   ----------------------- */

// Get all items for a branch
app.get('/inventory/:branch', async (req, res) => {
  try {
    const { branch } = req.params;
    const redisNode = clientForBranch(branch);

    const keys = await redisNode.keys(`branch:${branch}:item:*`);
    const items = [];

    for (let key of keys) {
      const itemName = key.split(':')[3];
      const item = await redisNode.hGetAll(key);
      items.push({ name: itemName, ...item });
    }

    return res.json(items);
  } catch (err) {
    console.error('GET /inventory error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Get sales report for a branch
app.get('/sales/:branch', async (req, res) => {
  try {
    const { branch } = req.params;
    const redisNode = clientForBranch(branch);
    const sales = await redisNode.lRange(`branch:${branch}:sales`, 0, -1);
    const parsedSales = sales.map(s => {
      try { return JSON.parse(s); } catch { return s; }
    });
    return res.json(parsedSales);
  } catch (err) {
    console.error('GET /sales error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Get total profit across all branches (reads from corresponding node for each branch)
app.get('/total-profit', async (req, res) => {
  try {
    // Define known branches. If you add more, update this array.
    const branches = ['main', '2'];
    let totalProfit = 0;

    for (let branch of branches) {
      const redisNode = clientForBranch(branch);
      const sales = await redisNode.lRange(`branch:${branch}:sales`, 0, -1);
      for (let s of sales) {
        try {
          const p = JSON.parse(s);
          totalProfit += Number(p.total || 0);
        } catch { /* ignore parse errors */ }
      }
    }

    return res.json({ totalProfit });
  } catch (err) {
    console.error('GET /total-profit error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// simple in-memory users (demo). Replace with DB in production.
const demoUsers = {
  'user1': 'pass1',
  'admin': 'admin'
};
const sessions = {}; // token -> username

const crypto = require('crypto');

function generateToken(){ return crypto.randomBytes(24).toString('hex'); }

app.post('/login', (req, res) => {
  const { user, username, pass, password } = req.body || {};

  const u = user || username;
  const p = pass || password;

  if (!u || !p) return res.status(400).json({ message: 'Missing credentials' });

  if (demoUsers[u] && demoUsers[u] === p) {
    const token = generateToken();
    sessions[token] = { user: u, created: Date.now() };
    return res.json({ token });
  }

  return res.status(401).json({ message: 'Invalid credentials' });
});


// auth middleware for sensitive endpoints
function requireAuth(req, res, next){
  const token = req.headers['x-auth-token'];
  if (!token || !sessions[token]) return res.status(401).json({ message: 'Unauthorized' });
  req.user = sessions[token].user;
  next();
}


/* -----------------------
   START
   ----------------------- */
start();
