# sinertegia-launch
Proyecto integrador Sinertegia Launch para la gestión colaborativa mediante GitHub Flow.

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
