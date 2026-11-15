# La Norteñita — sitio web publicable

Sitio web responsive en español, con identidad visual basada en el HERO y logotipo proporcionados.

## Funcionalidades
- Catálogo público de snacks, sin iniciar sesión.
- Carrito y formulario obligatorio de nombre completo + teléfono/WhatsApp.
- Registro de solicitudes en SQLite y descuento de inventario al enviar el pedido.
- “Mis compras”: el comprador consulta sus pedidos mediante un token privado guardado en su navegador.
- Administración protegida con usuario y contraseña: mantenimiento de productos y bandeja privada de pedidos.
- Contacto del comprador por WhatsApp desde el panel.
- Estados de pedido: Pendiente, Contactado, Confirmado, Preparando, Entregado y Cancelado.
- Al cancelar una solicitud se devuelve el stock al inventario.
- Diseño responsive y PWA instalable.

## Ejecutar localmente
1. Requiere Node.js 20 o superior.
2. Copia `.env.example` como `.env`.
3. En `.env`, cambia `ADMIN_USER` y `ADMIN_PASSWORD`. La contraseña debe tener al menos 12 caracteres.
4. Ejecuta `npm install`.
5. Ejecuta `npm start`.
6. Abre `http://localhost:3000`.

La base SQLite se crea en `data/lanortenita.sqlite` (o en la ruta indicada por `DB_PATH`). Se precargan tres productos de ejemplo la primera vez.

## Publicar en Render con base SQLite persistente
1. Sube el contenido de esta carpeta a un repositorio privado de GitHub.
2. En Render, crea un nuevo Blueprint desde ese repositorio; Render detectará `render.yaml`.
3. Completa las variables `ADMIN_USER` y `ADMIN_PASSWORD` cuando Render las solicite.
4. Despliega el servicio. El disco persistente está montado en `/var/data` y la BD queda en `/var/data/lanortenita.sqlite`.
5. Usa el dominio HTTPS asignado. La PWA podrá instalarse desde el navegador del teléfono.

También puedes desplegar el Dockerfile en un VPS, siempre que montes un volumen persistente para `/app/data` o configures `DB_PATH`.

## Seguridad y operación
- No publiques ni compartas el archivo `.env`.
- Cambia la contraseña de ejemplo antes del despliegue.
- Las rutas de administración requieren sesión del servidor; ocultar la sección en la interfaz no es la única protección.
- La cookie administrativa es HttpOnly, SameSite Strict y Secure en producción.
- El acceso de login tiene limitación de intentos.
- La consulta de “Mis compras” usa un token secreto; no compartas ese token.
- El servidor debe permanecer activo y la base SQLite debe estar en disco persistente para conservar ventas y stock.
- Haz copias de seguridad regulares del archivo SQLite.
- Los pedidos son solicitudes de compra, no pagos en línea: el negocio debe contactar al cliente y confirmar la venta.
