const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// إعداد مجلد تخزين ملفات الـ JAR داخل public لسهولة التحميل
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// قواعد البيانات المحلية للكاتيجوريز والمودات (data.json)
const DATA_FILE = path.join(__dirname, 'data.json');
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ categories: [], mods: [] }, null, 2));
}

function readData() {
    return JSON.parse(fs.readFileSync(DATA_FILE));
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ==================== مسارات الـ API للكاتيجوريز والمودات وملفات الـ JAR ====================

app.get('/api/categories', (req, res) => {
    res.json(readData().categories);
});

app.post('/api/categories', (req, res) => {
    const { name, username } = req.body;
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    
    const data = readData();
    const newCat = { id: Date.now(), name, created_by: username || 'Anonymous' };
    data.categories.push(newCat);
    writeData(data);
    res.json(newCat);
});

app.delete('/api/categories/:id', (req, res) => {
    const catId = parseInt(req.params.id);
    const data = readData(); // تم تصحيح الخطأ هنا

    // حذف ملفات الـ JAR المرتبطة بالتصنيف من السيرفر
    data.mods.filter(m => m.category_id === catId).forEach(mod => {
        const filePath = path.join(uploadDir, mod.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    data.categories = data.categories.filter(c => c.id !== catId);
    data.mods = data.mods.filter(m => m.category_id !== catId);
    writeData(data);
    res.json({ success: true });
});

app.get('/api/mods/:categoryId', (req, res) => {
    const catId = parseInt(req.params.categoryId);
    const mods = readData().mods.filter(m => m.category_id === catId);
    res.json(mods);
});

// رفع ملف JAR داخل التصنيف
app.post('/api/upload-mod', upload.single('modfile'), (req, res) => {
    const { category_id, username } = req.body;
    const file = req.file;

    if (!file || !category_id) {
        return res.status(400).json({ error: 'Missing file or category ID' });
    }

    const data = readData();
    const newMod = {
        id: Date.now(),
        category_id: parseInt(category_id),
        filename: file.filename,
        original_name: file.originalname,
        uploaded_by: username || 'Anonymous'
    };

    data.mods.push(newMod);
    writeData(data);
    res.json({ success: true, mod: newMod });
});

// حذف ملف مود
app.delete('/api/mods/:id', (req, res) => {
    const modId = parseInt(req.params.id);
    const data = readData();
    const mod = data.mods.find(m => m.id === modId);

    if (mod) {
        const filePath = path.join(uploadDir, mod.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    data.mods = data.mods.filter(m => m.id !== modId);
    writeData(data);
    res.json({ success: true });
});

// ==================== مسار التنزيل (Download Route) الجديد ====================
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).send('File not found on server.');
    }
});


// ==================== منطق لعبة البوكر المتقدم (Texas Hold'em) ====================
let waitingPlayer = null;
const rooms = {};

// إنشاء ورشة أوراق وترتيبها
function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    for (let s of suits) {
        for (let v of values) {
            deck.push({ suit: s, value: v });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

// تقييم قوة اليد بشكل مبسّط ومحكم للمقارنة
function evaluateHandValue(cards) {
    const valueOrder = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    const sorted = cards.map(c => valueOrder[c.value]).sort((a, b) => b - a);
    
    const counts = {};
    sorted.forEach(v => counts[v] = (counts[v] || 0) + 1);
    const countValues = Object.values(counts).sort((a, b) => b - a);

    let score = sorted[0] || 0; 
    if (countValues[0] === 4) score += 800;      // Four of a kind
    else if (countValues[0] === 3 && countValues[1] >= 2) score += 700; // Full House
    else if (countValues[0] === 3) score += 400; // Three of a kind
    else if (countValues[0] === 2 && countValues[1] === 2) score += 300; // Two Pair
    else if (countValues[0] === 2) score += 100; // Pair

    return score;
}

function startNewHand(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    for (let p of room.players) {
        if (p.chips <= 0) {
            const winner = room.players.find(x => x.id !== p.id);
            io.to(roomId).emit('game_over', { reason: `GAME OVER! ${p.username} went bankrupt! ${winner.username} WINS THE MATCH!` });
            delete rooms[roomId];
            return;
        }
        if (p.chips >= 1000000) {
            io.to(roomId).emit('game_over', { reason: `MATCH OVER! ${p.username} reached $1,000,000+ AND WINS THE GAME!` });
            delete rooms[roomId];
            return;
        }
    }

    room.deck = createDeck();
    room.pot = 0;
    room.communityCards = [];
    room.stage = 'preflop'; 
    room.currentTurn = 0;

    room.players.forEach(p => {
        p.cards = [room.deck.pop(), room.deck.pop()];
        p.currentBet = 0;
        p.folded = false;
    });

    room.players.forEach((p, index) => {
        const opp = room.players[1 - index];
        io.to(p.id).emit('match_found', {
            roomId,
            opponent: opp.username,
            myCards: p.cards,
            chips: p.chips
        });
    });

    io.to(roomId).emit('game_update', {
        pot: room.pot,
        turnUser: room.players[room.currentTurn].username,
        stage: room.stage
    });
}

function advanceStage(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.stage === 'preflop') {
        room.stage = 'flop';
        room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    } else if (room.stage === 'flop') {
        room.stage = 'turn';
        room.communityCards.push(room.deck.pop());
    } else if (room.stage === 'turn') {
        room.stage = 'river';
        room.communityCards.push(room.deck.pop());
    } else if (room.stage === 'river') {
        room.stage = 'showdown';
        resolveShowdown(roomId);
        return;
    }

    io.to(roomId).emit('community_cards', { cards: room.communityCards });
    io.to(roomId).emit('game_update', {
        pot: room.pot,
        turnUser: room.players[room.currentTurn].username,
        stage: room.stage
    });
}

function resolveShowdown(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const p1 = room.players[0];
    const p2 = room.players[1];

    let winner = null;
    if (p1.folded) winner = p2;
    else if (p2.folded) winner = p1;
    else {
        const score1 = evaluateHandValue([...p1.cards, ...room.communityCards]);
        const score2 = evaluateHandValue([...p2.cards, ...room.communityCards]);

        if (score1 > score2) winner = p1;
        else if (score2 > score1) winner = p2;
    }

    if (winner) {
        winner.chips += room.pot;
        io.to(roomId).emit('round_result', {
            winner: winner.username,
            pot: room.pot,
            p1Cards: p1.cards,
            p2Cards: p2.cards
        });
    } else {
        p1.chips += Math.floor(room.pot / 2);
        p2.chips += Math.floor(room.pot / 2);
        io.to(roomId).emit('round_result', { winner: 'TIE / SPLIT POT', pot: room.pot });
    }

    setTimeout(() => {
        startNewHand(roomId);
    }, 4000);
}

io.on('connection', (socket) => {
    socket.on('find_match', (data) => {
        if (waitingPlayer && waitingPlayer.id !== socket.id) {
            const roomId = 'room_' + Date.now();
            rooms[roomId] = {
                players: [
                    { id: waitingPlayer.id, username: waitingPlayer.username, chips: 100 },
                    { id: socket.id, username: data.username, chips: 100 }
                ]
            };

            socket.join(roomId);
            io.sockets.sockets.get(waitingPlayer.id)?.join(roomId);
            waitingPlayer = null;

            startNewHand(roomId);
        } else {
            waitingPlayer = { id: socket.id, username: data.username };
        }
    });

    socket.on('player_action', (data) => {
        const room = rooms[data.roomId];
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1 || playerIndex !== room.currentTurn) return;

        const player = room.players[playerIndex];

        if (data.action === 'fold') {
            player.folded = true;
            resolveShowdown(data.roomId);
            return;
        } else if (data.action === 'raise') {
            const betAmount = Math.min(data.amount || 10, player.chips);
            player.chips -= betAmount;
            room.pot += betAmount;
        } else if (data.action === 'call') {
            const callAmount = Math.min(10, player.chips);
            player.chips -= callAmount;
            room.pot += callAmount;
        }

        room.currentTurn = 1 - room.currentTurn;

        if (room.currentTurn === 0) {
            advanceStage(data.roomId);
        } else {
            io.to(data.roomId).emit('game_update', {
                pot: room.pot,
                turnUser: room.players[room.currentTurn].username,
                stage: room.stage
            });
        }
    });

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});