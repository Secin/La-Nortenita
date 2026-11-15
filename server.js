require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DATABASE_URL = process.env.SUPABASE_DB_URL;
const SESSION_MS = 8 * 60 * 60 * 1000;
const hash = s => crypto.createHash('sha256').update(s).digest('hex');

if (!DATABASE_URL) { console.error('Falta SUPABASE_DB_URL en las variables de Render.'); process.exit(1); }
if (!ADMIN_USER || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error('Configura ADMIN_USER y ADMIN_PASSWORD (mínimo 12 caracteres).'); process.exit(1);
}
const pool = new Pool({
  connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false },
  max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000, keepAlive: true
});
pool.on('error', e => console.error('PostgreSQL:', e.message));

app.set('trust proxy', 1);
app.use(express.json({limit:'30kb'}));
app.use(express.static(path.join(__dirname,'public'), {maxAge:process.env.NODE_ENV==='production'?'1h':0}));

function safeEqual(a,b) {
  const x=Buffer.from(String(a)), y=Buffer.from(String(b));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function cookie(req,key) {
  for (const part of (req.headers.cookie||'').split(';')) {
    const i=part.indexOf('=');
    if (i>0 && part.slice(0,i).trim()===key) return decodeURIComponent(part.slice(i+1).trim());
  }
  return null;
}
function requireAdmin(req,res,next) {
  const token=cookie(req,'nortenita_admin');
  if (!token) return res.status(401).json({error:'Inicia sesión como administrador'});
  pool.query('SELECT expires_at FROM admin_sessions WHERE token_hash=$1',[hash(token)])
    .then(async r=>{
      const row=r.rows[0];
      if (!row || new Date(row.expires_at).getTime()<Date.now()) {
        await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1',[hash(token)]);
        res.clearCookie('nortenita_admin',{httpOnly:true,sameSite:'strict',secure:true,path:'/'});
        return res.status(401).json({error:'La sesión expiró. Ingresa nuevamente.'});
      }
      next();
    }).catch(e=>{console.error(e.message);res.status(500).json({error:'No se pudo verificar la sesión'});});
}
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false,
  message:{error:'Demasiados intentos. Espera 15 minutos e inténtalo nuevamente.'}});

app.get('/health',(req,res)=>res.json({status:'ok'}));
app.get('/api/products',async(req,res)=>{
  try { const r=await pool.query('SELECT id,name,price,stock FROM products ORDER BY id DESC'); res.json(r.rows); }
  catch(e){console.error(e.message);res.status(503).json({error:'No se pudo cargar el catálogo. Intenta nuevamente.'});}
});

app.post('/api/admin/login',loginLimiter,async(req,res)=>{
  const {username,password}=req.body||{};
  if(!safeEqual(username||'',ADMIN_USER)||!safeEqual(password||'',ADMIN_PASSWORD))
    return res.status(401).json({error:'Usuario o contraseña incorrectos'});
  try{
    const token=crypto.randomBytes(32).toString('hex');
    await pool.query('INSERT INTO admin_sessions(token_hash,expires_at) VALUES($1,$2)',
      [hash(token),new Date(Date.now()+SESSION_MS)]);
    res.cookie('nortenita_admin',token,{httpOnly:true,sameSite:'strict',
      secure:process.env.NODE_ENV==='production',maxAge:SESSION_MS,path:'/'});
    res.json({ok:true});
  }catch(e){console.error(e.message);res.status(500).json({error:'No se pudo iniciar sesión'});}
});
app.get('/api/admin/session',requireAdmin,(req,res)=>res.json({authenticated:true}));
app.post('/api/admin/logout',requireAdmin,async(req,res)=>{
  try{
    await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1',[hash(cookie(req,'nortenita_admin'))]);
    res.clearCookie('nortenita_admin',{httpOnly:true,sameSite:'strict',
      secure:process.env.NODE_ENV==='production',path:'/'});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:'No se pudo cerrar sesión'});}
});
app.get('/api/admin/products',requireAdmin,async(req,res)=>{
  try{const r=await pool.query('SELECT id,name,price,stock FROM products ORDER BY id DESC');res.json(r.rows);}
  catch(e){res.status(500).json({error:'No se pudieron cargar los productos'});}
});
function validProduct(b){return String(b?.name||'').trim().length>0&&String(b.name).trim().length<=100
  &&Number.isFinite(Number(b.price))&&Number(b.price)>0&&Number.isInteger(Number(b.stock))&&Number(b.stock)>=0;}
app.post('/api/admin/products',requireAdmin,async(req,res)=>{
  if(!validProduct(req.body))return res.status(400).json({error:'Revisa nombre, precio y stock'});
  try{const {name,price,stock}=req.body;const r=await pool.query(
    'INSERT INTO products(name,price,stock) VALUES($1,$2,$3) RETURNING id',[name.trim(),Number(price),Number(stock)]);
    res.json({id:r.rows[0].id});}catch(e){res.status(500).json({error:'No se pudo registrar el producto'});}
});
app.put('/api/admin/products/:id',requireAdmin,async(req,res)=>{
  if(!validProduct(req.body))return res.status(400).json({error:'Revisa nombre, precio y stock'});
  try{const {name,price,stock}=req.body;const r=await pool.query(
    'UPDATE products SET name=$1,price=$2,stock=$3 WHERE id=$4 RETURNING id',
    [name.trim(),Number(price),Number(stock),Number(req.params.id)]);
    if(!r.rowCount)return res.status(404).json({error:'Producto no encontrado'});res.json({ok:true});
  }catch(e){res.status(500).json({error:'No se pudo actualizar el producto'});}
});
app.delete('/api/admin/products/:id',requireAdmin,async(req,res)=>{
  try{
    const id=Number(req.params.id);
    const used=await pool.query('SELECT COUNT(*)::int AS n FROM order_items WHERE product_id=$1',[id]);
    if(used.rows[0].n)return res.status(409).json({error:'El producto ya forma parte de pedidos. Cambia su stock a cero para retirarlo del catálogo.'});
    const r=await pool.query('DELETE FROM products WHERE id=$1 RETURNING id',[id]);
    if(!r.rowCount)return res.status(404).json({error:'Producto no encontrado'});res.json({ok:true});
  }catch(e){res.status(500).json({error:'No se pudo eliminar el producto'});}
});
async function getOrder(db,id){
  const r=await db.query('SELECT id,customer,phone,total,status,created_at FROM orders WHERE id=$1',[id]);
  if(!r.rows[0])return null;
  const o=r.rows[0], items=await db.query(
    'SELECT name,price,quantity,subtotal FROM order_items WHERE order_id=$1 ORDER BY id',[id]);
  o.items=items.rows;return o;
}

app.post('/api/orders',async(req,res)=>{
  const {customer,phone,items}=req.body||{},name=String(customer||'').trim(),
    phoneText=String(phone||'').trim(),digits=phoneText.replace(/\D/g,'');
  if(name.length<2||name.length>100||digits.length<9||digits.length>15||!Array.isArray(items)||!items.length)
    return res.status(400).json({error:'Ingresa tu nombre completo, teléfono válido y productos del carrito'});
  if(items.length>30)return res.status(400).json({error:'El carrito supera el máximo permitido'});
  const client=await pool.connect(),accessToken=crypto.randomBytes(32).toString('hex');
  try{
    await client.query('BEGIN');let total=0;const lines=[];
    for(const item of items){
      const id=Number(item.product_id),quantity=Number(item.quantity);
      if(!Number.isInteger(id)||id<1||!Number.isInteger(quantity)||quantity<1)
        throw new Error('Hay un producto o cantidad inválida en el carrito');
      const r=await client.query('SELECT id,name,price,stock FROM products WHERE id=$1 FOR UPDATE',[id]);
      const p=r.rows[0];
      if(!p||Number(p.stock)<quantity)throw new Error('Stock insuficiente para '+(p?.name||'un producto'));
      const price=Number(p.price),subtotal=Math.round(price*quantity*100)/100;
      total+=subtotal;lines.push({...p,price,quantity,subtotal});
    }
    const created=await client.query(
      'INSERT INTO orders(customer,phone,total) VALUES($1,$2,$3) RETURNING id',[name,phoneText,total]);
    const orderId=created.rows[0].id;
    for(const l of lines){
      await client.query('INSERT INTO order_items(order_id,product_id,name,price,quantity,subtotal) VALUES($1,$2,$3,$4,$5,$6)',
        [orderId,l.id,l.name,l.price,l.quantity,l.subtotal]);
      await client.query('UPDATE products SET stock=stock-$1 WHERE id=$2',[l.quantity,l.id]);
    }
    await client.query('INSERT INTO order_access(order_id,token_hash) VALUES($1,$2)',[orderId,hash(accessToken)]);
    await client.query('COMMIT');res.json({id:orderId,accessToken});
  }catch(e){await client.query('ROLLBACK');console.error(e.message);res.status(400).json({error:e.message||'No se pudo registrar el pedido'});}
  finally{client.release();}
});
app.get('/api/my-orders/:token',async(req,res)=>{
  const token=String(req.params.token||'');
  if(!/^[a-f0-9]{64}$/.test(token))return res.status(404).json({error:'Compra no encontrada'});
  try{
    const r=await pool.query('SELECT order_id FROM order_access WHERE token_hash=$1',[hash(token)]);
    if(!r.rows[0])return res.status(404).json({error:'Compra no encontrada'});
    const o=await getOrder(pool,r.rows[0].order_id);
    if(!o)return res.status(404).json({error:'Compra no encontrada'});res.json(o);
  }catch(e){res.status(500).json({error:'No se pudo consultar la compra'});}
});
app.get('/api/admin/orders',requireAdmin,async(req,res)=>{
  try{const r=await pool.query('SELECT id FROM orders ORDER BY id DESC LIMIT 500');
    const orders=await Promise.all(r.rows.map(x=>getOrder(pool,x.id)));res.json(orders.filter(Boolean));
  }catch(e){res.status(500).json({error:'No se pudieron cargar los pedidos'});}
});
const statuses=['Pendiente','Contactado','Confirmado','Preparando','Entregado','Cancelado'];
app.patch('/api/admin/orders/:id',requireAdmin,async(req,res)=>{
  const id=Number(req.params.id),next=req.body?.status;
  if(!statuses.includes(next))return res.status(400).json({error:'Estado no válido'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE',[id]);
    if(!r.rows[0])throw new Error('Pedido no encontrado');
    const old=r.rows[0].status;
    if(old==='Cancelado'&&next!=='Cancelado')throw new Error('Un pedido cancelado no puede reactivarse. Registra una nueva solicitud.');
    if(old!=='Cancelado'&&next==='Cancelado'){
      const lines=await client.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1',[id]);
      for(const line of lines.rows)await client.query(
        'UPDATE products SET stock=stock+$1 WHERE id=$2',[line.quantity,line.product_id]);
    }
    await client.query('UPDATE orders SET status=$1 WHERE id=$2',[next,id]);
    await client.query('COMMIT');res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message});}
  finally{client.release();}
});

async function start(){
  try{
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS products(
      id BIGSERIAL PRIMARY KEY,name VARCHAR(100) NOT NULL,
      price NUMERIC(12,2) NOT NULL CHECK(price>0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS orders(
      id BIGSERIAL PRIMARY KEY,customer VARCHAR(100) NOT NULL,phone VARCHAR(30) NOT NULL,
      total NUMERIC(12,2) NOT NULL CHECK(total>=0),status VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS order_items(
      id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      name VARCHAR(100) NOT NULL,price NUMERIC(12,2) NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity>0),subtotal NUMERIC(12,2) NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS order_access(
      order_id BIGINT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,token_hash CHAR(64) NOT NULL UNIQUE)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_sessions(
      token_hash CHAR(64) PRIMARY KEY,expires_at TIMESTAMPTZ NOT NULL)`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)');
    const count=await pool.query('SELECT COUNT(*)::int AS n FROM products');
    if(count.rows[0].n===0)await pool.query(
      "INSERT INTO products(name,price,stock) VALUES ('Chifles clásicos',5,30),('Camote crocante',5,25),('Chifles de plátano',5,25)");
    app.listen(PORT,'0.0.0.0',()=>console.log('La Norteñita lista en puerto '+PORT));
  }catch(e){console.error('No se pudo conectar o preparar Supabase PostgreSQL:',e.message);process.exit(1);}
}
start();
