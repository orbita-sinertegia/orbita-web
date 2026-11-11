// Privacidad de las invitaciones y del acceso sin sesión.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('la invitación de cliente muestra el correo fijo y se registra con él', () => {
  const page = read('src/components/auth/ClientRegistrationPage.tsx')
  assert.match(page, /rpc\('get_client_invitation'/)
  assert.doesNotMatch(page, /from\('client_invitations'\)/)
  assert.match(page, /createOrSignIn\(invite!\.email/)
  assert.doesNotMatch(page, /type="email"/)
  assert.match(page, /\{invite\?\.email\}/)
})

test('toda invitación de cliente nueva lleva correo', () => {
  for (const file of ['src/components/admin/ClientAssignmentManager.tsx', 'src/components/admin/CreateProjectModal.tsx']) {
    const source = read(file)
    assert.match(source, /askInviteEmail/)
    assert.doesNotMatch(source, /insert\(\{ client_id: \w+ \}\)/)
  }
})

test('el inicio de sesión explica cuando una cuenta no tiene invitación', () => {
  const page = read('src/components/auth/LoginPage.tsx')
  assert.match(page, /error_description/)
  assert.match(page, /NO_INVITATION_MESSAGE/)
  assert.match(read('src/lib/signInErrors.ts'), /no tiene una invitación/)
})

test('Google inicia sesión con el botón oficial y un nonce, con redirección como respaldo', () => {
  const google = read('src/components/auth/GoogleSignInButton.tsx')
  assert.match(google, /accounts\.google\.com\/gsi\/client/)
  assert.match(google, /signInWithIdToken\(\{ provider: 'google', token: credential, nonce: nonce\.raw \}\)/)
  assert.match(google, /nonce: nonce\.hashed/)
  assert.match(google, /signInWithOAuth/)
})

test('el correo de bienvenida sale por Gmail, solo para administradores y con datos validados', () => {
  const fn = read('supabase/functions/send-user-invitation/index.ts')
  assert.match(fn, /host: 'smtp\.gmail\.com'/)
  assert.match(fn, /port: 465/)
  assert.match(fn, /Deno\.env\.get\('GMAIL_APP_PASSWORD'\)/)
  assert.doesNotMatch(fn, /api\.resend\.com|RESEND_/)
  assert.match(fn, /caller\.is_super_admin \|\| caller\.role === 'admin'/)
  assert.match(fn, /EMAIL_PATTERN\.test\(recipient\)/)
  assert.match(fn, /href="\$\{safeUrl\}"/)
})

test('el inicio de sesión usa el diseño de cristal con la animación del logo', () => {
  const page = read('src/components/auth/LoginPage.tsx')
  const css = read('src/components/auth/LoginCristal.css')
  assert.match(page, /className="login-cristal"/)
  assert.match(page, /setView\('forgot'\)/)
  assert.match(page, /setShowPassword/)
  assert.match(css, /@keyframes orbita-giro/)
  assert.match(css, /prefers-reduced-motion/)
})

test('el SQL quita el acceso abierto y solo se aplica si pasan sus pruebas', () => {
  const sql = read('sql/2026-11-05_cerrar_privacidad.sql')
  for (const table of ['users', 'clients', 'projects', 'tasks', 'notifications', 'task_comments', 'task_links']) {
    assert.match(sql, new RegExp(`drop policy if exists "allow all" on public\\.${table};`))
  }
  assert.match(sql, /drop policy if exists "public_read" on public\.client_invitations;/)
  assert.match(sql, /before insert on auth\.users/)
  assert.match(sql, /sin-invitacion@example\.com/)
  assert.ok(sql.indexOf('PRUEBA FALLIDA') < sql.lastIndexOf('commit;'))
})

test('una invitación nueva para un correo que ya tiene cuenta se acepta con su contraseña', () => {
  const helper = read('src/lib/inviteAccount.ts')
  assert.match(helper, /User already registered/)
  assert.match(helper, /signInWithPassword\(\{ email, password \}\)/)
  for (const page of ['src/components/auth/ClientRegistrationPage.tsx', 'src/components/auth/TeamRegistrationPage.tsx']) {
    const source = read(page)
    assert.match(source, /createOrSignIn\(/)
    assert.doesNotMatch(source, /Este correo ya tiene una cuenta registrada/)
  }
  assert.match(read('supabase/functions/send-user-invitation/index.ts'), /info\.rejected\?\.length/)
})
