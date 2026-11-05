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
  assert.match(page, /email: invite!\.email/)
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
