const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

const app = express();

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;
(async () => {
    try {
        db = await open({
            filename: './database.db',
            driver: sqlite3.Database
        });

        await db.exec(`
            CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_by TEXT);
            CREATE TABLE IF NOT EXISTS mods (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER, filename TEXT, original_name TEXT, uploaded_by TEXT);
        `);
    } catch (err) {
        console.error('خطأ في قاعدة البيانات:', err);
    }
})();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/categories', async (req, res) => {
    const categories = await db.all('SELECT * FROM categories');
    res.json(categories);
});

app.post('/api/categories', async (req, res) => {
    const { name, username } = req.body;
    if (!name) return res.status(400).json({ error: 'البيانات ناقصة' });
    await db.run('INSERT INTO categories (name, created_by) VALUES (?, ?)', [name, username || 'مجهول']);
    res.json({ success: true });
});

// حذف كاتيجوري كامل بدون تعقيدات
app.delete('/api/categories/:id', async (req, res) => {
    const catId = req.params.id;
    try {
        const mods = await db.all('SELECT * FROM mods WHERE category_id = ?', [catId]);
        for (let mod of mods) {
            const filePath = path.join(__dirname, 'uploads', mod.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await db.run('DELETE FROM mods WHERE category_id = ?', [catId]);
        await db.run('DELETE FROM categories WHERE id = ?', [catId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ أثناء الحذف' });
    }
});

app.post('/api/upload-mod', upload.single('modfile'), async (req, res) => {
    const { category_id, username } = req.body;
    if (!req.file) return res.status(400).send('لم يتم اختيار ملف');
    
    await db.run(
        'INSERT INTO mods (category_id, filename, original_name, uploaded_by) VALUES (?, ?, ?, ?)', 
        [category_id, req.file.filename, req.file.originalname, username || 'مجهول']
    );
    res.json({ success: true });
});

// حذف ملف مود معين مباشرة
app.delete('/api/mods/:id', async (req, res) => {
    const modId = req.params.id;
    try {
        const mod = await db.get('SELECT * FROM mods WHERE id = ?', [modId]);
        if (mod) {
            const filePath = path.join(__dirname, 'uploads', mod.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            await db.run('DELETE FROM mods WHERE id = ?', [modId]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ أثناء الحذف' });
    }
});

app.get('/api/mods/:categoryId', async (req, res) => {
    const mods = await db.all('SELECT * FROM mods WHERE category_id = ?', [req.params.categoryId]);
    res.json(mods);
});

app.get('/download/:filename', (req, res) => {
    const file = path.join(__dirname, 'uploads', req.params.filename);
    res.download(file);
});

app.listen(3000, () => {
    console.log('الموقع شغال على: http://localhost:3000');
});