# La Norteñita — Render Free + Supabase PostgreSQL

Esta versión reemplaza SQLite por PostgreSQL alojado en Supabase. Render solo ejecuta el servidor y sirve el sitio; todos los productos, pedidos, clientes, detalles de compra, sesiones administrativas y tokens privados se guardan en Supabase. No necesita disco persistente en Render.

## Paso A — Crear proyecto Supabase
1. Entra a https://supabase.com/ y crea una cuenta.
2. Crea un proyecto llamado `la-nortenita` y selecciona el plan Free.
3. Guarda la contraseña de la base de datos de forma segura.
4. Espera a que finalice la creación del proyecto.
5. Abre **Connect** en el panel del proyecto.
6. Selecciona **Connection string**, formato **URI** y **Session pooler**.
7. Copia la URI. Sustituye el marcador de contraseña por la contraseña real de la base de datos. No la envíes por chat ni la subas a GitHub.
8. El servidor crea las tablas automáticamente al arrancar por primera vez. El archivo `supabase/schema.sql` contiene el esquema para referencia.

## Paso B — Actualizar GitHub
1. Descomprime este ZIP.
2. Sube TODO el contenido de la carpeta `la-nortenita-web` a la raíz del repositorio GitHub, reemplazando los archivos de la versión SQLite.
3. Comprueba que `render.yaml`, `server.js`, `package.json` y `public/` estén en la raíz.
4. No subas `.env` ni la URI de Supabase. `.gitignore` excluye `.env`.
5. Haz commit y push a la rama `main`.

## Paso C — Crear el servicio gratuito en Render
1. Entra a https://dashboard.render.com/.
2. Si el Blueprint anterior quedó configurado con Starter y disco, no lo reutilices sin corregirlo. Crea un Blueprint nuevo desde el repositorio actualizado o elimina el servicio anterior solo si confirmaste que no contiene datos que debas conservar.
3. Haz clic en **New +** > **Blueprint**.
4. Conecta GitHub y selecciona el repositorio actualizado y la rama `main`.
5. Verifica que Blueprint Path sea `render.yaml`.
6. Render debe mostrar un servicio web Node con plan **Free**. Este archivo no solicita tarjeta por disco ni define disco persistente.
7. Cuando Render solicite variables secretas, completa:
   - `ADMIN_USER`: por ejemplo `admin`.
   - `ADMIN_PASSWORD`: contraseña propia y única, mínimo 12 caracteres.
   - `SUPABASE_DB_URL`: URI completa del Session Pooler de Supabase.
8. Haz clic en **Apply** o **Create Blueprint**.

## Paso D — Comprobar el despliegue
1. Espera que el servicio quede en estado **Live**.
2. Abre la URL HTTPS `https://<nombre-del-servicio>.onrender.com`.
3. Comprueba que el catálogo cargue. Al inicio, si no había productos, el servidor agrega tres productos de muestra.
4. Haz una compra de prueba con nombre y teléfono.
5. Entra a Administración y comprueba que aparezca el pedido y el botón de WhatsApp.
6. En Supabase > **Table Editor**, revisa las tablas `products`, `orders`, `order_items`, `order_access` y `admin_sessions`.
7. Comprueba `https://<nombre-del-servicio>.onrender.com/health`; debe responder `{"status":"ok"}`.

## Variables de entorno
En Render > servicio > **Environment** deben existir:
- `NODE_ENV` = `production`
- `ADMIN_USER` = tu usuario
- `ADMIN_PASSWORD` = tu contraseña segura
- `SUPABASE_DB_URL` = URI privada de Supabase

Si modificas variables, guarda y vuelve a desplegar.

## Límites de los planes gratuitos
- Render Free suspende el servidor después de 15 minutos sin tráfico; el primer acceso posterior puede tardar cerca de un minuto mientras despierta.
- Render Free tiene sistema de archivos efímero; esta versión no guarda datos allí.
- Supabase Free incluye 500 MB por base de datos y puede pausar proyectos con muy poca actividad durante una semana.
- Supabase Free no incluye backups automáticos. Exporta periódicamente los datos desde Supabase.
- Es una configuración para pruebas, aprendizaje o un piloto pequeño; no es recomendable depender de ella para ventas importantes sin copias de seguridad y un plan de continuidad.
- No hay pagos en línea: el pedido es una solicitud para que el negocio contacte al cliente y complete la venta.

## Seguridad
- Nunca compartas ni publiques `SUPABASE_DB_URL`.
- No reutilices la contraseña de Supabase como contraseña del administrador.
- La autenticación se valida en el servidor, con cookie HttpOnly, SameSite Strict y Secure en producción.
- El inicio de sesión limita los intentos fallidos.
- “Mis compras” usa un token privado aleatorio; el navegador que registró el pedido conserva ese token.
- Haz copias de seguridad periódicas y prueba la restauración.
