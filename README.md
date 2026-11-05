# Órbita

Plataforma web para gestionar proyectos, tareas, clientes y equipos de trabajo.

Hecha con Vite, React, TypeScript y Supabase.

## Cómo correrla en local

1. Instala las dependencias con `npm install`.
2. Copia `.env.example` a `.env` y escribe los datos de tu proyecto de Supabase.
3. Arranca la app con `npm run dev`.

Para revisar los cambios: `npm run build` compila la app y `npm test` corre las pruebas.

## Estrategia de ramas del equipo

El equipo utiliza GitHub Flow. La rama `main` representa la versión
estable del proyecto y está protegida contra cambios directos.

Cada modificación se desarrolla en una rama temporal:

- `feature/`: nueva funcionalidad.
- `bugfix/`: corrección de un defecto.
- `hotfix/`: corrección urgente.
- `refactor/`: mejora interna sin cambiar el comportamiento.

Las ramas utilizan el formato `prefijo/descripcion-breve`, con
minúsculas y palabras separadas mediante guiones.

Todo cambio dirigido a `main` debe pasar por un Pull Request, recibir
al menos una aprobación de otro integrante y resolver las
conversaciones pendientes. La integración se realiza mediante
Squash and Merge y posteriormente se elimina la rama temporal.
