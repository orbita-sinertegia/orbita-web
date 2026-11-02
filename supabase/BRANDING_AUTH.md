# Configuración de marca para autenticación

## Correo de reautenticación

En Supabase Dashboard abrir **Authentication → Email Templates → Reauthentication**.

- Asunto: `Tu código de seguridad de Sinertegia`
- Contenido: copiar completo `email-templates/reauthentication.html`

Para que el remitente deje de aparecer como **Supabase Auth**, configurar
**Authentication → SMTP Settings** con un correo corporativo, por ejemplo:

- Nombre del remitente: `Sinertegia Launch 57`
- Correo del remitente: `notificaciones@sinertegia.com`

El proveedor SMTP puede ser Google Workspace, Resend, Postmark o SendGrid.

## Inicio de sesión con Google sin `supabase.co`

Dominio recomendado: `auth.sinertegia.com`.

1. Activar un dominio personalizado en Supabase.
2. Crear el CNAME solicitado en el proveedor DNS.
3. Agregar en Google Auth Platform la nueva URL autorizada:
   `https://auth.sinertegia.com/auth/v1/callback`.
4. Mantener temporalmente la URL anterior de Supabase durante la transición.
5. Cambiar `VITE_SUPABASE_URL` a `https://auth.sinertegia.com` y volver a desplegar.
6. Configurar en Google Auth Platform el nombre, logotipo y dominio autorizado de Sinertegia.

Los dominios personalizados de Supabase requieren un proyecto en plan de pago
y el complemento correspondiente.
