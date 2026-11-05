# Configuración de marca para autenticación

## Correo de reautenticación

En Supabase Dashboard abrir **Authentication → Email Templates → Reauthentication**.

- Asunto: `Tu código de seguridad de Órbita`
- Contenido: copiar completo `email-templates/reauthentication.html`

Para que el remitente deje de aparecer como **Supabase Auth**, configurar
**Authentication → SMTP Settings** con un correo corporativo, por ejemplo:

- Nombre del remitente: `Órbita`
- Correo del remitente: `notificaciones@tu-dominio.com`

El proveedor SMTP puede ser Google Workspace, Resend, Postmark o SendGrid.

## Inicio de sesión con Google sin `supabase.co`

Dominio recomendado: `auth.tu-dominio.com`.

1. Activar un dominio personalizado en Supabase.
2. Crear el CNAME solicitado en el proveedor DNS.
3. Agregar en Google Auth Platform la nueva URL autorizada:
   `https://auth.tu-dominio.com/auth/v1/callback`.
4. Mantener temporalmente la URL anterior de Supabase durante la transición.
5. Cambiar `VITE_SUPABASE_URL` a `https://auth.tu-dominio.com` y volver a desplegar.
6. Configurar en Google Auth Platform el nombre, logotipo y dominio autorizado de Órbita.

Los dominios personalizados de Supabase requieren un proyecto en plan de pago
y el complemento correspondiente.
