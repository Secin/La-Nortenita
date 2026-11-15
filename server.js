require('dotenv').config();
const express=require('express');
const Database=require('better-sqlite3');
const crypto=require('crypto');
const path=require('path');
const rateLimit=require('express-rate-limit');

const app=express();
const dbPath=process.env.DB_PATH||path.join(__dirname,'data','lanortenita.sqlite');
require('fs').mkdirSync(path.dirname(dbPath),{recursive:true});
const db=new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,price REAL NOT NULL CHECK(price>0),stock INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,customer TEXT NOT NULL,phone TEXT NOT NULL,total REAL NOT NULL,status TEXT NOT NULL DEFAULT 'Pendiente',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES orders(id),product_id INTEGER NOT NULL,name TEXT NOT NULL,price REAL NOT NULL,quantity INTEGER NOT NULL,subtotal REAL NOT NULL);
CREATE TABLE IF NOT EXISTS order_access(order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
`);
if(db.prepare('SELECT COUNT(*) n FROM products').get().n===0){
 const ins=db.prepare('INSERT INTO products(name,price,stock) VALUES(?,?,?)');
 [['Chifles clásicos',5,30],['Camote crocante',5,25],['Chifles de plátano',5,25]].forEach(p=>ins.run(...p));
}
const ADMIN_USER=process.env.ADMIN_USER,ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;
if(!ADMIN_USER||!ADMIN_PASSWORD||ADMIN_PASSWORD.length<12){console.error('Configura ADMIN_USER y ADMIN_PASSWORD (mínimo 12 caracteres) en .env');process.exit(1);}
const SESSION_MS=8*60*60*1000,hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function safeEqual(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function cookie(req,key){for(const part of (req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===key)return decodeURIComponent(part.slice(i+1).trim());}return null;}
function requireAdmin(req,res,next){const token=cookie(req,'nortenita_admin');if(!token)return res.status(401).json({error:'Inicia sesión como administrador'});const h=hash(token),row=db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?').get(h);if(!row||row.expires_at<Date.now()){db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(h);res.clearCookie('nortenita_admin');return res.status(401).json({error:'La sesión expiró. Ingresa nuevamente.'});}next();}
app.set('trust proxy',1);
app.use(express.json({limit:'30kb'}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:process.env.NODE_ENV==='production'?'1h':0}));
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false,message:{error:'Demasiados intentos. Espera 15 minutos e inténtalo nuevamente.'}});
app.get('/api/products',(req,res)=>res.json(db.prepare('SELECT id,name,price,stock FROM products ORDER BY id DESC').all()));
app.post('/api/admin/login',loginLimiter,(req,res)=>{const {username,password}=req.body||{};if(!safeEqual(username||'',ADMIN_USER)||!safeEqual(password||'',ADMIN_PASSWORD))return res.status(401).json({error:'Usuario o contraseña incorrectos'});const token=crypto.randomBytes(32).toString('hex'),expires=Date.now()+SESSION_MS;db.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)').run(hash(token),expires);res.cookie('nortenita_admin',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:SESSION_MS,path:'/'});res.json({ok:true});});
app.get('/api/admin/session',requireAdmin,(req,res)=>res.json({authenticated:true}));
app.post('/api/admin/logout',requireAdmin,(req,res)=>{const token=cookie(req,'nortenita_admin');db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hash(token));res.clearCookie('nortenita_admin',{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/'});res.json({ok:true});});
app.get('/api/admin/products',requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
function validProduct(b){return String(b?.name||'').trim().length>0&&String(b.name).trim().length<=100&&Number.isFinite(Number(b.price))&&Number(b.price)>0&&Number.isInteger(Number(b.stock))&&Number(b.stock)>=0;}
app.post('/api/admin/products',requireAdmin,(req,res)=>{if(!validProduct(req.body))return res.status(400).json({error:'Revisa nombre, precio y stock'});const {name,price,stock}=req.body;const info=db.prepare('INSERT INTO products(name,price,stock) VALUES(?,?,?)').run(name.trim(),Number(price),Number(stock));res.json({id:info.lastInsertRowid});});
app.put('/api/admin/products/:id',requireAdmin,(req,res)=>{if(!validProduct(req.body))return res.status(400).json({error:'Revisa nombre, precio y stock'});const {name,price,stock}=req.body;const info=db.prepare('UPDATE products SET name=?,price=?,stock=? WHERE id=?').run(name.trim(),Number(price),Number(stock),Number(req.params.id));if(!info.changes)return res.status(404).json({error:'Producto no encontrado'});res.json({ok:true});});
app.delete('/api/admin/products/:id',requireAdmin,(req,res)=>{const id=Number(req.params.id),used=db.prepare('SELECT COUNT(*) n FROM order_items WHERE product_id=?').get(id).n;if(used)return res.status(409).json({error:'El producto ya forma parte de pedidos. Cambia su stock a cero para retirarlo del catálogo.'});const info=db.prepare('DELETE FROM products WHERE id=?').run(id);if(!info.changes)return res.status(404).json({error:'Producto no encontrado'});res.json({ok:true});});
function getOrder(id){const o=db.prepare('SELECT id,customer,phone,total,status,created_at FROM orders WHERE id=?').get(id);if(!o)return null;o.items=db.prepare('SELECT name,price,quantity,subtotal FROM order_items WHERE order_id=?').all(id);return o;}
app.post('/api/orders',(req,res)=>{const {customer,phone,items}=req.body||{},name=String(customer||'').trim(),number=String(phone||'').trim(),digits=number.replace(/\D/g,'');if(name.length<2||name.length>100||digits.length<9||digits.length>15||!Array.isArray(items)||!items.length)return res.status(400).json({error:'Ingresa tu nombre completo, teléfono válido y productos del carrito'});if(items.length>30)return res.status(400).json({error:'El carrito supera el máximo permitido'});try{const accessToken=crypto.randomBytes(32).toString('hex');const create=db.transaction(()=>{let total=0,lines=[];for(const it of items){const p=db.prepare('SELECT * FROM products WHERE id=?').get(Number(it.product_id)),q=Number(it.quantity);if(!p||!Number.isInteger(q)||q<1||p.stock<q)throw new Error('Stock insuficiente para '+(p?.name||'un producto'));const subtotal=p.price*q;total+=subtotal;lines.push({...p,quantity:q,subtotal});}const info=db.prepare('INSERT INTO orders(customer,phone,total) VALUES(?,?,?)').run(name,number,total);const insert=db.prepare('INSERT INTO order_items(order_id,product_id,name,price,quantity,subtotal) VALUES(?,?,?,?,?,?)'),update=db.prepare('UPDATE products SET stock=stock-? WHERE id=?');for(const l of lines){insert.run(info.lastInsertRowid,l.id,l.name,l.price,l.quantity,l.subtotal);update.run(l.quantity,l.id);}db.prepare('INSERT INTO order_access(order_id,token_hash) VALUES(?,?)').run(info.lastInsertRowid,hash(accessToken));return Number(info.lastInsertRowid);});res.json({id:create(),accessToken});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/my-orders/:token',(req,res)=>{const token=String(req.params.token||'');if(!/^[a-f0-9]{64}$/.test(token))return res.status(404).json({error:'Compra no encontrada'});const row=db.prepare('SELECT order_id FROM order_access WHERE token_hash=?').get(hash(token));if(!row)return res.status(404).json({error:'Compra no encontrada'});const order=getOrder(row.order_id);if(!order)return res.status(404).json({error:'Compra no encontrada'});res.json(order);});
app.get('/api/admin/orders',requireAdmin,(req,res)=>res.json(db.prepare('SELECT id FROM orders ORDER BY id DESC LIMIT 500').all().map(x=>getOrder(x.id))));
const statuses=['Pendiente','Contactado','Confirmado','Preparando','Entregado','Cancelado'];
app.patch('/api/admin/orders/:id',requireAdmin,(req,res)=>{const next=req.body?.status,id=Number(req.params.id);if(!statuses.includes(next))return res.status(400).json({error:'Estado no válido'});try{db.transaction(()=>{const order=db.prepare('SELECT status FROM orders WHERE id=?').get(id);if(!order)throw new Error('Pedido no encontrado');if(order.status==='Cancelado'&&next!=='Cancelado')throw new Error('Un pedido cancelado no puede reactivarse. Registra una nueva solicitud.');if(order.status!=='Cancelado'&&next==='Cancelado'){for(const item of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id)){db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity,item.product_id);}}db.prepare('UPDATE orders SET status=? WHERE id=?').run(next,id);})();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
const port=process.env.PORT||3000;
app.listen(port,'0.0.0.0',()=>console.log(`La Norteñita en puerto ${port}`));
